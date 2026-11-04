"""
Kompilator Dokumen Laporan Teknis (.docx & .pdf) - Gaya Cetak Editorial / Booktabs
VisiKartika Shield - Kartika Cyber Hackathon 2026 (PUSSIBERAD TNI AD)

Menghasilkan berkas Microsoft Word (.docx) dan PDF A4 (.pdf) dengan tipografi
jurnal rekayasa (serif Georgia/Times untuk narasi, sans-serif tegas untuk subjudul
dan tabel booktabs tanpa garis vertikal, tanpa banner dekoratif, dan tanpa dependensi
tambahan di luar pustaka yang sudah terpasang).
"""

from __future__ import annotations

import datetime as dt
import os
import re
import struct
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple
from xml.sax.saxutils import escape as xml_escape

import cv2


# ============================================================================
# 1. STRUKTUR DATA DOKUMEN
# ============================================================================


@dataclass
class InlineSpan:
    text: str
    bold: bool = False
    italic: bool = False
    code: bool = False
    href: Optional[str] = None


@dataclass
class DocBlock:
    kind: str  # h2, h3, para, bullet, numbered, quote, formula, table, image
    text: str = ""
    spans: List[InlineSpan] = field(default_factory=list)
    num_label: str = ""
    headers: List[str] = field(default_factory=list)
    alignments: List[str] = field(default_factory=list)
    rows: List[List[str]] = field(default_factory=list)
    img_path: Optional[Path] = None
    fig_num: int = 0
    caption: str = ""


@dataclass
class ParsedDocument:
    title: str
    metadata: List[Tuple[str, str]]
    blocks: List[DocBlock]


# ============================================================================
# 2. PARSER MARKDOWN BERSIH
# ============================================================================

_OUTER_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_LEAF_TOKEN_RE = re.compile(
    r"(`[^`]+`)"
    r"|(\*[^*\n]+\*)"
    r"|(\[[^\]]+\]\([^)]+\))"
    r"|(https?://[^\s)]+)"
)


def clean_tex_math(raw: str) -> str:
    s = raw.strip()
    s = s.replace("$$", "").replace("$", "")
    s = re.sub(r"\\text\{([^}]*)\}", r"\1", s)
    s = s.replace(r"\times", "×")
    s = s.replace(r"\notin", "bukan anggota")
    s = s.replace(r"\rightarrow", "->")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_inline_math(text: str) -> str:
    def _sub(m: re.Match) -> str:
        return clean_tex_math(m.group(1))

    out = re.sub(r"\$([^$\n]+)\$", _sub, text)
    out = out.replace("<br>", "; ").replace("<br/>", "; ")
    out = out.replace("—", ", ").replace("–", "-")
    return out


def _parse_leaf_spans(segment: str, inherited_bold: bool = False) -> List[InlineSpan]:
    spans: List[InlineSpan] = []
    pos = 0
    for m in _LEAF_TOKEN_RE.finditer(segment):
        if m.start() > pos:
            spans.append(InlineSpan(text=segment[pos : m.start()], bold=inherited_bold))
        tok = m.group(0)
        if tok.startswith("`") and tok.endswith("`"):
            spans.append(InlineSpan(text=tok[1:-1], bold=inherited_bold, code=True))
        elif tok.startswith("*") and tok.endswith("*"):
            spans.append(InlineSpan(text=tok[1:-1], bold=inherited_bold, italic=True))
        elif tok.startswith("[") and "](" in tok:
            lbl, url = tok[1:-1].split("](", 1)
            spans.append(InlineSpan(text=lbl, bold=inherited_bold, href=url))
        elif tok.startswith("http://") or tok.startswith("https://"):
            spans.append(InlineSpan(text=tok, bold=inherited_bold, href=tok))
        pos = m.end()
    if pos < len(segment):
        spans.append(InlineSpan(text=segment[pos:], bold=inherited_bold))
    return [s for s in spans if s.text]


def parse_inline_spans(text: str) -> List[InlineSpan]:
    text = normalize_inline_math(text)
    spans: List[InlineSpan] = []
    pos = 0
    for m in _OUTER_BOLD_RE.finditer(text):
        if m.start() > pos:
            spans.extend(_parse_leaf_spans(text[pos : m.start()], inherited_bold=False))
        spans.extend(_parse_leaf_spans(m.group(1), inherited_bold=True))
        pos = m.end()
    if pos < len(text):
        spans.extend(_parse_leaf_spans(text[pos:], inherited_bold=False))
    return [s for s in spans if s.text]


def strip_markdown_plain(text: str) -> str:
    return "".join(s.text for s in parse_inline_spans(text))


def _split_table_row(line: str) -> List[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def parse_markdown_file(md_path: Path) -> ParsedDocument:
    lines = md_path.read_text(encoding="utf-8").splitlines()
    base_dir = md_path.parent

    title = md_path.stem
    metadata: List[Tuple[str, str]] = []
    blocks: List[DocBlock] = []

    idx = 0
    n = len(lines)

    while idx < n:
        ln = lines[idx].strip()
        if ln.startswith("# "):
            title = strip_markdown_plain(ln[2:].strip())
            idx += 1
            break
        idx += 1

    while idx < n:
        raw = lines[idx].strip()
        if not raw:
            idx += 1
            continue
        if raw.startswith("---") or raw.startswith("## "):
            if raw.startswith("---"):
                idx += 1
            break
        m_meta = re.match(r"^\*\*([^*:]+):\*\*\s*(.+)$", raw)
        if m_meta:
            k = strip_markdown_plain(m_meta.group(1).strip())
            v = strip_markdown_plain(m_meta.group(2).strip())
            metadata.append((k, v))
            idx += 1
        else:
            break

    fig_counter = 0
    while idx < n:
        line = lines[idx]
        stripped = line.strip()

        if not stripped or stripped == "---":
            idx += 1
            continue

        if stripped.startswith("$$"):
            formula_buf = [stripped]
            if not (stripped.endswith("$$") and len(stripped) > 4):
                idx += 1
                while idx < n:
                    formula_buf.append(lines[idx].strip())
                    if lines[idx].strip().endswith("$$"):
                        break
                    idx += 1
            blocks.append(DocBlock(kind="formula", text=clean_tex_math(" ".join(formula_buf))))
            idx += 1
            continue

        m_img = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)$", stripped)
        if m_img:
            fig_counter += 1
            cap = m_img.group(1).strip()
            rel_p = m_img.group(2).strip()
            resolved = (base_dir / rel_p).resolve()
            blocks.append(DocBlock(kind="image", img_path=resolved, fig_num=fig_counter, caption=cap))
            idx += 1
            continue

        if stripped.startswith("### "):
            txt = strip_markdown_plain(stripped[4:].strip())
            blocks.append(DocBlock(kind="h3", text=txt, spans=parse_inline_spans(stripped[4:].strip())))
            idx += 1
            continue

        if stripped.startswith("## "):
            txt = strip_markdown_plain(stripped[3:].strip())
            blocks.append(DocBlock(kind="h2", text=txt, spans=parse_inline_spans(stripped[3:].strip())))
            idx += 1
            continue

        if stripped.startswith("|") and (idx + 1 < n) and re.match(r"^\|?\s*:?-{2,}", lines[idx + 1].strip()):
            headers = _split_table_row(stripped)
            sep_cells = _split_table_row(lines[idx + 1].strip())
            aligns: List[str] = []
            for sc in sep_cells:
                sc_t = sc.strip()
                if sc_t.startswith(":") and sc_t.endswith(":"):
                    aligns.append("center")
                elif sc_t.endswith(":"):
                    aligns.append("right")
                else:
                    aligns.append("left")
            while len(aligns) < len(headers):
                aligns.append("left")

            idx += 2
            t_rows: List[List[str]] = []
            while idx < n and lines[idx].strip().startswith("|"):
                row_cells = _split_table_row(lines[idx].strip())
                if len(row_cells) < len(headers):
                    row_cells += [""] * (len(headers) - len(row_cells))
                t_rows.append(row_cells[: len(headers)])
                idx += 1
            blocks.append(DocBlock(kind="table", headers=headers, alignments=aligns, rows=t_rows))
            continue

        if stripped.startswith(">"):
            q_parts: List[str] = []
            while idx < n and lines[idx].strip().startswith(">"):
                q_line = re.sub(r"^>\s?", "", lines[idx].strip()).strip()
                if q_line:
                    q_parts.append(q_line)
                idx += 1
            joined_q = " ".join(q_parts)
            blocks.append(DocBlock(kind="quote", text=joined_q, spans=parse_inline_spans(joined_q)))
            continue

        m_bul = re.match(r"^[-*]\s+(.+)$", stripped)
        if m_bul:
            b_txt = m_bul.group(1).strip()
            blocks.append(DocBlock(kind="bullet", text=b_txt, spans=parse_inline_spans(b_txt)))
            idx += 1
            continue

        m_num = re.match(r"^(\d+\.)\s+(.+)$", stripped)
        if m_num:
            n_lbl = m_num.group(1)
            n_txt = m_num.group(2).strip()
            blocks.append(DocBlock(kind="numbered", num_label=n_lbl, text=n_txt, spans=parse_inline_spans(n_txt)))
            idx += 1
            continue

        p_parts = [stripped]
        idx += 1
        while idx < n:
            nxt = lines[idx].strip()
            if (
                not nxt
                or nxt == "---"
                or nxt.startswith("#")
                or nxt.startswith("|")
                or nxt.startswith(">")
                or nxt.startswith("$$")
                or nxt.startswith("![")
                or re.match(r"^[-*]\s+", nxt)
                or re.match(r"^\d+\.\s+", nxt)
            ):
                break
            p_parts.append(nxt)
            idx += 1
        joined_p = " ".join(p_parts)
        blocks.append(DocBlock(kind="para", text=joined_p, spans=parse_inline_spans(joined_p)))

    return ParsedDocument(title=title, metadata=metadata, blocks=blocks)


