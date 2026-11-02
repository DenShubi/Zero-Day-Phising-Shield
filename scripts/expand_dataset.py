"""
VisiKartika Shield - Comprehensive Dataset Expansion Builder (v2 Resilient Edition).

Menangani karakteristik khusus server `.mil.id` / `.go.id` yang sering lambat atau
hanya merespons pada varian `www.` dengan:
  1. Fast DNS Preflight + Auto Fallback (`https://domain` -> `https://www.domain` -> `http://domain`)
  2. Two-Stage Navigation (`wait_until='commit'` + progressive DOM/Image settle hingga 32 detik)
     agar widget eksternal lambat tidak menggagalkan tangkapan layar utama
  3. Filter Anti-ISP-Redirect (otomatis menolak halaman Internet Positif / Mercusuar / TrustPositif / 403 / 503 / Default Apache)
  4. Sinkronisasi bersih ke Supabase (`official_portals` — termasuk membersihkan entri invalid).

Cara menjalankan dari folder `backend-engine`:
    python scripts/expand_dataset.py
"""

from __future__ import annotations

import asyncio
import json
import socket
import sys
import warnings
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import cv2
import httpx
import numpy as np
from playwright.async_api import async_playwright

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from app.supabase_client import SupabaseService  # noqa: E402
from scripts.generate_synthetic_yolo import generate_synthetic_yolo_data  # noqa: E402

REF_DB_DIR = BASE_DIR / "app" / "reference_db"
LOGOS_DIR = REF_DB_DIR / "logos"
PORTALS_DIR = REF_DB_DIR / "portals"
DATASET_DIR = BASE_DIR / "storage" / "dataset"
BENIGN_WEB_DIR = DATASET_DIR / "benign_non_tni_web"
POSTERS_BENCH_DIR = DATASET_DIR / "posters_and_scams"

WIKI_HEADERS = {
    "User-Agent": (
        "VisiKartikaShieldDatasetBuilder/2.0 "
        "(https://github.com/DenShubi/Zero-Day-Phising-Shield; cyber-defense-research) httpx/0.28"
    )
}

BLOCKED_PAGE_MARKERS = (
    "internet positif",
    "trustpositif",
    "mercusuar.uzone",
    "uzone.id",
    "403 forbidden",
    "404 not found",
    "502 bad gateway",
    "503 service temporarily",
    "just a moment...",
    "attention required!",
    "access denied",
    "account suspended",
    "cgi-sys/defaultwebpage",
    "apache2 ubuntu default page",
    "welcome to nginx!",
    "index of /",
)

