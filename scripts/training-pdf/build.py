#!/usr/bin/env python3
"""Build every Rink Reports training PDF from its markdown sources.

    pip install -r scripts/training-pdf/requirements.txt
    python3 scripts/training-pdf/build.py            # build every output
    python3 scripts/training-pdf/build.py Master-Manual Onboarding-Staff
    python3 scripts/training-pdf/build.py --check    # verify PDFs match sources

Which PDFs exist and which markdown files go into each is declared in
builds.json next to this script. That file is the single source of truth:
the in-app Training & Documentation index (src/lib/training-docs.ts) must
list every output, and src/lib/training-docs.test.ts fails when a PDF on
disk was built from markdown that has since changed. Each PDF carries a
SHA-256 of its sources in its Keywords metadata to make that check possible.

Supported markdown: #..#### headings, paragraphs, - bullets (nested by two
spaces), 1. numbered lists, - [ ] checkboxes, | tables |, > callouts,
```fenced code```, --- rules, **bold**, *italic*, `code`, [text](url).

Output is deterministic (reportlab's invariant mode) so a rebuild from
unchanged sources produces a byte-identical file.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
BUILDS = HERE / "builds.json"
HASH_PREFIX = "rinkreports-source-sha256:"


# --------------------------------------------------------------------------
# Source hashing (shared with the vitest check — keep the recipe identical)
# --------------------------------------------------------------------------
def source_hash(sources: list[str]) -> str:
    h = hashlib.sha256()
    for rel in sources:
        data = (ROOT / rel).read_bytes().replace(b"\r\n", b"\n")
        h.update(rel.encode("utf-8") + b"\n" + data + b"\n")
    return h.hexdigest()


def load_builds() -> list[dict]:
    return json.loads(BUILDS.read_text())["outputs"]


def output_sources(out: dict) -> list[str]:
    return [src for part in out["parts"] for src in part["sources"]]


def embedded_hash(pdf: Path) -> str | None:
    if not pdf.exists():
        return None
    m = re.search(rb"rinkreports-source-sha256:([0-9a-f]{64})", pdf.read_bytes())
    return m.group(1).decode() if m else None


def check() -> int:
    stale = []
    for out in load_builds():
        want = source_hash(output_sources(out))
        have = embedded_hash(ROOT / out["path"])
        status = "ok" if have == want else ("missing" if have is None else "STALE")
        print(f"{status:8} {out['path']}")
        if have != want:
            stale.append(out["path"])
    if stale:
        print(f"\n{len(stale)} PDF(s) need rebuilding: python3 scripts/training-pdf/build.py")
        return 1
    return 0


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------
def build_all(only: list[str]) -> None:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (
        BaseDocTemplate, Frame, HRFlowable, ListFlowable, ListItem,
        NextPageTemplate, PageBreak, PageTemplate, Paragraph, Preformatted,
        Spacer, Table, TableStyle,
    )

    # --- Fonts -------------------------------------------------------------
    # DejaVu Sans is used (not Helvetica) because the docs lean on glyphs the
    # PDF base-14 fonts lack: → ⚠ ₂ ≥ ≤ ☐ ⋮. Oblique faces are optional
    # (Debian's fonts-dejavu-core omits them); italics fall back to regular.
    FONT_DIRS = [
        Path(p).expanduser() for p in [
            "/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu",
            "/usr/share/fonts/TTF", "/usr/local/share/fonts", "~/.fonts",
            "~/.local/share/fonts", "/Library/Fonts", "~/Library/Fonts",
            "/System/Library/Fonts/Supplemental", "C:/Windows/Fonts",
        ]
    ]

    def find_font(name: str) -> Path | None:
        for d in FONT_DIRS:
            for cand in d.rglob(name) if d.exists() else []:
                return cand
        return None

    def register(alias: str, file: str, fallback: str | None) -> str:
        p = find_font(file)
        if p is None:
            if fallback is None:
                sys.exit(
                    f"Font {file} not found. Install DejaVu fonts "
                    "(Debian/Ubuntu: apt install fonts-dejavu; macOS: brew install "
                    "--cask font-dejavu) or drop the .ttf files into ~/.fonts."
                )
            return fallback
        pdfmetrics.registerFont(TTFont(alias, str(p)))
        return alias

    SANS = register("DejaVuSans", "DejaVuSans.ttf", None)
    SANS_B = register("DejaVuSans-Bold", "DejaVuSans-Bold.ttf", None)
    SANS_I = register("DejaVuSans-Oblique", "DejaVuSans-Oblique.ttf", SANS)
    SANS_BI = register("DejaVuSans-BoldOblique", "DejaVuSans-BoldOblique.ttf", SANS_B)
    MONO = register("DejaVuSansMono", "DejaVuSansMono.ttf", None)
    pdfmetrics.registerFontFamily(SANS, normal=SANS, bold=SANS_B, italic=SANS_I,
                                  boldItalic=SANS_BI)

    # --- Styles ------------------------------------------------------------
    NAVY = colors.HexColor("#0f2a43")
    ICE = colors.HexColor("#2f6f9f")
    SLATE = colors.HexColor("#334155")
    LIGHT = colors.HexColor("#eef4f9")
    CODE_BG = colors.HexColor("#f1f5f9")
    BORDER = colors.HexColor("#c9d8e4")
    MUTED = colors.HexColor("#64748b")

    def style(name, **kw):
        base = dict(fontName=SANS, textColor=SLATE)
        base.update(kw)
        return ParagraphStyle(name, **base)

    S = {
        "part": style("part", fontName=SANS_B, fontSize=30, leading=36, textColor=NAVY,
                      spaceBefore=180, spaceAfter=14),
        "partsub": style("partsub", fontSize=13, leading=18, textColor=MUTED),
        "h1": style("h1", fontName=SANS_B, fontSize=22, leading=26, textColor=NAVY,
                    spaceAfter=10),
        "h2": style("h2", fontName=SANS_B, fontSize=15, leading=19, textColor=NAVY,
                    spaceBefore=14, spaceAfter=6),
        "h3": style("h3", fontName=SANS_B, fontSize=12, leading=15, textColor=ICE,
                    spaceBefore=10, spaceAfter=4),
        "h4": style("h4", fontName=SANS_B, fontSize=10.5, leading=13, spaceBefore=8,
                    spaceAfter=3),
        "body": style("body", fontSize=9.5, leading=13.5, alignment=TA_LEFT, spaceAfter=6),
        "bullet": style("bullet", fontSize=9.5, leading=13, spaceAfter=3),
        "callout": style("callout", fontSize=9.5, leading=13.5, textColor=NAVY,
                         backColor=LIGHT, borderColor=ICE, borderWidth=1,
                         borderPadding=7, spaceBefore=6, spaceAfter=8),
        "code": style("code", fontName=MONO, fontSize=8, leading=10.5),
        "cell": style("cell", fontSize=8.5, leading=11),
        "cellhead": style("cellhead", fontName=SANS_B, fontSize=8.5, leading=11,
                          textColor=colors.white),
        "toc0": style("toc0", fontName=SANS_B, fontSize=12.5, leading=20, textColor=NAVY,
                      spaceBefore=10),
        "toc1": style("toc1", fontName=SANS_B, fontSize=11, leading=17, textColor=NAVY,
                      spaceBefore=4),
        "toc2": style("toc2", fontSize=10, leading=15),
    }

    # --- Inline markdown ---------------------------------------------------
    LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
    INLINE_RE = [
        (re.compile(r"\*\*(.+?)\*\*"), r"<b>\1</b>"),
        (re.compile(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])"), r"<i>\1</i>"),
    ]

    def link_repl(m):
        text, url = m.group(1), m.group(2)
        if re.match(r"^(https?:|mailto:)", url):
            return f'<a href="{url}" color="#2f6f9f"><u>{text}</u></a>'
        # Relative links between docs and #anchors are navigation for the
        # web version; in print, the link text alone is the reference.
        return text

    def inline(text):
        # Protect code spans from the other substitutions, then restore them.
        spans = []

        def stash(m):
            spans.append(m.group(1))
            return f"\x00{len(spans) - 1}\x00"

        text = re.sub(r"`([^`]+)`", stash, text)
        out = html.escape(text, quote=False)
        out = LINK_RE.sub(link_repl, out)
        for rx, rep in INLINE_RE:
            out = rx.sub(rep, out)

        def restore(m):
            code = html.escape(spans[int(m.group(1))], quote=False)
            return f'<font face="{MONO}" size="8.5" color="#1e4d6b">{code}</font>'

        return re.sub(r"\x00(\d+)\x00", restore, out)

    def make_table(rows):
        ncols = max(len(r) for r in rows)
        data = []
        for i, r in enumerate(rows):
            r = r + [""] * (ncols - len(r))
            st = S["cellhead"] if i == 0 else S["cell"]
            data.append([Paragraph(inline(c), st) for c in r])
        avail = letter[0] - 1.5 * inch
        t = Table(data, colWidths=[avail / ncols] * ncols, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
            ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        t.spaceBefore, t.spaceAfter = 6, 10
        return t

    def code_block(text):
        # Preformatted ignores backColor/border, so the shaded box comes from
        # a one-cell table around it.
        pre = Preformatted(text, S["code"], maxLineLength=96)
        t = Table([[pre]], colWidths=[letter[0] - 1.5 * inch])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        t.spaceBefore, t.spaceAfter = 4, 10
        return t

    # --- Block markdown ----------------------------------------------------
    def parse_markdown(md, story, headings, *, first_h1_breaks):
        lines = md.split("\n")
        i = 0
        bullets, numbers, table_rows = [], [], []
        seen_h1 = False

        def flush_bullets():
            nonlocal bullets
            if bullets:
                items = []
                for lvl, txt in bullets:
                    st = ParagraphStyle("b2", parent=S["bullet"], leftIndent=14 * lvl)
                    items.append(ListItem(Paragraph(inline(txt), st),
                                          leftIndent=14 + 14 * lvl,
                                          bulletColor=ICE if lvl == 0 else MUTED))
                story.append(ListFlowable(items, bulletType="bullet", start="circle",
                                          bulletFontSize=7, spaceAfter=8))
                bullets = []

        def flush_numbers():
            nonlocal numbers
            if numbers:
                items = [ListItem(Paragraph(inline(t), S["bullet"]), leftIndent=18,
                                  value=n) for n, t in numbers]
                story.append(ListFlowable(items, bulletType="1", bulletFontName=SANS,
                                          bulletFontSize=9, bulletColor=NAVY,
                                          spaceAfter=8, bulletFormat="%s."))
                numbers = []

        def flush_table():
            nonlocal table_rows
            if table_rows:
                story.append(make_table(table_rows))
                table_rows = []

        def flush_all():
            flush_bullets(); flush_numbers(); flush_table()

        while i < len(lines):
            line = lines[i].rstrip()
            stripped = line.strip()
            if stripped.startswith("```"):
                flush_all()
                buf = []
                i += 1
                while i < len(lines) and not lines[i].strip().startswith("```"):
                    buf.append(lines[i].rstrip())
                    i += 1
                story.append(code_block("\n".join(buf)))
            elif re.fullmatch(r"-{3,}|\*{3,}", stripped):
                flush_all()
                story.append(HRFlowable(width="100%", thickness=0.6, color=BORDER,
                                        spaceBefore=6, spaceAfter=8))
            elif stripped.startswith("|"):
                flush_bullets(); flush_numbers()
                cells = [c.strip() for c in stripped.strip("|").split("|")]
                if not all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
                    table_rows.append(cells)
            elif stripped.startswith("#"):
                flush_all()
                level = len(stripped) - len(stripped.lstrip("#"))
                text = stripped.lstrip("#").strip()
                para = Paragraph(inline(text), S[f"h{min(level, 4)}"])
                if level == 1:
                    if seen_h1 or first_h1_breaks:
                        story.append(PageBreak())
                    seen_h1 = True
                    headings.append((1, text, para))
                elif level == 2:
                    headings.append((2, text, para))
                story.append(para)
            elif stripped.startswith(">"):
                flush_all()
                buf = [stripped.lstrip("> ").strip()]
                while i + 1 < len(lines) and lines[i + 1].strip().startswith(">"):
                    i += 1
                    buf.append(lines[i].strip().lstrip("> ").strip())
                story.append(Paragraph(inline(" ".join(b for b in buf if b)),
                                       S["callout"]))
            elif re.match(r"^\s*[-•*] ", line):
                flush_numbers(); flush_table()
                indent = (len(line) - len(line.lstrip())) // 2
                text = re.sub(r"^\s*[-•*] ", "", line)
                text = re.sub(r"^\[ \] ", "☐ ", text)
                text = re.sub(r"^\[[xX]\] ", "☑ ", text)
                bullets.append((min(indent, 2), text))
            elif re.match(r"^\d+\. ", stripped):
                flush_bullets(); flush_table()
                n = int(stripped.split(".", 1)[0])
                numbers.append((n, re.sub(r"^\d+\. ", "", stripped)))
            elif stripped == "":
                flush_all()
            else:
                flush_all()
                story.append(Paragraph(inline(stripped), S["body"]))
            i += 1
        flush_all()

    # --- Page templates ----------------------------------------------------
    class Doc(BaseDocTemplate):
        def __init__(self, path, spec, **kw):
            super().__init__(path, pagesize=letter, leftMargin=0.75 * inch,
                             rightMargin=0.75 * inch, topMargin=0.8 * inch,
                             bottomMargin=0.7 * inch, invariant=1, **kw)
            self.spec = spec
            frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height,
                          id="main")
            self.addPageTemplates([
                PageTemplate(id="Cover", frames=[frame], onPage=self.draw_cover),
                PageTemplate(id="Body", frames=[frame], onPage=self.draw_chrome),
            ])

        def draw_cover(self, canv, doc):
            spec = self.spec
            canv.saveState()
            w, h = letter
            canv.setFillColor(NAVY)
            canv.rect(0, 0, w, h, stroke=0, fill=1)
            canv.setFillColor(colors.HexColor("#173b5c"))
            canv.rect(0, h - 3.1 * inch, w, 3.1 * inch, stroke=0, fill=1)
            canv.setFillColor(colors.white)
            canv.setFont(SANS_B, 34)
            canv.drawString(0.9 * inch, h - 2.05 * inch, "Rink Reports")
            canv.setFont(SANS, 17)
            canv.setFillColor(colors.HexColor("#bcd6ea"))
            canv.drawString(0.9 * inch, h - 2.5 * inch, spec["title"])
            canv.setStrokeColor(colors.HexColor("#3f7cab"))
            canv.setLineWidth(3)
            canv.line(0.9 * inch, h - 3.1 * inch, w - 0.9 * inch, h - 3.1 * inch)
            canv.setFont(SANS, 12)
            canv.setFillColor(colors.HexColor("#dbe9f4"))
            y = h - 3.7 * inch
            for ln in spec.get("blurb", []):
                canv.drawString(0.9 * inch, y, ln)
                y -= 0.28 * inch
            canv.setFont(SANS, 10)
            canv.setFillColor(colors.HexColor("#9db8cd"))
            canv.drawString(0.9 * inch, 1.0 * inch, spec["edition"])
            canv.restoreState()

        def draw_chrome(self, canv, doc):
            canv.saveState()
            w, h = letter
            canv.setStrokeColor(BORDER)
            canv.setLineWidth(0.7)
            canv.line(0.75 * inch, h - 0.55 * inch, w - 0.75 * inch, h - 0.55 * inch)
            canv.setFont(SANS, 8)
            canv.setFillColor(MUTED)
            canv.drawString(0.75 * inch, h - 0.45 * inch, f"Rink Reports — {self.spec['title']}")
            canv.drawRightString(w - 0.75 * inch, h - 0.45 * inch, f"Page {doc.page}")
            canv.setFont(SANS, 7.5)
            canv.drawString(0.75 * inch, 0.45 * inch, self.spec["edition"])
            canv.restoreState()

    def assemble(spec, pages):
        """Cover -> Contents -> parts. `pages` maps (level, text) -> page no."""
        headings = []
        body = []
        cover = spec.get("cover", True)
        toc_depth = spec.get("toc_depth", 2)
        first = True
        for part in spec["parts"]:
            title = part.get("title")
            if title:
                body.append(PageBreak())
                para = Paragraph(inline(title), S["part"])
                body.append(para)
                headings.append((0, title, para))
                if part.get("subtitle"):
                    body.append(Paragraph(inline(part["subtitle"]), S["partsub"]))
                first = False
            for src in part["sources"]:
                md = (ROOT / src).read_text(encoding="utf-8")
                parse_markdown(md, body, headings,
                               first_h1_breaks=(not first) or cover)
                first = False

        story = []
        if cover:
            story += [NextPageTemplate("Body"), PageBreak(),
                      Paragraph("Contents", S["h1"])]
            for lvl, text, _ in headings:
                if lvl > toc_depth:
                    continue
                pg = pages.get((lvl, text), "")
                indent = "&nbsp;" * (4 * max(lvl - 1, 0)) if lvl >= 1 else ""
                dots = f'&nbsp;&nbsp;<font color="#94a3b8">{pg}</font>' if pg != "" else ""
                story.append(Paragraph(f"{indent}{inline(text)}{dots}", S[f"toc{lvl}"]))
        else:
            story += [NextPageTemplate("Body")]
        story.extend(body)
        return story, headings

    def build_one(spec):
        out_path = ROOT / spec["path"]
        out_path.parent.mkdir(parents=True, exist_ok=True)
        sources = output_sources(spec)
        digest = source_hash(sources)
        pages = {}
        doc = None
        for _ in range(2):  # pass 1 learns page numbers; pass 2 prints them
            story, headings = assemble(spec, pages)
            lookup = {id(para): (lvl, text) for lvl, text, para in headings}

            class Probe(Doc):
                def afterFlowable(self, fl):
                    key = lookup.get(id(fl))
                    if key:
                        pages[key] = self.page

            doc = Probe(str(out_path), spec, title=spec["title"], author="Rink Reports",
                        subject=spec.get("subtitle", spec["title"]),
                        keywords=f"{HASH_PREFIX}{digest}", creator="scripts/training-pdf/build.py")
            if not spec.get("cover", True):
                doc.pageTemplates = doc.pageTemplates[1:]  # Body only
            doc.build(story)
        print(f"Wrote {spec['path']} ({doc.page} pages)")

    outputs = load_builds()
    if only:
        wanted = set(only)
        outputs = [o for o in outputs if any(w in o["path"] for w in wanted)]
        if not outputs:
            sys.exit(f"No output matches {only}. See {BUILDS.relative_to(ROOT)}.")
    for spec in outputs:
        build_one(spec)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--check"]:
        sys.exit(check())
    build_all(args)