# ============================================================================
# 3. KOMPILATOR MICROSOFT WORD (.DOCX) - GAYA EDITORIAL / BOOKTABS
# ============================================================================


def _png_dimensions(png_bytes: bytes) -> Tuple[int, int]:
    if png_bytes[:8] == b"\x89PNG\r\n\x1a\n" and png_bytes[12:16] == b"IHDR":
        w, h = struct.unpack(">II", png_bytes[16:24])
        return int(w), int(h)
    return 1280, 720


def _compute_col_weights(headers: List[str], rows: List[List[str]]) -> List[float]:
    ncols = len(headers)
    max_lens = [max(len(strip_markdown_plain(h)), 5) for h in headers]
    for r in rows:
        for ci in range(min(ncols, len(r))):
            ln = len(strip_markdown_plain(r[ci]))
            if ln > max_lens[ci]:
                max_lens[ci] = ln
    weights = [max(7.5, (float(ml) ** 0.56)) for ml in max_lens]
    total = sum(weights) or 1.0
    return [w / total for w in weights]


class DocxCompiler:
    """Menghasilkan berkas .docx bersih bergaya makalah rekayasa (Georgia + Segoe UI + Booktabs)."""

    CONTENT_DXA = 9350  # A4 11906 dxa dikurangi margin kiri/kanan 1278 dxa (~22,5 mm)

    def __init__(self, doc: ParsedDocument, header_label: str) -> None:
        self.doc = doc
        self.header_label = header_label
        self.rels: List[Tuple[str, str, str, Optional[str]]] = []
        self.media_files: List[Tuple[str, bytes]] = []
        self._rel_counter = 10
        self._docpr_id = 1

    def _add_rel(self, rel_type: str, target: str, target_mode: Optional[str] = None) -> str:
        rid = f"rId{self._rel_counter}"
        self._rel_counter += 1
        self.rels.append((rid, rel_type, target, target_mode))
        return rid

    def _runs_xml(
        self,
        spans: List[InlineSpan],
        font_family: str = "Georgia",
        default_color: str = "111827",
        default_sz_hp: int = 21,
        force_bold: bool = False,
    ) -> str:
        out: List[str] = []
        for sp in spans:
            t_esc = xml_escape(sp.text)
            space_attr = ' xml:space="preserve"' if (sp.text.startswith(" ") or sp.text.endswith(" ")) else ""
            rpr: List[str] = []
            if sp.code:
                rpr.append('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>')
                rpr.append(f'<w:sz w:val="{max(16, default_sz_hp - 3)}"/>')
                rpr.append(f'<w:szCs w:val="{max(16, default_sz_hp - 3)}"/>')
                rpr.append('<w:color w:val="1F2937"/>')
            else:
                rpr.append(f'<w:rFonts w:ascii="{font_family}" w:hAnsi="{font_family}" w:cs="{font_family}"/>')
                rpr.append(f'<w:sz w:val="{default_sz_hp}"/>')
                rpr.append(f'<w:szCs w:val="{default_sz_hp}"/>')
                col = "183923" if sp.href else default_color
                rpr.append(f'<w:color w:val="{col}"/>')
            if sp.bold or force_bold:
                rpr.append("<w:b/>")
            if sp.italic:
                rpr.append("<w:i/>")
            if sp.href:
                rpr.append('<w:u w:val="single"/>')

            run_xml = f"<w:r><w:rPr>{''.join(rpr)}</w:rPr><w:t{space_attr}>{t_esc}</w:t></w:r>"
            if sp.href:
                rid = self._add_rel(
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
                    sp.href,
                    "External",
                )
                out.append(f'<w:hyperlink r:id="{rid}">{run_xml}</w:hyperlink>')
            else:
                out.append(run_xml)
        return "".join(out)

    def _para_xml(
        self,
        spans: List[InlineSpan],
        font_family: str = "Georgia",
        jc: str = "both",
        before_dxa: int = 0,
        after_dxa: int = 140,
        line_dxa: int = 312,
        sz_hp: int = 21,
        color: str = "111827",
        bold: bool = False,
        keep_next: bool = False,
        left_indent: int = 0,
        right_indent: int = 0,
        hanging: int = 0,
        bottom_border: Optional[Tuple[str, int]] = None,
    ) -> str:
        ppr: List[str] = [f'<w:jc w:val="{jc}"/>']
        ppr.append(f'<w:spacing w:before="{before_dxa}" w:after="{after_dxa}" w:line="{line_dxa}" w:lineRule="auto"/>')
        if keep_next:
            ppr.append("<w:keepNext/>")
        if left_indent or right_indent or hanging:
            attrs: List[str] = []
            if left_indent:
                attrs.append(f'w:left="{left_indent}"')
            if right_indent:
                attrs.append(f'w:right="{right_indent}"')
            if hanging:
                attrs.append(f'w:hanging="{hanging}"')
            ppr.append(f"<w:ind {' '.join(attrs)}/>")
        if bottom_border:
            bcol, bsz = bottom_border
            ppr.append(
                f'<w:pBdr><w:bottom w:val="single" w:sz="{bsz}" w:space="6" w:color="{bcol}"/></w:pBdr>'
            )
        runs = self._runs_xml(
            spans,
            font_family=font_family,
            default_color=color,
            default_sz_hp=sz_hp,
            force_bold=bold,
        )
        return f"<w:p><w:pPr>{''.join(ppr)}</w:pPr>{runs}</w:p>"

    def _masthead_xml(self) -> str:
        parts: List[str] = []
        parts.append(
            self._para_xml(
                [InlineSpan(text=self.doc.title, bold=True)],
                font_family="Segoe UI",
                jc="left",
                before_dxa=0,
                after_dxa=120,
                line_dxa=340,
                sz_hp=32,
                color="111827",
                bold=True,
                bottom_border=("183923", 12),
            )
        )

        if self.doc.metadata:
            trs: List[str] = []
            for mk, mv in self.doc.metadata:
                k_runs = self._runs_xml(
                    [InlineSpan(text=mk, bold=True)],
                    font_family="Segoe UI",
                    default_color="374151",
                    default_sz_hp=18,
                )
                v_runs = self._runs_xml(
                    parse_inline_spans(mv),
                    font_family="Segoe UI",
                    default_color="111827",
                    default_sz_hp=18,
                )
                trs.append(
                    f"""
                    <w:tr>
                      <w:trPr><w:cantSplit/></w:trPr>
                      <w:tc>
                        <w:tcPr><w:tcW w:w="2350" w:type="dxa"/></w:tcPr>
                        <w:p><w:pPr><w:spacing w:before="25" w:after="25"/></w:pPr>{k_runs}</w:p>
                      </w:tc>
                      <w:tc>
                        <w:tcPr><w:tcW w:w="7000" w:type="dxa"/></w:tcPr>
                        <w:p><w:pPr><w:spacing w:before="25" w:after="25"/></w:pPr>{v_runs}</w:p>
                      </w:tc>
                    </w:tr>
                    """
                )
            parts.append(
                f"""
                <w:tbl>
                  <w:tblPr>
                    <w:tblW w:w="{self.CONTENT_DXA}" w:type="dxa"/>
                    <w:tblBorders>
                      <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                      <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                      <w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
                      <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                      <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                      <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                    </w:tblBorders>
                    <w:tblCellMar>
                      <w:top w:w="30" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>
                      <w:bottom w:w="30" w:type="dxa"/><w:right w:w="80" w:type="dxa"/>
                    </w:tblCellMar>
                  </w:tblPr>
                  <w:tblGrid><w:gridCol w:w="2350"/><w:gridCol w:w="7000"/></w:tblGrid>
                  {"".join(trs)}
                </w:tbl>
                """
            )

        parts.append('<w:p><w:pPr><w:spacing w:before="60" w:after="80"/></w:pPr></w:p>')
        return "".join(parts)

    def _table_booktabs_xml(self, blk: DocBlock) -> str:
        total_dxa = self.CONTENT_DXA
        weights = _compute_col_weights(blk.headers, blk.rows)
        col_widths = [max(720, int(round(w * total_dxa))) for w in weights]
        col_widths[-1] = max(720, col_widths[-1] + (total_dxa - sum(col_widths)))

        grid = "".join(f'<w:gridCol w:w="{cw}"/>' for cw in col_widths)
        trs: List[str] = []

        # Booktabs Header Row (plain white background, strong bottom rule, zero vertical borders)
        h_cells: List[str] = []
        for ci, h_txt in enumerate(blk.headers):
            al = blk.alignments[ci] if ci < len(blk.alignments) else "left"
            jc = "center" if al == "center" else ("right" if al == "right" else "left")
            h_runs = self._runs_xml(
                parse_inline_spans(h_txt),
                font_family="Segoe UI",
                default_color="111827",
                default_sz_hp=18,
                force_bold=True,
            )
            h_cells.append(
                f"""
                <w:tc>
                  <w:tcPr>
                    <w:tcW w:w="{col_widths[ci]}" w:type="dxa"/>
                    <w:tcBorders>
                      <w:top w:val="single" w:sz="10" w:space="0" w:color="111827"/>
                      <w:bottom w:val="single" w:sz="8" w:space="0" w:color="111827"/>
                    </w:tcBorders>
                    <w:vAlign w:val="bottom"/>
                  </w:tcPr>
                  <w:p><w:pPr><w:jc w:val="{jc}"/><w:spacing w:before="45" w:after="45" w:line="235" w:lineRule="auto"/></w:pPr>{h_runs}</w:p>
                </w:tc>
                """
            )
        trs.append(f"<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>{''.join(h_cells)}</w:tr>")

        last_ri = len(blk.rows) - 1
        for ri, row in enumerate(blk.rows):
            b_cells: List[str] = []
            bot_bdr = (
                '<w:bottom w:val="single" w:sz="10" w:space="0" w:color="111827"/>'
                if ri == last_ri
                else '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="E5E7EB"/>'
            )
            for ci, cell_txt in enumerate(row):
                al = blk.alignments[ci] if ci < len(blk.alignments) else "left"
                jc = "center" if al == "center" else ("right" if al == "right" else "left")
                c_runs = self._runs_xml(
                    parse_inline_spans(cell_txt),
                    font_family="Segoe UI",
                    default_color="1F2937",
                    default_sz_hp=17,
                )
                b_cells.append(
                    f"""
                    <w:tc>
                      <w:tcPr>
                        <w:tcW w:w="{col_widths[ci]}" w:type="dxa"/>
                        <w:tcBorders>{bot_bdr}</w:tcBorders>
                        <w:vAlign w:val="top"/>
                      </w:tcPr>
                      <w:p><w:pPr><w:jc w:val="{jc}"/><w:spacing w:before="40" w:after="40" w:line="235" w:lineRule="auto"/></w:pPr>{c_runs}</w:p>
                    </w:tc>
                    """
                )
            trs.append(f"<w:tr><w:trPr><w:cantSplit/></w:trPr>{''.join(b_cells)}</w:tr>")

        return (
            f"""
            <w:tbl>
              <w:tblPr>
                <w:tblW w:w="{total_dxa}" w:type="dxa"/>
                <w:tblBorders>
                  <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                  <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                  <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                  <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                  <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                  <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                </w:tblBorders>
                <w:tblCellMar>
                  <w:top w:w="65" w:type="dxa"/><w:left w:w="90" w:type="dxa"/>
                  <w:bottom w:w="65" w:type="dxa"/><w:right w:w="90" w:type="dxa"/>
                </w:tblCellMar>
              </w:tblPr>
              <w:tblGrid>{grid}</w:tblGrid>
              {"".join(trs)}
            </w:tbl>
            """
            + '<w:p><w:pPr><w:spacing w:before="40" w:after="100"/></w:pPr></w:p>'
        )

    def _image_xml(self, blk: DocBlock) -> str:
        if not blk.img_path or not blk.img_path.exists():
            return ""
        raw_bytes = blk.img_path.read_bytes()
        img_idx = len(self.media_files) + 1
        media_name = f"image{img_idx}.png"
        self.media_files.append((f"word/media/{media_name}", raw_bytes))
        rid = self._add_rel(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
            f"media/{media_name}",
        )

        px_w, px_h = _png_dimensions(raw_bytes)
        max_cx = 5900000  # ~6.45 inches
        max_cy = 3250000  # ~3.55 inches
        scale = min(max_cx / max(px_w, 1), max_cy / max(px_h, 1))
        cx = int(px_w * scale)
        cy = int(px_h * scale)

        doc_id = self._docpr_id
        self._docpr_id += 1
        cap_plain = f"Gambar {blk.fig_num}. {blk.caption}".strip()

        drawing_p = f"""
        <w:p>
          <w:pPr><w:jc w:val="center"/><w:keepNext/><w:spacing w:before="140" w:after="60"/></w:pPr>
          <w:r>
            <w:drawing>
              <wp:inline distT="0" distB="0" distL="0" distR="0"
                xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
                <wp:extent cx="{cx}" cy="{cy}"/>
                <wp:docPr id="{doc_id}" name="Figure {doc_id}" descr="{xml_escape(cap_plain)}"/>
                <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                      <pic:nvPicPr>
                        <pic:cNvPr id="{doc_id}" name="{media_name}"/>
                        <pic:cNvPicPr/>
                      </pic:nvPicPr>
                      <pic:blipFill>
                        <a:blip r:embed="{rid}"/>
                        <a:stretch><a:fillRect/></a:stretch>
                      </pic:blipFill>
                      <pic:spPr>
                        <a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>
                        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                        <a:ln w="6350">
                          <a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill>
                        </a:ln>
                      </pic:spPr>
                    </pic:pic>
                  </a:graphicData>
                </a:graphic>
              </wp:inline>
            </w:drawing>
          </w:r>
        </w:p>
        """
        cap_spans = [InlineSpan(text=f"Gambar {blk.fig_num}. ", bold=True)] + parse_inline_spans(blk.caption)
        cap_p = self._para_xml(
            cap_spans,
            font_family="Segoe UI",
            jc="left",
            before_dxa=20,
            after_dxa=180,
            line_dxa=245,
            sz_hp=17,
            color="374151",
            left_indent=240,
            right_indent=240,
        )
        return drawing_p + cap_p

    def save(self, out_path: Path) -> None:
        hdr_rid = self._add_rel(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
            "header1.xml",
        )
        ftr_rid = self._add_rel(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
            "footer1.xml",
        )

        body_parts: List[str] = [self._masthead_xml()]

        for blk in self.doc.blocks:
            if blk.kind == "h2":
                body_parts.append(
                    self._para_xml(
                        [InlineSpan(text=blk.text, bold=True)],
                        font_family="Segoe UI",
                        jc="left",
                        before_dxa=280,
                        after_dxa=100,
                        line_dxa=280,
                        sz_hp=25,
                        color="111827",
                        bold=True,
                        keep_next=True,
                    )
                )
            elif blk.kind == "h3":
                body_parts.append(
                    self._para_xml(
                        blk.spans,
                        font_family="Segoe UI",
                        jc="left",
                        before_dxa=200,
                        after_dxa=75,
                        line_dxa=260,
                        sz_hp=21,
                        color="1F2937",
                        bold=True,
                        keep_next=True,
                    )
                )
            elif blk.kind == "para":
                body_parts.append(self._para_xml(blk.spans, font_family="Georgia", jc="both", before_dxa=0, after_dxa=135))
            elif blk.kind == "bullet":
                b_spans = [InlineSpan(text="•  ")] + blk.spans
                body_parts.append(
                    self._para_xml(
                        b_spans,
                        font_family="Georgia",
                        jc="both",
                        before_dxa=20,
                        after_dxa=80,
                        left_indent=360,
                        hanging=200,
                    )
                )
            elif blk.kind == "numbered":
                n_spans = [InlineSpan(text=f"{blk.num_label} ")] + blk.spans
                body_parts.append(
                    self._para_xml(
                        n_spans,
                        font_family="Georgia",
                        jc="both",
                        before_dxa=20,
                        after_dxa=80,
                        left_indent=380,
                        hanging=240,
                    )
                )
            elif blk.kind == "quote":
                body_parts.append(
                    self._para_xml(
                        blk.spans,
                        font_family="Georgia",
                        jc="both",
                        before_dxa=80,
                        after_dxa=120,
                        sz_hp=20,
                        color="374151",
                        left_indent=420,
                        right_indent=240,
                    )
                )
            elif blk.kind == "formula":
                body_parts.append(
                    self._para_xml(
                        [InlineSpan(text=blk.text, italic=True)],
                        font_family="Georgia",
                        jc="center",
                        before_dxa=120,
                        after_dxa=140,
                        sz_hp=21,
                        color="111827",
                    )
                )
            elif blk.kind == "table":
                body_parts.append(self._table_booktabs_xml(blk))
            elif blk.kind == "image":
                body_parts.append(self._image_xml(blk))

        sect_pr = f"""
        <w:sectPr>
          <w:headerReference w:type="default" r:id="{hdr_rid}"/>
          <w:footerReference w:type="default" r:id="{ftr_rid}"/>
          <w:pgSz w:w="11906" w:h="16838"/>
          <w:pgMar w:top="1240" w:right="1278" w:bottom="1240" w:left="1278" w:header="700" w:footer="700" w:gutter="0"/>
          <w:titlePg/>
        </w:sectPr>
        """

        document_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f"<w:body>{''.join(body_parts)}{sect_pr}</w:body></w:document>"
        )

        styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/>
        <w:sz w:val="21"/><w:szCs w:val="21"/>
        <w:color w:val="111827"/>
        <w:lang w:val="id-ID"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>"""

        settings_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:compat>
    <w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>
  </w:compat>
</w:settings>"""

        header1_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:jc w:val="right"/>
      <w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="CBD5E1"/></w:pBdr>
    </w:pPr>
    <w:r>
      <w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/><w:sz w:val="16"/><w:color w:val="4B5563"/></w:rPr>
      <w:t>{xml_escape(self.header_label)}</w:t>
    </w:r>
  </w:p>
