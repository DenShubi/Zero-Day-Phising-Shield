import json
from pathlib import Path
from typing import Any, Optional

import httpx

from app.config import BASE_DIR, get_env


class SupabaseService:
    """
    Async Supabase PostgREST + Storage integration for VisiKartika Shield.
    Connects `backend-engine` (Person A) to `scan_incidents`, `official_portals`,
    and Storage bucket `scan-evidence` created by Person B (Denin).
    """

    @staticmethod
    def _credentials() -> tuple[str, str, str, str]:
        raw_url = get_env("SUPABASE_URL", aliases=("NEXT_PUBLIC_SUPABASE_URL",)).rstrip("/")
        for suffix in ("/rest/v1", "/storage/v1", "/auth/v1"):
            if raw_url.endswith(suffix):
                raw_url = raw_url[: -len(suffix)].rstrip("/")
        url = raw_url
        key = get_env(
            "SUPABASE_SERVICE_ROLE_KEY",
            aliases=("SUPABASE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        )
        bucket = get_env("SUPABASE_BUCKET", default="scan-evidence")
        backend_url = get_env("PUBLIC_BACKEND_URL", default="http://localhost:8000").rstrip("/")
        return url, key, bucket, backend_url

    @classmethod
    def is_configured(cls) -> bool:
        url, key, _, _ = cls._credentials()
        if not url or not key:
            return False
        if "xxxx" in url or key.endswith("..."):
            return False
        return url.startswith("https://") or url.startswith("http://")

    @staticmethod
    def _headers(key: str, extra: Optional[dict[str, str]] = None) -> dict[str, str]:
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
        }
        if extra:
            headers.update(extra)
        return headers

    @classmethod
    async def check_connection(cls) -> dict[str, Any]:
        url, key, bucket, backend_url = cls._credentials()
        if not cls.is_configured():
            return {
                "configured": False,
                "connected": False,
                "supabase_url": url or None,
                "bucket": bucket,
                "message": (
                    "Supabase belum dikonfigurasi. Isi SUPABASE_URL dan "
                    "SUPABASE_SERVICE_ROLE_KEY pada file backend-engine/.env"
                ),
            }

        status_report: dict[str, Any] = {
            "configured": True,
            "connected": False,
            "supabase_url": url,
            "bucket": bucket,
            "public_backend_url": backend_url,
            "table_scan_incidents_ok": False,
            "table_official_portals_ok": False,
            "storage_bucket_ok": False,
            "incidents_count_sample": 0,
            "portals_count_sample": 0,
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r_inc = await client.get(
                    f"{url}/rest/v1/scan_incidents?select=id&limit=50",
                    headers=cls._headers(key),
                )
                if r_inc.status_code == 200:
                    status_report["table_scan_incidents_ok"] = True
                    status_report["incidents_count_sample"] = len(r_inc.json())
                else:
                    status_report["scan_incidents_error"] = r_inc.text[:250]

                r_por = await client.get(
                    f"{url}/rest/v1/official_portals?select=id&limit=50",
                    headers=cls._headers(key),
                )
                if r_por.status_code == 200:
                    status_report["table_official_portals_ok"] = True
                    status_report["portals_count_sample"] = len(r_por.json())
                else:
                    status_report["official_portals_error"] = r_por.text[:250]

                r_bkt = await client.get(
                    f"{url}/storage/v1/bucket/{bucket}",
                    headers=cls._headers(key),
                )
                if r_bkt.status_code == 200:
                    status_report["storage_bucket_ok"] = True
                else:
                    # Auto-provision public bucket using service_role privileges
                    r_create = await client.post(
                        f"{url}/storage/v1/bucket",
                        headers=cls._headers(key, {"Content-Type": "application/json"}),
                        json={"id": bucket, "name": bucket, "public": True},
                    )
                    if r_create.status_code in (200, 201):
                        status_report["storage_bucket_ok"] = True
                        status_report["storage_bucket_created"] = True
                    else:
                        status_report["storage_bucket_hint"] = (
                            f"Bucket '{bucket}' belum ditemukan ({r_bkt.status_code}). "
                            "Jalankan supabase/migrations/20261102_storage_and_rls.sql di SQL Editor "
                            "atau buat Public Bucket bernama 'scan-evidence'."
                        )

            status_report["connected"] = bool(
                status_report["table_scan_incidents_ok"] and status_report["table_official_portals_ok"]
            )
            status_report["message"] = (
                "Terhubung ke Supabase dengan sukses!"
                if status_report["connected"]
                else "Terhubung ke host Supabase, namun pastikan migrasi SQL sudah dijalankan."
            )
        except Exception as exc:
            status_report["message"] = f"Gagal menghubungi Supabase: {type(exc).__name__}: {exc}"

        return status_report

    @classmethod
    async def upload_evidence_image(
        cls,
        local_file: Path,
        remote_object_path: str,
        fallback_static_subpath: str,
    ) -> str:
        """
        Upload a PNG file to Supabase Storage (`{bucket}/{remote_object_path}`).
        Falls back cleanly to `{PUBLIC_BACKEND_URL}/{fallback_static_subpath}` if
        Supabase or the Storage bucket is not yet active.
        """
        url, key, bucket, backend_url = cls._credentials()
        fallback_url = f"{backend_url}/{fallback_static_subpath.lstrip('/')}"

        if not cls.is_configured() or not local_file.exists():
            return fallback_url

        upload_endpoint = f"{url}/storage/v1/object/{bucket}/{remote_object_path.lstrip('/')}"
        try:
            file_bytes = local_file.read_bytes()
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    upload_endpoint,
                    headers=cls._headers(
                        key,
                        {
                            "Content-Type": "image/png",
                            "x-upsert": "true",
                        },
                    ),
                    content=file_bytes,
                )
                if resp.status_code in (200, 201):
                    return f"{url}/storage/v1/object/public/{bucket}/{remote_object_path.lstrip('/')}"
        except Exception as exc:
            print(f"[Supabase Storage Warning] Upload failed for {remote_object_path}: {exc}")

        return fallback_url

    @classmethod
    async def record_scan_incident(
        cls,
        *,
        submitted_url: str,
        reporter_source: str,
        reporter_unit: str,
        total_risk_score: float,
        visual_similarity_score: float,
        dom_anomaly_score: float,
        domain_telemetry_score: float,
        verdict: str,
        impersonated_target: Optional[str],
        captured_screenshot_url: str,
        annotated_bbox_url: str,
        detected_logos: list[dict[str, Any]],
        dom_findings: dict[str, Any],
    ) -> tuple[bool, Optional[str]]:
        """
        Insert a scan record into `public.scan_incidents` so the Next.js SOC
        Dashboard receives the Realtime event immediately.
        Returns `(synced_bool, incident_uuid)`.
        """
        url, key, _, _ = cls._credentials()
        if not cls.is_configured():
            return False, None

        row_payload = {
            "submitted_url": submitted_url,
            "reporter_source": reporter_source,
            "reporter_unit": reporter_unit,
            "total_risk_score": round(float(total_risk_score), 2),
            "visual_similarity_score": round(float(visual_similarity_score), 2),
            "dom_anomaly_score": round(float(dom_anomaly_score), 2),
            "domain_telemetry_score": round(float(domain_telemetry_score), 2),
            "verdict": verdict,
            "impersonated_target": impersonated_target,
            "captured_screenshot_url": captured_screenshot_url,
            "annotated_bbox_url": annotated_bbox_url,
            "detected_logos": detected_logos,
            "dom_findings": dom_findings,
        }

        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                resp = await client.post(
                    f"{url}/rest/v1/scan_incidents",
                    headers=cls._headers(
                        key,
                        {
                            "Content-Type": "application/json",
                            "Prefer": "return=representation",
                        },
                    ),
                    json=row_payload,
                )
                if resp.status_code in (200, 201):
                    data = resp.json()
                    if isinstance(data, list) and data:
                        return True, str(data[0].get("id"))
                    return True, None
                print(f"[Supabase Insert Warning] HTTP {resp.status_code}: {resp.text[:250]}")
        except Exception as exc:
            print(f"[Supabase Insert Error] {exc}")

        return False, None

    @classmethod
    async def list_recent_incidents(cls, limit: int = 20) -> dict[str, Any]:
        url, key, _, _ = cls._credentials()
        if not cls.is_configured():
            return {
                "configured": False,
                "incidents": [],
                "message": "Supabase belum dikonfigurasi di .env",
            }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{url}/rest/v1/scan_incidents?select=*&order=created_at.desc&limit={int(limit)}",
                    headers=cls._headers(key),
                )
                if resp.status_code == 200:
                    return {
                        "configured": True,
                        "total_returned": len(resp.json()),
                        "incidents": resp.json(),
                    }
                return {
                    "configured": True,
                    "incidents": [],
                    "error": resp.text[:250],
                }
        except Exception as exc:
            return {
                "configured": True,
                "incidents": [],
                "error": str(exc),
            }

    @classmethod
    async def seed_official_portals(cls) -> dict[str, Any]:
        """
        Sync all 9 official TNI AD / Kemhan portals from `app/reference_db/manifest.json`
        into Supabase Storage + `public.official_portals` table.
        """
        url, key, _, _ = cls._credentials()
        if not cls.is_configured():
            return {
                "success": False,
                "message": "Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di backend-engine/.env terlebih dahulu.",
            }

        ref_dir = BASE_DIR / "app" / "reference_db"
        manifest_file = ref_dir / "manifest.json"
        if not manifest_file.exists():
            return {"success": False, "message": "manifest.json tidak ditemukan."}

        entries = json.loads(manifest_file.read_text(encoding="utf-8"))
        seeded: list[str] = []
        errors: list[str] = []

        async with httpx.AsyncClient(timeout=15.0) as client:
            existing_domains: set[str] = set()
            r_existing = await client.get(
                f"{url}/rest/v1/official_portals?select=official_domain",
                headers=cls._headers(key),
            )
            if r_existing.status_code == 200:
                existing_domains = {
                    str(row.get("official_domain", "")).lower() for row in r_existing.json()
                }

            for item in entries:
                portal_id = item["id"]
                domain = str(item["official_domain"]).lower()
                img_filename = Path(item.get("screenshot", f"{portal_id}.png")).name
                img_path = ref_dir / "portals" / img_filename
                dom_json_path = ref_dir / "portals" / f"{portal_id}.json"

                dom_sig = {}
                if dom_json_path.exists():
                    try:
                        dom_sig = json.loads(dom_json_path.read_text(encoding="utf-8"))
                    except Exception:
                        dom_sig = {}

                ref_img_url = await cls.upload_evidence_image(
                    local_file=img_path,
                    remote_object_path=f"reference_portals/{img_filename}",
                    fallback_static_subpath=f"static/reference/{img_filename}",
                )

                portal_label = item.get("portal_name") or item.get("name") or portal_id
                row_data = {
                    "portal_name": portal_label,
                    "official_domain": item["official_domain"],
                    "reference_screenshot_url": ref_img_url,
                    "dom_signature": dom_sig,
                }

                if domain in existing_domains:
                    resp = await client.patch(
                        f"{url}/rest/v1/official_portals?official_domain=eq.{item['official_domain']}",
                        headers=cls._headers(key, {"Content-Type": "application/json"}),
                        json=row_data,
                    )
                else:
                    resp = await client.post(
                        f"{url}/rest/v1/official_portals",
                        headers=cls._headers(key, {"Content-Type": "application/json"}),
                        json=row_data,
                    )

                if resp.status_code in (200, 201, 204):
                    seeded.append(item["official_domain"])
                else:
                    errors.append(f"{item['official_domain']}: HTTP {resp.status_code} {resp.text[:120]}")

        return {
            "success": len(errors) == 0,
            "seeded_count": len(seeded),
            "seeded_domains": seeded,
            "errors": errors,
        }