# --------------------------------------------------------------------------- #
# 1. Official Logos (Wikimedia Commons + Portal Header Cropping)
# --------------------------------------------------------------------------- #
LOGO_TARGETS: list[dict[str, Any]] = [
    {"stem": "garuda_pancasila", "brand": "Lambang Negara Garuda Pancasila", "queries": ["National emblem of Indonesia Garuda Pancasila", "Garuda Pancasila coat of arms"]},
    {"stem": "mabes_tni", "brand": "Markas Besar TNI", "queries": ["Seal of the Indonesian National Armed Forces", "Lambang TNI Tentara Nasional Indonesia"]},
    {"stem": "insignia_tniad", "brand": "TNI Angkatan Darat (Kartika Eka Paksi)", "queries": ["Insignia of the Indonesian Army", "Lambang TNI Angkatan Darat Kartika Eka Paksi"]},
    {"stem": "kostrad_tniad", "brand": "Kostrad TNI AD (Cakra)", "queries": ["Insignia of Kostrad", "Lambang Kostrad"]},
    {"stem": "kopassus_tniad", "brand": "Kopassus TNI AD", "queries": ["Insignia of Kopassus", "Lambang Kopassus"]},
    {"stem": "kodiklat_tniad", "brand": "Kodiklat TNI AD", "queries": ["Kodiklat TNI AD", "Lambang Kodiklatad"]},
    {"stem": "puspomad_tniad", "brand": "Puspomad (Polisi Militer TNI AD)", "queries": ["Polisi Militer Angkatan Darat", "Lambang Puspomad"]},
    {"stem": "akmil_magelang", "brand": "Akademi Militer (Akmil) TNI AD", "queries": ["Akademi Militer Magelang", "Logo Akmil"]},
    {"stem": "pusterad_tniad", "brand": "Pusterad TNI AD", "queries": ["Lambang Pusterad", "Pusat Teritorial Angkatan Darat"]},
    {"stem": "secapaad_tniad", "brand": "Secapa TNI AD", "queries": ["Secapa AD", "Sekolah Calon Perwira Angkatan Darat"]},
    {"stem": "kodam_jaya", "brand": "Kodam Jaya / Jayakarta", "queries": ["Kodam Jaya", "Lambang Kodam Jaya Jayakarta"]},
    {"stem": "kodam_siliwangi", "brand": "Kodam III / Siliwangi", "queries": ["Kodam III Siliwangi", "Lambang Kodam Siliwangi"]},
    {"stem": "kodam_diponegoro", "brand": "Kodam IV / Diponegoro", "queries": ["Kodam IV Diponegoro", "Lambang Kodam Diponegoro"]},
    {"stem": "kodam_brawijaya", "brand": "Kodam V / Brawijaya", "queries": ["Kodam V Brawijaya", "Lambang Kodam Brawijaya"]},
    {"stem": "kodam_bukit_barisan", "brand": "Kodam I / Bukit Barisan", "queries": ["Kodam I Bukit Barisan", "Lambang Bukit Barisan"]},
    {"stem": "kodam_sriwijaya", "brand": "Kodam II / Sriwijaya", "queries": ["Kodam II Sriwijaya", "Lambang Kodam Sriwijaya"]},
    {"stem": "kodam_mulawarman", "brand": "Kodam VI / Mulawarman", "queries": ["Kodam VI Mulawarman", "Lambang Kodam Mulawarman"]},
    {"stem": "kodam_udayana", "brand": "Kodam IX / Udayana", "queries": ["Kodam IX Udayana", "Lambang Kodam Udayana"]},
    {"stem": "kodam_hasanuddin", "brand": "Kodam XIV / Hasanuddin", "queries": ["Kodam XIV Hasanuddin", "Lambang Kodam Hasanuddin"]},
    {"stem": "kodam_cenderawasih", "brand": "Kodam XVII / Cenderawasih", "queries": ["Kodam XVII Cenderawasih", "Lambang Kodam Cenderawasih"]},
    {"stem": "kodam_pattimura", "brand": "Kodam XV / Pattimura", "queries": ["Kodam Pattimura", "Lambang Kodam XVI Pattimura"]},
    {"stem": "kodam_tanjungpura", "brand": "Kodam XII / Tanjungpura", "queries": ["Kodam XII Tanjungpura", "Lambang Kodam Tanjungpura"]},
    {"stem": "kodam_iskandar_muda", "brand": "Kodam Iskandar Muda", "queries": ["Kodam Iskandar Muda", "Lambang Iskandar Muda"]},
    {"stem": "kodam_merdeka", "brand": "Kodam XIII / Merdeka", "queries": ["Kodam XIII Merdeka", "Lambang Kodam Merdeka"]},
    {"stem": "kodam_kasuari", "brand": "Kodam XVIII / Kasuari", "queries": ["Kodam XVIII Kasuari", "Lambang Kodam Kasuari"]},
    {"stem": "tni_al", "brand": "TNI Angkatan Laut (Jalesveva Jayamahe)", "queries": ["Insignia of the Indonesian Navy", "Lambang TNI Angkatan Laut"]},
    {"stem": "tni_au", "brand": "TNI Angkatan Udara (Swa Bhuwana Paksa)", "queries": ["Insignia of the Indonesian Air Force", "Lambang TNI Angkatan Udara"]},
    {"stem": "unhan_ri", "brand": "Universitas Pertahanan RI (Unhan)", "queries": ["Universitas Pertahanan Indonesia", "Logo Unhan"]},
    {"stem": "bssn_ri", "brand": "Badan Siber dan Sandi Negara (BSSN)", "queries": ["Badan Siber dan Sandi Negara", "Logo BSSN"]},
    {"stem": "lemhannas_ri", "brand": "Lemhannas RI", "queries": ["Lembaga Ketahanan Nasional", "Logo Lemhannas"]},
    {"stem": "basarnas_ri", "brand": "Basarnas RI", "queries": ["Badan Nasional Pencarian dan Pertolongan", "Logo Basarnas"]},
    {"stem": "bakamla_ri", "brand": "Bakamla RI", "queries": ["Badan Keamanan Laut", "Logo Bakamla"]},
]