</w:hdr>"""

        footer1_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:tabs><w:tab w:val="right" w:pos="{self.CONTENT_DXA}"/></w:tabs>
    </w:pPr>
    <w:r>
      <w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/><w:sz w:val="16"/><w:color w:val="4B5563"/></w:rPr>
      <w:t>Kartika Cyber Hackathon 2026 - PUSSIBERAD TNI AD</w:t>
    </w:r>
    <w:r><w:tab/></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:rPr><w:sz w:val="16"/><w:color w:val="111827"/></w:rPr><w:t>1</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:ftr>"""

        doc_rels_items = [
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
        ]
        for rid, rtype, target, tmode in self.rels:
            mode_attr = f' TargetMode="{tmode}"' if tmode else ""
            doc_rels_items.append(
                f'<Relationship Id="{rid}" Type="{rtype}" Target="{xml_escape(target)}"{mode_attr}/>'
            )
        doc_rels_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f"{''.join(doc_rels_items)}</Relationships>"
        )

        root_rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""

        content_types_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""

        now_iso = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        core_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{xml_escape(self.doc.title)}</dc:title>
  <dc:creator>Zuan &amp; Denin</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now_iso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now_iso}</dcterms:modified>
</cp:coreProperties>"""

        app_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>VisiKartika Editorial Typesetter</Application>
</Properties>"""

        out_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("[Content_Types].xml", content_types_xml)
            zf.writestr("_rels/.rels", root_rels_xml)
            zf.writestr("docProps/core.xml", core_xml)
            zf.writestr("docProps/app.xml", app_xml)
            zf.writestr("word/document.xml", document_xml)
            zf.writestr("word/styles.xml", styles_xml)
            zf.writestr("word/settings.xml", settings_xml)
            zf.writestr("word/header1.xml", header1_xml)
            zf.writestr("word/footer1.xml", footer1_xml)
            zf.writestr("word/_rels/document.xml.rels", doc_rels_xml)
            for m_path, m_bytes in self.media_files:
                zf.writestr(m_path, m_bytes)


