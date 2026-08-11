#!/usr/bin/env python3
"""Build the Rink Reports training guide PDF from chapter markdown files.

Supports a small markdown subset: #/##/###/#### headings, paragraphs,
- bullets (one nesting level with two-space indent), 1. numbered lists,
| tables |, > callouts, **bold**, *italic*, `code`, --- page breaks.
"""
import html
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate, Frame, KeepTogether, ListFlowable, ListItem, NextPageTemplate,
    PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle,
)

NAVY = colors.HexColor("#0f2a43")
ICE = colors.HexColor("#2f6f9f")
SLATE = colors.HexColor("#334155")
LIGHT = colors.HexColor("#eef4f9")
BORDER = colors.HexColor("#c9d8e4")
MUTED = colors.HexColor("#64748b")

BASE = dict(fontName="Helvetica", textColor=SLATE, spaceAfter=6)
S = {
    "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=22, leading=26,
                          textColor=NAVY, spaceBefore=0, spaceAfter=10),
    "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=15, leading=19,
                          textColor=NAVY, spaceBefore=14, spaceAfter=6),
    "h3": ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=12, leading=15,
                          textColor=ICE, spaceBefore=10, spaceAfter=4),
    "h4": ParagraphStyle("h4", fontName="Helvetica-Bold", fontSize=10.5, leading=13,
                          textColor=SLATE, spaceBefore=8, spaceAfter=3),
    "body": ParagraphStyle("body", fontSize=9.5, leading=13.5, alignment=TA_LEFT, **BASE),
    "bullet": ParagraphStyle("bullet", fontSize=9.5, leading=13, spaceAfter=3,
                              fontName="Helvetica", textColor=SLATE),
    "callout": ParagraphStyle("callout", fontSize=9.5, leading=13.5, fontName="Helvetica",
                               textColor=NAVY, backColor=LIGHT, borderColor=ICE,
                               borderWidth=1, borderPadding=7, spaceBefore=6, spaceAfter=8),
    "cell": ParagraphStyle("cell", fontSize=8.5, leading=11, fontName="Helvetica",
                            textColor=SLATE),
    "cellhead": ParagraphStyle("cellhead", fontSize=8.5, leading=11,
                                fontName="Helvetica-Bold", textColor=colors.white),
    "toc": ParagraphStyle("toc", fontSize=10.5, leading=16, fontName="Helvetica",
                           textColor=SLATE),
    "toc1": ParagraphStyle("toc1", fontSize=11.5, leading=18, fontName="Helvetica-Bold",
                            textColor=NAVY, spaceBefore=6),
}

INLINE_RE = [
    (re.compile(r"\*\*(.+?)\*\*"), r"<b>\1</b>"),
    (re.compile(r"\*(.+?)\*"), r"<i>\1</i>"),
    (re.compile(r"`(.+?)`"), r'<font face="Courier" size="8.7" color="#1e4d6b">\1</font>'),
]


def inline(text):
    out = html.escape(text, quote=False)
    for rx, rep in INLINE_RE:
        out = rx.sub(rep, out)
    return out


def make_table(rows):
    ncols = max(len(r) for r in rows)
    data = []
    for i, r in enumerate(rows):
        r = r + [""] * (ncols - len(r))
        style = S["cellhead"] if i == 0 else S["cell"]
        data.append([Paragraph(inline(c), style) for c in r])
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


def parse_markdown(md, story, headings):
    lines = md.split("\n")
    i = 0
    bullets = []      # list of (indent_level, text)
    numbers = []
    table_rows = []

    def flush_bullets():
        nonlocal bullets
        if bullets:
            items = []
            for lvl, txt in bullets:
                st = ParagraphStyle("b2", parent=S["bullet"],
                                    leftIndent=14 * lvl)
                items.append(ListItem(Paragraph(inline(txt), st),
                                      leftIndent=14 + 14 * lvl,
                                      bulletColor=ICE if lvl == 0 else MUTED))
            story.append(ListFlowable(items, bulletType="bullet", start="circle" ,
                                      bulletFontSize=7, spaceAfter=8))
            bullets = []

    def flush_numbers():
        nonlocal numbers
        if numbers:
            items = [ListItem(Paragraph(inline(t), S["bullet"]), leftIndent=18)
                     for t in numbers]
            story.append(ListFlowable(items, bulletType="1", bulletFontSize=9,
                                      bulletColor=NAVY, spaceAfter=8,
                                      bulletFormat="%s."))
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
        if stripped == "---":
            flush_all(); story.append(PageBreak())
        elif stripped.startswith("|"):
            flush_bullets(); flush_numbers()
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            if not all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
                table_rows.append(cells)
        elif stripped.startswith("#"):
            flush_all()
            level = len(stripped) - len(stripped.lstrip("#"))
            text = stripped.lstrip("#").strip()
            key = f"h{min(level, 4)}"
            para = Paragraph(inline(text), S[key])
            if level == 1:
                headings.append((1, text, para))
                story.append(PageBreak())
                story.append(para)
            else:
                if level == 2:
                    headings.append((2, text, para))
                story.append(para)
        elif stripped.startswith(">"):
            flush_all()
            # gather consecutive callout lines
            buf = [stripped.lstrip("> ").strip()]
            while i + 1 < len(lines) and lines[i + 1].strip().startswith(">"):
                i += 1
                buf.append(lines[i].strip().lstrip("> ").strip())
            story.append(Paragraph(inline(" ".join(b for b in buf if b)), S["callout"]))
        elif re.match(r"^\s*[-•] ", line):
            flush_numbers(); flush_table()
            indent = (len(line) - len(line.lstrip())) // 2
            bullets.append((min(indent, 1), re.sub(r"^\s*[-•] ", "", line)))
        elif re.match(r"^\s*\d+\. ", stripped):
            flush_bullets(); flush_table()
            numbers.append(re.sub(r"^\s*\d+\. ", "", stripped))
        elif stripped == "":
            flush_all()
        else:
            flush_all()
            story.append(Paragraph(inline(stripped), S["body"]))
        i += 1
    flush_all()