# --------------------------------------------------------------------------- #
# 2. Expanded Official Portals (60+ verified `.mil.id`, `.go.id`, `.ac.id` targets)
# --------------------------------------------------------------------------- #
CANDIDATE_OFFICIAL_PORTALS: list[dict[str, Any]] = [
    # Existing & Already-Captured Core Portals
    {"id": "rekrutmen_ad_live", "name": "Portal Rekrutmen Prajurit TNI AD (ad.rekrutmen-tni.mil.id)", "domain": "ad.rekrutmen-tni.mil.id", "url": "https://ad.rekrutmen-tni.mil.id"},
    {"id": "rekrutmen_tni_pusat", "name": "Portal Rekrutmen Terpadu Mabes TNI (rekrutmen-tni.mil.id)", "domain": "rekrutmen-tni.mil.id", "url": "https://rekrutmen-tni.mil.id"},
    {"id": "tniad_main", "name": "Portal Utama TNI Angkatan Darat (tniad.mil.id)", "domain": "tniad.mil.id", "url": "https://tniad.mil.id"},
    {"id": "tniad_ppid", "name": "Portal PPID TNI Angkatan Darat (ppid.tniad.mil.id)", "domain": "ppid.tniad.mil.id", "url": "https://ppid.tniad.mil.id"},
    {"id": "tni_main", "name": "Portal Resmi Markas Besar TNI (tni.mil.id)", "domain": "tni.mil.id", "url": "https://tni.mil.id"},
    {"id": "kemhan_main", "name": "Portal Kementerian Pertahanan RI (www.kemhan.go.id)", "domain": "www.kemhan.go.id", "url": "https://www.kemhan.go.id"},
    {"id": "akmil_main", "name": "Portal Akademi Militer TNI AD (www.akmil.ac.id)", "domain": "www.akmil.ac.id", "url": "https://www.akmil.ac.id"},
    {"id": "unhan_main", "name": "Portal Universitas Pertahanan RI (www.idu.ac.id)", "domain": "www.idu.ac.id", "url": "https://www.idu.ac.id"},
    {"id": "seskoad_main", "name": "Portal Seskoad TNI AD (seskoad.mil.id)", "domain": "seskoad.mil.id", "url": "https://seskoad.mil.id"},
    {"id": "rekrutmen_al", "name": "Portal Rekrutmen Prajurit TNI AL (al.rekrutmen-tni.mil.id)", "domain": "al.rekrutmen-tni.mil.id", "url": "https://al.rekrutmen-tni.mil.id"},
    {"id": "komcad_kemhan", "name": "Portal Komponen Cadangan Kemhan RI (komcad.kemhan.go.id)", "domain": "komcad.kemhan.go.id", "url": "https://komcad.kemhan.go.id"},
    {"id": "kodiklatad_main", "name": "Portal Kodiklat TNI AD (kodiklat-tniad.mil.id)", "domain": "kodiklat-tniad.mil.id", "url": "https://kodiklat-tniad.mil.id"},
    {"id": "pussenarhanud_main", "name": "Portal Pussenarhanud TNI AD (pussenarhanud.mil.id)", "domain": "pussenarhanud.mil.id", "url": "https://pussenarhanud.mil.id"},
    {"id": "secapaad_main", "name": "Portal Sekolah Calon Perwira TNI AD (secapaad.mil.id)", "domain": "secapaad.mil.id", "url": "https://secapaad.mil.id"},
    {"id": "ditajenad_main", "name": "Portal Direktorat Ajudan Jenderal TNI AD (ditajen-tniad.mil.id)", "domain": "ditajen-tniad.mil.id", "url": "https://ditajen-tniad.mil.id"},
    {"id": "ditkumad_main", "name": "Portal Direktorat Hukum TNI AD (ditkumad.mil.id)", "domain": "ditkumad.mil.id", "url": "https://ditkumad.mil.id"},
    {"id": "kodam_jaya", "name": "Portal Resmi Kodam Jaya/Jayakarta (kodamjaya-tniad.mil.id)", "domain": "kodamjaya-tniad.mil.id", "url": "https://kodamjaya-tniad.mil.id"},
    {"id": "poltekad_main", "name": "Portal Politeknik Angkatan Darat (poltekad.ac.id)", "domain": "poltekad.ac.id", "url": "https://poltekad.ac.id"},
    {"id": "kodam_udayana", "name": "Portal Resmi Kodam IX/Udayana (kodam-udayana.mil.id)", "domain": "kodam-udayana.mil.id", "url": "https://kodam-udayana.mil.id"},
    {"id": "tnial_main", "name": "Portal Resmi TNI Angkatan Laut (www.tnial.mil.id)", "domain": "www.tnial.mil.id", "url": "https://www.tnial.mil.id"},
    {"id": "tniau_main", "name": "Portal Resmi TNI Angkatan Udara (tni-au.mil.id)", "domain": "tni-au.mil.id", "url": "https://tni-au.mil.id"},
    {"id": "lemhannas_main", "name": "Portal Lembaga Ketahanan Nasional RI (www.lemhannas.go.id)", "domain": "www.lemhannas.go.id", "url": "https://www.lemhannas.go.id"},
    {"id": "basarnas_main", "name": "Portal Basarnas RI (basarnas.go.id)", "domain": "basarnas.go.id", "url": "https://basarnas.go.id"},
    {"id": "bssn_main", "name": "Portal Badan Siber dan Sandi Negara (www.bssn.go.id)", "domain": "www.bssn.go.id", "url": "https://www.bssn.go.id"},
    {"id": "komdigi_main", "name": "Portal Kementerian Komunikasi dan Digital RI (www.komdigi.go.id)", "domain": "www.komdigi.go.id", "url": "https://www.komdigi.go.id"},
    {"id": "bakamla_main", "name": "Portal Badan Keamanan Laut RI (bakamla.go.id)", "domain": "bakamla.go.id", "url": "https://bakamla.go.id"},

    # Resilient Slow `.mil.id` Targets (Now using 32s commit+settle & www fallbacks)
    {"id": "kostrad_main", "name": "Portal Resmi Kostrad TNI AD (kostrad.mil.id)", "domain": "kostrad.mil.id", "url": "https://kostrad.mil.id"},
    {"id": "kopassus_main", "name": "Portal Resmi Kopassus TNI AD (kopassus.mil.id)", "domain": "kopassus.mil.id", "url": "https://kopassus.mil.id"},
    {"id": "pusterad_main", "name": "Portal Pusat Teritorial TNI AD (pusterad.mil.id)", "domain": "pusterad.mil.id", "url": "https://pusterad.mil.id"},
    {"id": "pussenif_main", "name": "Portal Pusat Kesenjataan Infanteri TNI AD (pussenif.mil.id)", "domain": "pussenif.mil.id", "url": "https://pussenif.mil.id"},
    {"id": "pusziad_main", "name": "Portal Pusat Zeni TNI AD (pusziad.mil.id)", "domain": "pusziad.mil.id", "url": "https://pusziad.mil.id"},
    {"id": "pushubad_main", "name": "Portal Pusat Perhubungan TNI AD (pushubad.mil.id)", "domain": "pushubad.mil.id", "url": "https://pushubad.mil.id"},
    {"id": "puspalad_main", "name": "Portal Pusat Peralatan TNI AD (puspalad.mil.id)", "domain": "puspalad.mil.id", "url": "https://puspalad.mil.id"},
    {"id": "pusbekangad_main", "name": "Portal Pusat Pembekalan Angkutan TNI AD (pusbekangad.mil.id)", "domain": "pusbekangad.mil.id", "url": "https://pusbekangad.mil.id"},
    {"id": "puskesad_main", "name": "Portal Pusat Kesehatan TNI AD (puskesad.mil.id)", "domain": "puskesad.mil.id", "url": "https://puskesad.mil.id"},
    {"id": "disjarahad_main", "name": "Portal Dinas Sejarah TNI AD (disjarah-tniad.mil.id)", "domain": "disjarah-tniad.mil.id", "url": "https://disjarah-tniad.mil.id"},
    {"id": "dislaikad_main", "name": "Portal Dinas Kelaikan TNI AD (dislaikad.mil.id)", "domain": "dislaikad.mil.id", "url": "https://dislaikad.mil.id"},
    {"id": "dislitbangad_main", "name": "Portal Dinas Penelitian dan Pengembangan TNI AD (dislitbang-tniad.mil.id)", "domain": "dislitbang-tniad.mil.id", "url": "https://dislitbang-tniad.mil.id"},
    {"id": "itjenad_main", "name": "Portal Inspektorat Jenderal TNI AD (itjenad.mil.id)", "domain": "itjenad.mil.id", "url": "https://itjenad.mil.id"},

    # Additional Kodam & Sister-Service Units
    {"id": "kodam_bukitbarisan", "name": "Portal Resmi Kodam I/Bukit Barisan (kodam1-bukitbarisan.mil.id)", "domain": "kodam1-bukitbarisan.mil.id", "url": "https://kodam1-bukitbarisan.mil.id"},
    {"id": "kodam_sriwijaya", "name": "Portal Resmi Kodam II/Sriwijaya (kodam-ii-sriwijaya.mil.id)", "domain": "kodam-ii-sriwijaya.mil.id", "url": "https://kodam-ii-sriwijaya.mil.id"},
    {"id": "kodam_hasanuddin", "name": "Portal Resmi Kodam XIV/Hasanuddin (kodam14hasanuddin-tniad.mil.id)", "domain": "kodam14hasanuddin-tniad.mil.id", "url": "https://kodam14hasanuddin-tniad.mil.id"},
    {"id": "kodam_pattimura", "name": "Portal Resmi Kodam XV/Pattimura (kodam16pattimura.mil.id)", "domain": "kodam16pattimura.mil.id", "url": "https://kodam16pattimura.mil.id"},
    {"id": "kodam_cenderawasih", "name": "Portal Resmi Kodam XVII/Cenderawasih (kodam17cenderawasih-tniad.mil.id)", "domain": "kodam17cenderawasih-tniad.mil.id", "url": "https://kodam17cenderawasih-tniad.mil.id"},
    {"id": "kodam_kasuari", "name": "Portal Resmi Kodam XVIII/Kasuari (kodam18kasuari-tniad.mil.id)", "domain": "kodam18kasuari-tniad.mil.id", "url": "https://kodam18kasuari-tniad.mil.id"},
    {"id": "kodam_iskandarmuda", "name": "Portal Resmi Kodam Iskandar Muda (kodamim-tniad.mil.id)", "domain": "kodamim-tniad.mil.id", "url": "https://kodamim-tniad.mil.id"},
    {"id": "akademi_tni", "name": "Portal Resmi Akademi TNI (akademi-tni.mil.id)", "domain": "akademi-tni.mil.id", "url": "https://akademi-tni.mil.id"},
    {"id": "sesko_tni", "name": "Portal Resmi Sesko TNI (sesko-tni.mil.id)", "domain": "sesko-tni.mil.id", "url": "https://sesko-tni.mil.id"},
    {"id": "aau_main", "name": "Portal Akademi Angkatan Udara (aau.ac.id)", "domain": "aau.ac.id", "url": "https://aau.ac.id"},
    {"id": "seskoal_main", "name": "Portal Resmi Seskoal TNI AL (seskoal.ac.id)", "domain": "seskoal.ac.id", "url": "https://seskoal.ac.id"},
    {"id": "kormar_tnial", "name": "Portal Korps Marinir TNI AL (marinir.tnial.mil.id)", "domain": "marinir.tnial.mil.id", "url": "https://marinir.tnial.mil.id"},
    {"id": "pushidrosal_tnial", "name": "Portal Pushidrosal TNI AL (pushidrosal.id)", "domain": "www.pushidrosal.id", "url": "https://www.pushidrosal.id"},

    # Official Kemhan RI Directorates & Strategic Security Portals (Fast & Reliable `.go.id`)
    {"id": "kemhan_pothan", "name": "Ditjen Potensi Pertahanan Kemhan RI (kemhan.go.id/pothan)", "domain": "kemhan.go.id/pothan", "url": "https://www.kemhan.go.id/pothan/"},
    {"id": "kemhan_strahan", "name": "Ditjen Strategi Pertahanan Kemhan RI (kemhan.go.id/strahan)", "domain": "kemhan.go.id/strahan", "url": "https://www.kemhan.go.id/strahan/"},
    {"id": "kemhan_kuathan", "name": "Ditjen Kekuatan Pertahanan Kemhan RI (kemhan.go.id/kuathan)", "domain": "kemhan.go.id/kuathan", "url": "https://www.kemhan.go.id/kuathan/"},
    {"id": "kemhan_baranahan", "name": "Badan Sarana Pertahanan Kemhan RI (kemhan.go.id/baranahan)", "domain": "kemhan.go.id/baranahan", "url": "https://www.kemhan.go.id/baranahan/"},
    {"id": "kemhan_badiklat", "name": "Badan Pendidikan dan Pelatihan Kemhan RI (kemhan.go.id/badiklat)", "domain": "kemhan.go.id/badiklat", "url": "https://www.kemhan.go.id/badiklat/"},
    {"id": "bnpt_goid", "name": "Portal Badan Nasional Penanggulangan Terorisme (bnpt.go.id)", "domain": "www.bnpt.go.id", "url": "https://www.bnpt.go.id"},
    {"id": "polri_penerimaan", "name": "Portal Resmi Penerimaan Anggota Polri (penerimaan.polri.go.id)", "domain": "penerimaan.polri.go.id", "url": "https://penerimaan.polri.go.id"},
    {"id": "polri_main", "name": "Portal Resmi Kepolisian Negara RI (polri.go.id)", "domain": "polri.go.id", "url": "https://polri.go.id"},
]