# ============================================================================
# 4. KOMPILATOR PDF A4 - GAYA MAKALAH TEKNIS / BOOKTABS
# ============================================================================

# Lebar karakter standar Adobe AFM (per 1000 em) untuk Times-Roman & Helvetica
_TIMES_W = {
    " ": 250, "!": 333, '"': 408, "#": 500, "$": 500, "%": 833, "&": 778, "'": 180,
    "(": 333, ")": 333, "*": 500, "+": 564, ",": 250, "-": 333, ".": 250, "/": 278,
    "0": 500, "1": 500, "2": 500, "3": 500, "4": 500, "5": 500, "6": 500, "7": 500,
    "8": 500, "9": 500, ":": 278, ";": 278, "<": 564, "=": 564, ">": 564, "?": 444,
    "@": 921, "A": 722, "B": 667, "C": 667, "D": 722, "E": 611, "F": 556, "G": 722,
    "H": 722, "I": 333, "J": 389, "K": 722, "L": 611, "M": 889, "N": 722, "O": 722,
    "P": 556, "Q": 722, "R": 667, "S": 556, "T": 611, "U": 722, "V": 722, "W": 944,
    "X": 722, "Y": 722, "Z": 611, "[": 333, "\\": 278, "]": 333, "^": 469, "_": 500,
    "a": 444, "b": 500, "c": 444, "d": 500, "e": 444, "f": 333, "g": 500, "h": 500,
    "i": 278, "j": 278, "k": 500, "l": 278, "m": 778, "n": 500, "o": 500, "p": 500,
    "q": 500, "r": 333, "s": 389, "t": 278, "u": 500, "v": 500, "w": 722, "x": 500,
    "y": 500, "z": 444, "{": 480, "|": 200, "}": 480, "~": 541, "•": 350, "×": 564,
}