class GuideDoc(BaseDocTemplate):
    def __init__(self, path, **kw):
        super().__init__(path, pagesize=letter, leftMargin=0.75 * inch,
                         rightMargin=0.75 * inch, topMargin=0.8 * inch,
                         bottomMargin=0.7 * inch, **kw)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height,
                      id="main")
        cover = Frame(self.leftMargin, self.bottomMargin, self.width, self.height,
                      id="cover")
        self.addPageTemplates([
            PageTemplate(id="Cover", frames=[cover], onPage=self.draw_cover),
            PageTemplate(id="Body", frames=[frame], onPage=self.draw_chrome),
        ])

    def draw_cover(self, canv, doc):
        canv.saveState()
        w, h = letter
        canv.setFillColor(NAVY)
        canv.rect(0, 0, w, h, stroke=0, fill=1)
        canv.setFillColor(colors.HexColor("#173b5c"))
        canv.rect(0, h - 3.1 * inch, w, 3.1 * inch, stroke=0, fill=1)
        canv.setFillColor(colors.white)
        canv.setFont("Helvetica-Bold", 34)
        canv.drawString(0.9 * inch, h - 2.05 * inch, "Rink Reports")
        canv.setFont("Helvetica", 17)
        canv.setFillColor(colors.HexColor("#bcd6ea"))
        canv.drawString(0.9 * inch, h - 2.5 * inch,
                        "Complete Training Guide — All Modules & Admin Console")
        canv.setStrokeColor(colors.HexColor("#3f7cab"))
        canv.setLineWidth(3)
        canv.line(0.9 * inch, h - 3.1 * inch, w - 0.9 * inch, h - 3.1 * inch)
        blurb = [
            "A field guide for staff and administrators covering every module:",
            "daily reports, incidents, accidents, ice depth, ice operations,",
            "refrigeration, air quality, dasher boards, communications, scheduling,",
            "and the full admin console — permissions, employees, exports,",
            "retention, audit log, and facility configuration.",
        ]
        canv.setFont("Helvetica", 12)
        canv.setFillColor(colors.HexColor("#dbe9f4"))
        y = h - 3.7 * inch
        for ln in blurb:
            canv.drawString(0.9 * inch, y, ln)
            y -= 0.28 * inch
        canv.setFont("Helvetica", 10)
        canv.setFillColor(colors.HexColor("#9db8cd"))
        canv.drawString(0.9 * inch, 1.0 * inch, "August 2026 edition")
        canv.restoreState()

    def draw_chrome(self, canv, doc):
        canv.saveState()
        w, h = letter
        canv.setStrokeColor(BORDER)
        canv.setLineWidth(0.7)
        canv.line(0.75 * inch, h - 0.55 * inch, w - 0.75 * inch, h - 0.55 * inch)
        canv.setFont("Helvetica", 8)
        canv.setFillColor(MUTED)
        canv.drawString(0.75 * inch, h - 0.45 * inch, "Rink Reports — Training Guide")
        canv.drawRightString(w - 0.75 * inch, h - 0.45 * inch,
                             f"Page {doc.page}")
        canv.restoreState()


def assemble(chapter_files, pages):
    """Parse chapters and build the full story (cover -> TOC -> body).

    `pages` maps (level, text) -> page number for the TOC; unknown -> "".
    Returns (story, headings) where headings hold the live Paragraph objects.
    """
    headings = []
    body = []
    for f in chapter_files:
        parse_markdown(Path(f).read_text(), body, headings)

    story = [NextPageTemplate("Body"), PageBreak(),
             Paragraph("Contents", S["h1"])]
    for lvl, text, _ in headings:
        pg = pages.get((lvl, text), "")
        style = S["toc1"] if lvl == 1 else S["toc"]
        indent = "" if lvl == 1 else "&nbsp;&nbsp;&nbsp;&nbsp;"
        dots = f'&nbsp;&nbsp;<font color="#94a3b8">{pg}</font>' if pg != "" else ""
        story.append(Paragraph(f"{indent}{inline(text)}{dots}", style))
    story.extend(body)
    return story, headings


def main(out_path, chapter_files):
    pages = {}
    for _ in range(2):  # pass 1 learns page numbers; pass 2 prints them
        story, headings = assemble(chapter_files, pages)
        lookup = {id(para): (lvl, text) for lvl, text, para in headings}

        class Probe(GuideDoc):
            def afterFlowable(self, fl):
                key = lookup.get(id(fl))
                if key:
                    pages[key] = self.page

        doc = Probe(out_path)
        doc.build(story)
    print(f"Wrote {out_path} ({doc.page} pages)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