# --------------------------------------------------------------------------- #
# 3. Real Non-TNI Benign Websites (Target >= 22 live captures)
# --------------------------------------------------------------------------- #
CANDIDATE_BENIGN_WEBSITES: list[dict[str, str]] = [
    {"id": "github_login", "url": "https://github.com/login"},
    {"id": "gitlab_login", "url": "https://gitlab.com/users/sign_in"},
    {"id": "wikipedia_id", "url": "https://id.wikipedia.org/wiki/Halaman_Utama"},
    {"id": "python_org", "url": "https://www.python.org"},
    {"id": "pypi_org", "url": "https://pypi.org"},
    {"id": "mozilla_org", "url": "https://www.mozilla.org/id/"},
    {"id": "openstreetmap", "url": "https://www.openstreetmap.org"},
    {"id": "archive_org", "url": "https://archive.org"},
    {"id": "w3c_org", "url": "https://www.w3.org"},
    {"id": "fastapi_docs", "url": "https://fastapi.tiangolo.com"},
    {"id": "bmkg_goid", "url": "https://www.bmkg.go.id"},
    {"id": "brin_goid", "url": "https://www.brin.go.id"},
    {"id": "bps_goid", "url": "https://www.bps.go.id"},
    {"id": "kemenkeu_goid", "url": "https://www.kemenkeu.go.id"},
    {"id": "kemkes_goid", "url": "https://kemkes.go.id"},
    {"id": "ugm_acid", "url": "https://ugm.ac.id"},
    {"id": "itb_acid", "url": "https://www.itb.ac.id"},
    {"id": "its_acid", "url": "https://www.its.ac.id"},
    {"id": "undip_acid", "url": "https://www.undip.ac.id"},
    {"id": "antaranews", "url": "https://www.antaranews.com"},
    {"id": "kompas_com", "url": "https://www.kompas.com"},
    {"id": "detik_com", "url": "https://www.detik.com"},
    {"id": "liputan6_com", "url": "https://www.liputan6.com"},
    {"id": "djangoproject", "url": "https://www.djangoproject.com"},
    {"id": "nodejs_org", "url": "https://nodejs.org"},
]