_HELV_W = {
    " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191,
    "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
    "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
    "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
    "@": 1015, "A": 667, "B": 667, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778,
    "H": 722, "I": 278, "J": 500, "K": 667, "L": 556, "M": 833, "N": 722, "O": 778,
    "P": 667, "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722, "V": 667, "W": 944,
    "X": 667, "Y": 667, "Z": 611, "[": 278, "\\": 278, "]": 278, "^": 469, "_": 556,
    "a": 556, "b": 556, "c": 500, "d": 556, "e": 556, "f": 278, "g": 556, "h": 556,
    "i": 222, "j": 222, "k": 500, "l": 222, "m": 833, "n": 556, "o": 556, "p": 556,
    "q": 556, "r": 333, "s": 500, "t": 278, "u": 556, "v": 500, "w": 722, "x": 500,
    "y": 500, "z": 500, "{": 334, "|": 260, "}": 334, "~": 584, "•": 350, "×": 584,
}


def _sanitize_winansi(text: str) -> str:
    replacements = {
        "∉": "bukan anggota",
        "≥": ">=",
        "≤": "<=",
        "→": "->",
        "—": ", ",
        "–": "-",
        "“": '"',
        "”": '"',
        "‘": "'",
        "’": "'",
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    out: List[str] = []
    for ch in text:
        try:
            ch.encode("cp1252")
            out.append(ch)
        except UnicodeEncodeError:
            out.append("?")
    return "".join(out)


def _pdf_escape_bytes(text: str) -> str:
    raw = _sanitize_winansi(text).encode("cp1252", errors="replace")
    parts: List[str] = []
    for b in raw:
        if b == 0x5C:
            parts.append("\\\\")
        elif b == 0x28:
            parts.append("\\(")
        elif b == 0x29:
            parts.append("\\)")
        elif 32 <= b <= 126:
            parts.append(chr(b))
        else:
            parts.append(f"\\{b:03o}")
    return "".join(parts)


# Font keys in PDF:
# T1=Times-Roman, T2=Times-Bold, T3=Times-Italic, T4=Times-BoldItalic
# H1=Helvetica, H2=Helvetica-Bold, H3=Helvetica-Oblique, H4=Helvetica-BoldOblique
# M1=Courier


def _measure_span(text: str, font_key: str, size: float) -> float:
    clean = _sanitize_winansi(text)
    if font_key == "M1":
        return len(clean) * 0.602 * size
    if font_key.startswith("T"):
        factor = 1.045 if font_key in ("T2", "T4") else 1.008
        u = sum(_TIMES_W.get(ch, 500) for ch in clean)
        return (u / 1000.0) * size * factor
    factor = 1.072 if font_key in ("H2", "H4") else 1.008
    u = sum(_HELV_W.get(ch, 556) for ch in clean)
    return (u / 1000.0) * size * factor


def _hex_rgb(hex_str: str) -> Tuple[float, float, float]:
    h = hex_str.lstrip("#")
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)


@dataclass
class _PdfToken:
    text: str
    font: str
    size: float
    color: str
    width: float = 0.0


def _spans_to_tokens(
    spans: List[InlineSpan],
    family: str,  # "T" (Times) or "H" (Helvetica)
    base_size: float,
    base_color: str = "111827",
    force_bold: bool = False,
) -> List[_PdfToken]:
    tokens: List[_PdfToken] = []
    for sp in spans:
        if sp.code:
            font = "M1"
            sz = max(7.0, base_size - 1.0)
            col = "1F2937"
        else:
            is_b = sp.bold or force_bold
            if is_b and sp.italic:
                font = f"{family}4"
            elif is_b:
                font = f"{family}2"
            elif sp.italic:
                font = f"{family}3"
            else:
                font = f"{family}1"
            sz = base_size
            col = "183923" if sp.href else base_color

        pieces = re.findall(r"\S+|\s+", _sanitize_winansi(sp.text))
        for pc in pieces:
            if pc.isspace():
                pc = " "
            w = _measure_span(pc, font, sz)
            tokens.append(_PdfToken(text=pc, font=font, size=sz, color=col, width=w))
    return tokens


def _wrap_tokens(tokens: List[_PdfToken], max_width: float) -> List[List[_PdfToken]]:
    lines: List[List[_PdfToken]] = []
    cur: List[_PdfToken] = []
    cur_w = 0.0

    for tok in tokens:
        if tok.text == " " and not cur:
            continue
        if tok.width > max_width and len(tok.text) > 6:
            if cur:
                while cur and cur[-1].text == " ":
                    cur.pop()
                if cur:
                    lines.append(cur)
                cur = []
                cur_w = 0.0
            chunk = ""
            for ch in tok.text:
                cand = chunk + ch
                if _measure_span(cand, tok.font, tok.size) > max_width and chunk:
                    lines.append(
                        [
                            _PdfToken(
                                text=chunk,
                                font=tok.font,
                                size=tok.size,
                                color=tok.color,
                                width=_measure_span(chunk, tok.font, tok.size),
                            )
                        ]
                    )
                    chunk = ch
                else:
                    chunk = cand
            if chunk:
                w_rem = _measure_span(chunk, tok.font, tok.size)
                cur = [_PdfToken(text=chunk, font=tok.font, size=tok.size, color=tok.color, width=w_rem)]
                cur_w = w_rem
            continue

        if cur and (cur_w + tok.width > max_width):
            while cur and cur[-1].text == " ":
                cur.pop()
            if cur:
                lines.append(cur)
            cur = []
            cur_w = 0.0
            if tok.text == " ":
                continue

        cur.append(tok)
        cur_w += tok.width

    while cur and cur[-1].text == " ":
        cur.pop()
    if cur:
        lines.append(cur)
    return lines or [[]]


class PdfCompiler:
    """Kompilator PDF 1.4 A4 bergaya cetak editorial (Times-Roman + Helvetica + Booktabs)."""

    PAGE_W = 595.28
    PAGE_H = 841.89
    MARGIN_L = 56.0
    MARGIN_R = 56.0
    MARGIN_TOP_P1 = 52.0
    MARGIN_TOP_PN = 62.0
    MARGIN_BOT = 54.0

    def __init__(self, doc: ParsedDocument, header_label: str) -> None:
        self.doc = doc
        self.header_label = header_label
        self.content_w = self.PAGE_W - self.MARGIN_L - self.MARGIN_R
        self.pages: List[List[str]] = []
        self.images: List[Tuple[str, int, int, bytes]] = []
        self._img_cache: dict[str, Tuple[str, int, int]] = {}
        self.cur_y = 0.0
        self._new_page()

    def _new_page(self) -> None:
        self.pages.append([])
        self.cur_y = self.PAGE_H - (self.MARGIN_TOP_P1 if len(self.pages) == 1 else self.MARGIN_TOP_PN)

    @property
    def _cmds(self) -> List[str]:
        return self.pages[-1]

    def _ensure_space(self, needed_h: float) -> None:
        if self.cur_y - needed_h < self.MARGIN_BOT:
            self._new_page()

    def _draw_line(
        self, x1: float, y1: float, x2: float, y2: float, stroke_hex: str, lw: float = 0.75
    ) -> None:
        r, g, b = _hex_rgb(stroke_hex)
        self._cmds.append(
            f"q {lw:.2f} w {r:.3f} {g:.3f} {b:.3f} RG {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S Q"
        )

    def _stroke_rect(
        self, x: float, y_bottom: float, w: float, h: float, stroke_hex: str, lw: float = 0.5
    ) -> None:
        r, g, b = _hex_rgb(stroke_hex)
        self._cmds.append(
            f"q {lw:.2f} w {r:.3f} {g:.3f} {b:.3f} RG {x:.2f} {y_bottom:.2f} {w:.2f} {h:.2f} re S Q"
        )

    def _draw_text_at(self, x: float, y_base: float, text: str, font: str, size: float, color_hex: str) -> None:
        if not text:
            return
        r, g, b = _hex_rgb(color_hex)
        esc = _pdf_escape_bytes(text)
        self._cmds.append(
            f"BT /{font} {size:.2f} Tf {r:.3f} {g:.3f} {b:.3f} rg {x:.2f} {y_base:.2f} Td ({esc}) Tj ET"
        )

    def _draw_token_line(
        self, line_tokens: List[_PdfToken], x_left: float, max_w: float, y_base: float, align: str = "left"
    ) -> None:
        line_w = sum(t.width for t in line_tokens)
        if align == "center":
            cx = x_left + max(0.0, (max_w - line_w) / 2.0)
        elif align == "right":
            cx = x_left + max(0.0, max_w - line_w)
        else:
            cx = x_left

        for tok in line_tokens:
            if tok.text != " ":
                self._draw_text_at(cx, y_base, tok.text, tok.font, tok.size, tok.color)
            cx += tok.width

    def _register_image(self, img_path: Path) -> Optional[Tuple[str, int, int]]:
        key = str(img_path.resolve())
        if key in self._img_cache:
            return self._img_cache[key]
        img = cv2.imread(str(img_path), cv2.IMREAD_COLOR)
        if img is None:
            return None
        h, w = img.shape[:2]
        ok, enc = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 93])
        if not ok:
            return None
        im_name = f"Im{len(self.images) + 1}"
        self.images.append((im_name, w, h, enc.tobytes()))
        self._img_cache[key] = (im_name, w, h)
        return im_name, w, h

    def _render_masthead(self) -> None:
        title_toks = _spans_to_tokens([InlineSpan(text=self.doc.title, bold=True)], "H", 15.0, "111827", True)
        title_lines = _wrap_tokens(title_toks, self.content_w)
        for tl in title_lines:
            self._draw_token_line(tl, self.MARGIN_L, self.content_w, self.cur_y - 13.0, "left")
            self.cur_y -= 20.0

        self.cur_y -= 2.0
        self._draw_line(self.MARGIN_L, self.cur_y, self.MARGIN_L + self.content_w, self.cur_y, "183923", 1.2)
        self.cur_y -= 10.0

        if self.doc.metadata:
            k_w = 122.0
            v_w = self.content_w - k_w
            for mk, mv in self.doc.metadata:
                k_lines = _wrap_tokens(
                    _spans_to_tokens([InlineSpan(text=mk, bold=True)], "H", 8.6, "374151"), k_w - 8.0
                )
                v_lines = _wrap_tokens(_spans_to_tokens(parse_inline_spans(mv), "H", 8.6, "111827"), v_w)
                n_ln = max(len(k_lines), len(v_lines))
                for li in range(n_ln):
                    yb = self.cur_y - 9.0
                    if li < len(k_lines):
                        self._draw_token_line(k_lines[li], self.MARGIN_L, k_w - 8.0, yb, "left")
                    if li < len(v_lines):
                        self._draw_token_line(v_lines[li], self.MARGIN_L + k_w, v_w, yb, "left")
                    self.cur_y -= 12.2
                self.cur_y -= 1.5

            self.cur_y -= 3.0
            self._draw_line(self.MARGIN_L, self.cur_y, self.MARGIN_L + self.content_w, self.cur_y, "CBD5E1", 0.55)
            self.cur_y -= 14.0

    def _render_h2(self, blk: DocBlock) -> None:
        self._ensure_space(64.0)
        self.cur_y -= 11.0
        toks = _spans_to_tokens([InlineSpan(text=blk.text, bold=True)], "H", 11.8, "111827", True)
        lines = _wrap_tokens(toks, self.content_w)
        for ln in lines:
            self._draw_token_line(ln, self.MARGIN_L, self.content_w, self.cur_y - 11.0, "left")
            self.cur_y -= 15.2
        self.cur_y -= 5.0

    def _render_h3(self, blk: DocBlock) -> None:
        self._ensure_space(48.0)
        self.cur_y -= 7.0
        toks = _spans_to_tokens(blk.spans, "H", 10.0, "1F2937", True)
        lines = _wrap_tokens(toks, self.content_w)
        for ln in lines:
            self._draw_token_line(ln, self.MARGIN_L, self.content_w, self.cur_y - 9.5, "left")
            self.cur_y -= 13.8
        self.cur_y -= 3.5

    def _render_para(
        self,
        spans: List[InlineSpan],
        indent_l: float = 0.0,
        indent_r: float = 0.0,
        prefix: Optional[str] = None,
        size: float = 10.2,
        color: str = "111827",
    ) -> None:
        avail_w = self.content_w - indent_l - indent_r
        toks = _spans_to_tokens(spans, "T", size, color)
        lines = _wrap_tokens(toks, avail_w)
        line_h = size * 1.44

        for li, ln in enumerate(lines):
            self._ensure_space(line_h + 2.0)
            y_base = self.cur_y - size * 0.92
            if li == 0 and prefix:
                self._draw_text_at(self.MARGIN_L + indent_l - 14.0, y_base, prefix, "T1", size, color)
            self._draw_token_line(ln, self.MARGIN_L + indent_l, avail_w, y_base, "left")
            self.cur_y -= line_h
        self.cur_y -= 6.5

    def _render_formula(self, blk: DocBlock) -> None:
        self._ensure_space(34.0)
        self.cur_y -= 4.0
        toks = _spans_to_tokens([InlineSpan(text=blk.text, italic=True)], "T", 10.3, "111827")
        lines = _wrap_tokens(toks, self.content_w - 30.0)
        for ln in lines:
            self._draw_token_line(ln, self.MARGIN_L + 15.0, self.content_w - 30.0, self.cur_y - 10.0, "center")
            self.cur_y -= 14.5
        self.cur_y -= 6.0

    def _render_table_booktabs(self, blk: DocBlock) -> None:
        ncols = len(blk.headers)
        weights = _compute_col_weights(blk.headers, blk.rows)
        col_ws = [max(32.0, w * self.content_w) for w in weights]
        scale = self.content_w / sum(col_ws)
        col_ws = [cw * scale for cw in col_ws]

        pad_x = 4.5
        pad_y = 4.8
        font_sz = 8.2 if ncols <= 5 else 7.5
        line_h = font_sz * 1.36

        def _measure_row(cells: List[str], is_hdr: bool) -> Tuple[List[List[List[_PdfToken]]], float]:
            wrapped_cols: List[List[List[_PdfToken]]] = []
            max_lines = 1
            for ci, c_txt in enumerate(cells):
                sp = parse_inline_spans(c_txt)
                col_hex = "111827" if is_hdr else "1F2937"
                toks = _spans_to_tokens(sp, "H", font_sz, col_hex, force_bold=is_hdr)
                w_lines = _wrap_tokens(toks, max(18.0, col_ws[ci] - 2 * pad_x))
                wrapped_cols.append(w_lines)
                if len(w_lines) > max_lines:
                    max_lines = len(w_lines)
            return wrapped_cols, max_lines * line_h + 2 * pad_y

        hdr_wrapped, hdr_h = _measure_row(blk.headers, True)
        first_body_h = _measure_row(blk.rows[0], False)[1] if blk.rows else 0.0
        self._ensure_space(hdr_h + first_body_h + 12.0)
        self.cur_y -= 3.0

        def _draw_header() -> None:
            # Top heavy rule (booktabs \toprule)
            self._draw_line(self.MARGIN_L, self.cur_y, self.MARGIN_L + self.content_w, self.cur_y, "111827", 1.05)
            y_bot = self.cur_y - hdr_h
            cx = self.MARGIN_L
            for ci, w_lines in enumerate(hdr_wrapped):
                cw = col_ws[ci]
                al = blk.alignments[ci] if ci < len(blk.alignments) else "left"
                ty = self.cur_y - pad_y - font_sz * 0.86
                for wl in w_lines:
                    self._draw_token_line(wl, cx + pad_x, cw - 2 * pad_x, ty, al)
                    ty -= line_h
                cx += cw
            # Mid rule below header (\midrule)
            self._draw_line(self.MARGIN_L, y_bot, self.MARGIN_L + self.content_w, y_bot, "111827", 0.70)
            self.cur_y = y_bot

        _draw_header()

        last_ri = len(blk.rows) - 1
        for ri, row in enumerate(blk.rows):
            b_wrapped, b_h = _measure_row(row, False)
            if self.cur_y - b_h < self.MARGIN_BOT:
                # Close current page fragment cleanly before breaking
                self._draw_line(self.MARGIN_L, self.cur_y, self.MARGIN_L + self.content_w, self.cur_y, "94A3B8", 0.5)
                self._new_page()
                _draw_header()

            y_bot = self.cur_y - b_h
            cx = self.MARGIN_L
            for ci, w_lines in enumerate(b_wrapped):
                cw = col_ws[ci]
                al = blk.alignments[ci] if ci < len(blk.alignments) else "left"
                ty = self.cur_y - pad_y - font_sz * 0.86
                for wl in w_lines:
                    self._draw_token_line(wl, cx + pad_x, cw - 2 * pad_x, ty, al)
                    ty -= line_h
                cx += cw

            if ri == last_ri:
                # Bottom heavy rule (\bottomrule)
                self._draw_line(self.MARGIN_L, y_bot, self.MARGIN_L + self.content_w, y_bot, "111827", 1.05)
            else:
                self._draw_line(self.MARGIN_L, y_bot, self.MARGIN_L + self.content_w, y_bot, "E5E7EB", 0.35)
            self.cur_y = y_bot

        self.cur_y -= 11.0

    def _render_image(self, blk: DocBlock) -> None:
        if not blk.img_path or not blk.img_path.exists():
            return
        reg = self._register_image(blk.img_path)
        if not reg:
            return
        im_name, px_w, px_h = reg
        max_w = self.content_w
        max_h = 225.0
        scale = min(max_w / max(px_w, 1), max_h / max(px_h, 1))
        draw_w = px_w * scale
        draw_h = px_h * scale

        cap_spans = [InlineSpan(text=f"Gambar {blk.fig_num}. ", bold=True)] + parse_inline_spans(blk.caption)
        cap_toks = _spans_to_tokens(cap_spans, "H", 8.2, "374151")
        cap_lines = _wrap_tokens(cap_toks, self.content_w - 16.0)
        total_h = draw_h + 10.0 + len(cap_lines) * 11.5 + 10.0

        self._ensure_space(total_h)
        self.cur_y -= 5.0
        ix = self.MARGIN_L + (self.content_w - draw_w) / 2.0
        iy_bot = self.cur_y - draw_h

        self._cmds.append(f"q {draw_w:.2f} 0 0 {draw_h:.2f} {ix:.2f} {iy_bot:.2f} cm /{im_name} Do Q")
        self._stroke_rect(ix, iy_bot, draw_w, draw_h, "CBD5E1", 0.5)

        cy = iy_bot - 12.0
        align_cap = "center" if len(cap_lines) == 1 else "left"
        for cl in cap_lines:
            self._draw_token_line(cl, self.MARGIN_L + 8.0, self.content_w - 16.0, cy, align_cap)
            cy -= 11.5
        self.cur_y = cy - 6.0

    def _decorate_headers_footers(self) -> None:
        total_pages = len(self.pages)
        for idx_p, cmds in enumerate(self.pages):
            pnum = idx_p + 1
            if pnum > 1:
                hdr_y = self.PAGE_H - 38.0
                r, g, b = _hex_rgb("4B5563")
                hw = _measure_span(self.header_label, "H1", 7.8)
                hx = self.PAGE_W - self.MARGIN_R - hw
                cmds.append(
                    f"BT /H1 7.80 Tf {r:.3f} {g:.3f} {b:.3f} rg {hx:.2f} {hdr_y:.2f} Td "
                    f"({_pdf_escape_bytes(self.header_label)}) Tj ET"
                )
                lr, lg, lb = _hex_rgb("CBD5E1")
                cmds.append(
                    f"q 0.45 w {lr:.3f} {lg:.3f} {lb:.3f} RG "
                    f"{self.MARGIN_L:.2f} {hdr_y - 5.0:.2f} m {self.PAGE_W - self.MARGIN_R:.2f} {hdr_y - 5.0:.2f} l S Q"
                )

            ftr_y = 30.0
            r, g, b = _hex_rgb("4B5563")
            left_lbl = "Kartika Cyber Hackathon 2026 - PUSSIBERAD TNI AD"
            cmds.append(
                f"BT /H1 7.80 Tf {r:.3f} {g:.3f} {b:.3f} rg {self.MARGIN_L:.2f} {ftr_y:.2f} Td "
                f"({_pdf_escape_bytes(left_lbl)}) Tj ET"
            )
            pg_lbl = f"{pnum} / {total_pages}"
            pw = _measure_span(pg_lbl, "H1", 8.0)
            px = self.PAGE_W - self.MARGIN_R - pw
            r2, g2, b2 = _hex_rgb("111827")
            cmds.append(
                f"BT /H1 8.00 Tf {r2:.3f} {g2:.3f} {b2:.3f} rg {px:.2f} {ftr_y:.2f} Td "
                f"({_pdf_escape_bytes(pg_lbl)}) Tj ET"
            )

    def save(self, out_path: Path) -> None:
        self._render_masthead()
        for blk in self.doc.blocks:
            if blk.kind == "h2":
                self._render_h2(blk)
            elif blk.kind == "h3":
                self._render_h3(blk)
            elif blk.kind == "para":
                self._render_para(blk.spans)
            elif blk.kind == "bullet":
                self._render_para(blk.spans, indent_l=16.0, prefix="•")
            elif blk.kind == "numbered":
                self._render_para(blk.spans, indent_l=18.0, prefix=blk.num_label)
            elif blk.kind == "quote":
                self._render_para(blk.spans, indent_l=20.0, indent_r=14.0, size=9.6, color="374151")
            elif blk.kind == "formula":
                self._render_formula(blk)
            elif blk.kind == "table":
                self._render_table_booktabs(blk)
            elif blk.kind == "image":
                self._render_image(blk)

        self._decorate_headers_footers()

        objects: List[bytes] = []

        def _add_obj(payload: bytes) -> int:
            objects.append(payload)
            return len(objects)

        font_specs = [
            ("T1", "Times-Roman"),
            ("T2", "Times-Bold"),
            ("T3", "Times-Italic"),
            ("T4", "Times-BoldItalic"),
            ("H1", "Helvetica"),
            ("H2", "Helvetica-Bold"),
            ("H3", "Helvetica-Oblique"),
            ("H4", "Helvetica-BoldOblique"),
            ("M1", "Courier"),
        ]
        font_obj_ids: dict[str, int] = {}
        for fk, base_font in font_specs:
            fid = _add_obj(
                f"<< /Type /Font /Subtype /Type1 /BaseFont /{base_font} /Encoding /WinAnsiEncoding >>".encode("ascii")
            )
            font_obj_ids[fk] = fid

        img_obj_ids: dict[str, int] = {}
        for im_name, iw, ih, jpg_bytes in self.images:
            hdr = (
                f"<< /Type /XObject /Subtype /Image /Width {iw} /Height {ih} "
                f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(jpg_bytes)} >>\nstream\n"
            ).encode("ascii")
            iid = _add_obj(hdr + jpg_bytes + b"\nendstream")
            img_obj_ids[im_name] = iid

        pages_tree_id = _add_obj(b"")
        font_res_str = " ".join(f"/{fk} {fid} 0 R" for fk, fid in font_obj_ids.items())
        xobj_res_str = (
            "/XObject << " + " ".join(f"/{im} {iid} 0 R" for im, iid in img_obj_ids.items()) + " >>"
            if img_obj_ids
            else ""
        )
        resources_str = f"<< /Font << {font_res_str} >> {xobj_res_str} >>"

        page_ids: List[int] = []
        for cmds in self.pages:
            stream_bytes = "\n".join(cmds).encode("latin-1")
            cid = _add_obj(
                f"<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii") + stream_bytes + b"\nendstream"
            )
            pid = _add_obj(
                (
                    f"<< /Type /Page /Parent {pages_tree_id} 0 R "
                    f"/MediaBox [0 0 {self.PAGE_W:.2f} {self.PAGE_H:.2f}] "
                    f"/Resources {resources_str} /Contents {cid} 0 R >>"
                ).encode("ascii")
            )
            page_ids.append(pid)

        kids_str = " ".join(f"{pid} 0 R" for pid in page_ids)
        objects[pages_tree_id - 1] = f"<< /Type /Pages /Kids [{kids_str}] /Count {len(page_ids)} >>".encode("ascii")

        catalog_id = _add_obj(f"<< /Type /Catalog /Pages {pages_tree_id} 0 R >>".encode("ascii"))
        info_id = _add_obj(
            (
                f"<< /Title ({_pdf_escape_bytes(self.doc.title)}) "
                f"/Author (Zuan & Denin) "
                f"/Subject (Kartika Cyber Hackathon 2026) "
                f"/Producer (VisiKartika Editorial Typesetter) >>"
            ).encode("latin-1")
        )

        buf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets: List[int] = [0]
        for idx_o, obj_bytes in enumerate(objects, start=1):
            offsets.append(len(buf))
            buf.extend(f"{idx_o} 0 obj\n".encode("ascii"))
            buf.extend(obj_bytes)
            buf.extend(b"\nendobj\n")

        xref_pos = len(buf)
        buf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
        buf.extend(b"0000000000 65535 f \n")
        for off in offsets[1:]:
            buf.extend(f"{off:010d} 00000 n \n".encode("ascii"))

        buf.extend(
            (
                f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R /Info {info_id} 0 R >>\n"
                f"startxref\n{xref_pos}\n%%EOF\n"
            ).encode("ascii")
        )

        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(bytes(buf))