def _candidate_urls_for(primary_url: str) -> list[str]:
    """Generate `https://domain`, `https://www.domain`, and `http://domain` fallbacks if DNS resolves."""
    parsed = urlparse(primary_url)
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    if not host:
        return [primary_url]

    bare = host[4:] if host.startswith("www.") else host
    variants = [primary_url]
    alt_www = f"https://www.{bare}{path}"
    alt_bare = f"https://{bare}{path}"
    alt_http = f"http://{host}{path}"
    for v in (alt_www, alt_bare, alt_http):
        if v not in variants:
            variants.append(v)
    return variants


async def _resolve_first_reachable_dns(urls: list[str]) -> list[str]:
    """Filter candidate URLs to only hosts whose DNS actually resolves (avoids 16s browser DNS hangs)."""
    reachable: list[str] = []
    checked_hosts: dict[str, bool] = {}
    for u in urls:
        h = (urlparse(u).hostname or "").lower()
        if not h:
            continue
        if h not in checked_hosts:
            try:
                await asyncio.wait_for(asyncio.to_thread(socket.getaddrinfo, h, None), timeout=2.5)
                checked_hosts[h] = True
            except Exception:
                checked_hosts[h] = False
        if checked_hosts[h]:
            reachable.append(u)
    return reachable


async def _fetch_wikimedia_logo(client: httpx.AsyncClient, queries: list[str], dest: Path) -> bool:
    for query in queries:
        params = {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrnamespace": "6",
            "gsrsearch": query,
            "gsrlimit": "8",
            "prop": "imageinfo",
            "iiprop": "url|mime",
            "iiurlwidth": "320",
        }
        try:
            r = await client.get("https://commons.wikimedia.org/w/api.php", params=params)
            if r.status_code != 200:
                continue
            pages = r.json().get("query", {}).get("pages", {})
            if not pages:
                continue

            ordered_pages = sorted(
                pages.values(),
                key=lambda p: (
                    0 if any(ext in str(p.get("title", "")).lower() for ext in (".svg", ".png")) else 1,
                    p.get("index", 99),
                ),
            )
            for page in ordered_pages:
                title_lower = str(page.get("title", "")).lower()
                if any(bad in title_lower for bad in (".pdf", ".ogg", ".webm", ".jpg", ".jpeg", "map", "commander", "building", "gedung")):
                    continue
                infos = page.get("imageinfo") or []
                if not infos:
                    continue
                thumb_url = infos[0].get("thumburl") or infos[0].get("url")
                if not thumb_url:
                    continue
                img_resp = await client.get(thumb_url)
                if img_resp.status_code != 200 or len(img_resp.content) < 1200:
                    continue
                arr = np.frombuffer(img_resp.content, dtype=np.uint8)
                decoded = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
                if decoded is None or decoded.shape[0] < 40 or decoded.shape[1] < 40:
                    continue
                aspect = float(decoded.shape[1]) / float(max(1, decoded.shape[0]))
                if aspect > 2.4 or aspect < 0.35:
                    continue
                cv2.imwrite(str(dest), decoded)
                return True
        except Exception:
            continue
    return False