# ============================================================================
# 5. ENTRYPOINT UTAMA
# ============================================================================


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    docs_dir = repo_root / "docs"

    # 1. Laporan Teknis Utama
    laporan_md = docs_dir / "LAPORAN_TEKNIS_VISIKARTIKA_SHIELD.md"
    parsed_laporan = parse_markdown_file(laporan_md)
    laporan_docx = docs_dir / "LAPORAN_TEKNIS_VISIKARTIKA_SHIELD.docx"
    laporan_pdf = docs_dir / "LAPORAN_TEKNIS_VISIKARTIKA_SHIELD.pdf"

    DocxCompiler(parsed_laporan, "VisiKartika Shield - Laporan Teknis").save(laporan_docx)
    pdf_lap = PdfCompiler(parsed_laporan, "VisiKartika Shield - Laporan Teknis")
    pdf_lap.save(laporan_pdf)

    # 2. Deklarasi Pre-Existing (Bab G & Bab N)
    decl_md = docs_dir / "PRE_EXISTING_DECLARATION.md"
    parsed_decl = parse_markdown_file(decl_md)
    decl_docx = docs_dir / "PRE_EXISTING_DECLARATION.docx"
    decl_pdf = docs_dir / "PRE_EXISTING_DECLARATION.pdf"

    DocxCompiler(parsed_decl, "VisiKartika Shield - Deklarasi Pre-Existing (Bab G & Bab N)").save(decl_docx)
    pdf_dec = PdfCompiler(parsed_decl, "VisiKartika Shield - Deklarasi Pre-Existing (Bab G & Bab N)")
    pdf_dec.save(decl_pdf)

    for p in (laporan_docx, laporan_pdf, decl_docx, decl_pdf):
        kb = os.path.getsize(p) / 1024.0
        print(f"[OK] {p.name:44s} -> {kb:7.1f} KB")
    print(f"     Halaman PDF Laporan Teknis        : {len(pdf_lap.pages)} halaman")
    print(f"     Halaman PDF Deklarasi Pre-Existing: {len(pdf_dec.pages)} halaman")


if __name__ == "__main__":
    main()