async def download_official_logos() -> dict[str, str]:
    LOGOS_DIR.mkdir(parents=True, exist_ok=True)
    # Remove any accidentally cropped Internet Positif icon if present
    (LOGOS_DIR / "portal_puspomad_main_logo.png").unlink(missing_ok=True)

    brand_map: dict[str, str] = {
        "kartika": "TNI AD / Kartika Eka Paksi",
        "logo-tni-ad": "TNI Angkatan Darat (Kartika Eka Paksi)",
        "panpus-logo": "Panpus Penerimaan Prajurit TNI AD",
        "kemhan": "Kementerian Pertahanan RI",
        "logo-seskoad": "SESKOAD TNI Angkatan Darat",
        "rekrutmen-tni": "Portal Rekrutmen TNI",
    }

    print("=" * 76, flush=True)
    print("STEP 1: VERIFYING & DOWNLOADING OFFICIAL LOGOS", flush=True)
    print("=" * 76, flush=True)

    async with httpx.AsyncClient(headers=WIKI_HEADERS, timeout=15.0, follow_redirects=True) as client:
        for item in LOGO_TARGETS:
            stem = item["stem"]
            brand = item["brand"]
            dest = LOGOS_DIR / f"{stem}.png"
            brand_map[stem] = brand
            if dest.exists() and dest.stat().st_size > 1500:
                continue
            ok = await _fetch_wikimedia_logo(client, item["queries"], dest)
            if ok:
                print(f"  [OK]   Downloaded {dest.name} -> {brand} ({dest.stat().st_size // 1024} KB)", flush=True)
            await asyncio.sleep(0.15)

    all_logos = sorted(LOGOS_DIR.glob("*.png"))
    manifest_logos = {p.stem: brand_map.get(p.stem, p.stem.replace("_", " ").title()) for p in all_logos}
    (REF_DB_DIR / "logos_manifest.json").write_text(
        json.dumps(manifest_logos, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"  => Ready Official Logos in {LOGOS_DIR}: {len(all_logos)}", flush=True)
    return manifest_logos


def _is_valid_rendered_screenshot(png_path: Path) -> bool:
    """Reject blank white/black error pages or low-entropy parked pages."""
    if not png_path.exists() or png_path.stat().st_size < 28_000:
        return False
    img = cv2.imread(str(png_path))
    if img is None:
        return False
    return float(np.std(img)) >= 16.0


def _purge_invalid_cached_portals() -> None:
    """Inspect existing `.json` portal metadata and delete any ISP-redirected ('Internet Positif') captures."""
    for jf in list(PORTALS_DIR.glob("*.json")):
        try:
            meta = json.loads(jf.read_text(encoding="utf-8"))
            title_low = str(meta.get("title", "")).lower()
            if any(bad in title_low for bad in BLOCKED_PAGE_MARKERS):
                print(f"  [CLEAN] Removed invalid ISP-blocked capture: {jf.stem} ('{meta.get('title')}')", flush=True)
                jf.unlink(missing_ok=True)
                jf.with_suffix(".png").unlink(missing_ok=True)
        except Exception:
            pass


async def capture_official_portals(brand_map: dict[str, str]) -> list[dict[str, Any]]:
    PORTALS_DIR.mkdir(parents=True, exist_ok=True)
    print("\n" + "=" * 76, flush=True)
    print("STEP 2: CAPTURING OFFICIAL PORTALS (RESILIENT 32s COMMIT + WWW FALLBACK)", flush=True)
    print("=" * 76, flush=True)

    _purge_invalid_cached_portals()

    # Lower concurrency (3) so Indonesian `.mil.id` servers & local ISP DNS aren't saturated
    sem = asyncio.Semaphore(3)

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
        )

        async def _capture_one(meta: dict[str, Any]) -> bool:
            key = meta["id"]
            shot_path = PORTALS_DIR / f"{key}.png"
            json_path = PORTALS_DIR / f"{key}.json"

            if shot_path.exists() and json_path.exists() and shot_path.stat().st_size > 40_000:
                print(f"  [KEEP] {shot_path.name} ({meta['domain']})", flush=True)
                return True

            candidates = await _resolve_first_reachable_dns(_candidate_urls_for(meta["url"]))
            if not candidates:
                print(f"  [DNS]  {meta['domain']} unreachable from current ISP DNS (skipped fast)", flush=True)
                return False

            async with sem:
                for attempt_url in candidates[:2]:
                    ctx = await browser.new_context(
                        viewport={"width": 1280, "height": 720},
                        ignore_https_errors=True,
                        user_agent=(
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/128.0.0.0 Safari/537.36"
                        ),
                    )
                    page = await ctx.new_page()
                    try:
                        # Stage 1: Wait up to 30s for initial HTTP headers ('commit') so slow trackers don't abort goto
                        resp = await page.goto(attempt_url, timeout=30000, wait_until="commit")
                        if resp is not None and resp.status >= 400:
                            await ctx.close()
                            continue

                        # Stage 2: Allow up to 15s for DOMContentLoaded & 8s for subresources (best-effort)
                        try:
                            await page.wait_for_load_state("domcontentloaded", timeout=15000)
                        except Exception:
                            pass
                        try:
                            await page.wait_for_load_state("load", timeout=8000)
                        except Exception:
                            pass

                        # Stage 3: Settle 2500ms for hero banners/sliders
                        await page.wait_for_timeout(2500)

                        final_u = (page.url or "").lower()
                        title = (await page.title() or "").strip()
                        body_sample = await page.evaluate(
                            "() => (document.body ? document.body.innerText.slice(0, 600) : '').toLowerCase()"
                        )
                        combined_check = f"{final_u}\n{title.lower()}\n{body_sample}"
                        if any(bad in combined_check for bad in BLOCKED_PAGE_MARKERS):
                            print(f"  [SKIP] {attempt_url} redirected to block/error page ('{title[:42]}')", flush=True)
                            await ctx.close()
                            continue

                        await page.screenshot(path=str(shot_path), full_page=False)
                        if not _is_valid_rendered_screenshot(shot_path):
                            shot_path.unlink(missing_ok=True)
                            await ctx.close()
                            continue

                        dom_sig = await page.evaluate(
                            """({ portalName, officialDomain }) => ({
                                portal_name: portalName,
                                official_domain: officialDomain,
                                title: document.title || portalName,
                                forms: document.querySelectorAll('form').length,
                                inputs: document.querySelectorAll('input').length,
                                images: document.querySelectorAll('img').length
                            })""",
                            {"portalName": meta["name"], "officialDomain": meta["domain"]},
                        )
                        json_path.write_text(json.dumps(dom_sig, indent=2, ensure_ascii=False), encoding="utf-8")
                        print(f"  [OK]   Captured {shot_path.name} ({attempt_url}) - '{title[:48]}'", flush=True)
                        await ctx.close()
                        return True
                    except Exception:
                        shot_path.unlink(missing_ok=True)
                        await ctx.close()
                        continue

                print(f"  [SKIP] {meta['domain']} timed out after trying {len(candidates[:2])} endpoint(s)", flush=True)
                return False

        await asyncio.gather(*(_capture_one(m) for m in CANDIDATE_OFFICIAL_PORTALS))
        await browser.close()

    all_entries: list[dict[str, Any]] = []
    for json_file in sorted(PORTALS_DIR.glob("*.json")):
        png_file = json_file.with_suffix(".png")
        if not png_file.exists():
            continue
        data = json.loads(json_file.read_text(encoding="utf-8"))
        all_entries.append(
            {
                "id": json_file.stem,
                **data,
                "screenshot": f"app/reference_db/portals/{png_file.name}",
            }
        )

    (REF_DB_DIR / "manifest.json").write_text(
        json.dumps(all_entries, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"  => Total Verified Official Reference Portals in manifest.json: {len(all_entries)}", flush=True)
    return all_entries


async def capture_benign_non_tni_websites() -> int:
    BENIGN_WEB_DIR.mkdir(parents=True, exist_ok=True)
    print("\n" + "=" * 76, flush=True)
    print("STEP 3: TOPPING UP REAL NON-TNI BENIGN WEBSITES (>= 20+ SITES)", flush=True)
    print("=" * 76, flush=True)

    sem = asyncio.Semaphore(4)

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
        )

        async def _grab(item: dict[str, str]) -> bool:
            out_png = BENIGN_WEB_DIR / f"{item['id']}.png"
            if out_png.exists() and out_png.stat().st_size > 28_000:
                return True
            async with sem:
                ctx = await browser.new_context(viewport={"width": 1280, "height": 720}, ignore_https_errors=True)
                page = await ctx.new_page()
                try:
                    resp = await page.goto(item["url"], timeout=22000, wait_until="commit")
                    if resp is not None and resp.status >= 400:
                        return False
                    try:
                        await page.wait_for_load_state("domcontentloaded", timeout=12000)
                    except Exception:
                        pass
                    await page.wait_for_timeout(1500)
                    title = (await page.title() or "").lower()
                    if any(bad in title for bad in BLOCKED_PAGE_MARKERS):
                        return False
                    await page.screenshot(path=str(out_png), full_page=False)
                    if not _is_valid_rendered_screenshot(out_png):
                        out_png.unlink(missing_ok=True)
                        return False
                    print(f"  [OK]   Captured benign web: {out_png.name} ({item['url']})", flush=True)
                    return True
                except Exception:
                    out_png.unlink(missing_ok=True)
                    return False
                finally:
                    await ctx.close()

        await asyncio.gather(*(_grab(it) for it in CANDIDATE_BENIGN_WEBSITES))
        await browser.close()

    total_benign = len(list(BENIGN_WEB_DIR.glob("*.png")))
    print(f"  => Total Benign Non-TNI Web Screenshots in {BENIGN_WEB_DIR}: {total_benign}", flush=True)
    return total_benign


async def main() -> None:
    logos_map = await download_official_logos()
    portals_manifest = await capture_official_portals(logos_map)
    final_logos_count = len(list(LOGOS_DIR.glob("*.png")))
    benign_count = await capture_benign_non_tni_websites()
    posters_count = len(list(POSTERS_BENCH_DIR.glob("*.png")))

    print("\n" + "=" * 76, flush=True)
    print("STEP 4: REFRESHING 50 SYNTHETIC YOLOv8 SAMPLES WITH NEW PORTAL BACKGROUNDS", flush=True)
    print("=" * 76, flush=True)
    yolo_count = generate_synthetic_yolo_data(
        logo_dir=LOGOS_DIR,
        bg_dir=PORTALS_DIR,
        output_dir=BASE_DIR / "storage" / "synthetic_yolo",
        num_samples=50,
    )
    print(f"  => Generated {yolo_count} YOLOv8 training samples across {final_logos_count} logo classes!", flush=True)

    print("\n" + "=" * 76, flush=True)
    print("STEP 5: SYNCING CLEAN OFFICIAL PORTALS TO SUPABASE (`official_portals`)", flush=True)
    print("=" * 76, flush=True)
    if SupabaseService.is_configured():
        # Clean up puspomad.mil.id from Supabase if it was seeded with Internet Positif earlier
        url, key, _, _ = SupabaseService._credentials()
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.delete(
                f"{url}/rest/v1/official_portals?official_domain=eq.puspomad.mil.id",
                headers=SupabaseService._headers(key),
            )
        seed_res = await SupabaseService.seed_official_portals()
        print(
            f"  => Seeded {seed_res.get('seeded_count', 0)} clean official portals to Supabase! "
            f"Errors: {len(seed_res.get('errors', []))}",
            flush=True,
        )

    print("\n" + "=" * 76, flush=True)
    print("RINGKASAN AKHIR EKSPANSI DATASET VISIKARTIKA SHIELD (v2)", flush=True)
    print("=" * 76, flush=True)
    print(f"  1. Logo Resmi Pertahanan/TNI/Siber (`app/reference_db/logos/`)  : {final_logos_count} PNG", flush=True)
    print(f"  2. Tangkapan Layar Portal Resmi (`app/reference_db/portals/`)   : {len(portals_manifest)} Portal", flush=True)
    print(f"  3. Tangkapan Layar Web Umum Non-TNI (`storage/dataset/benign_*`): {benign_count} Situs", flush=True)
    print(f"  4. Poster Resmi, Umum & Scam (`storage/dataset/posters_*`)      : {posters_count} Poster", flush=True)
    print(f"  5. Dataset Sintetis YOLOv8 (`storage/synthetic_yolo/`)          : {yolo_count} Sampel", flush=True)
    print("=" * 76, flush=True)


if __name__ == "__main__":
    asyncio.run(main())
