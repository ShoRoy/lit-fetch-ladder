"""Write the README's pipeline schematic and logo, light and dark.

    python3 docs/assets/make_figures.py

Edit the layout or the labels here and rerun; the four SVG files beside this script are generated
and should not be edited by hand.
"""
import os
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

THEMES = {
    "light": {
        "text": "#1f2328", "muted": "#59636e", "line": "#8c959f",
        "ladder": "#b45309", "box": "#f6f8fa", "box_edge": "#d0d7de",
        "guard": "#ddf4ff", "guard_edge": "#54aeff", "guard_text": "#0550ae",
        "zotero": "#cc2936", "zlogo_line": "#1a1a1a", "zlogo_z": "#cc2936",
    },
    "dark": {
        "text": "#e6edf3", "muted": "#9198a1", "line": "#6e7681",
        "ladder": "#f59e0b", "box": "#161b22", "box_edge": "#30363d",
        "guard": "#0c2d48", "guard_edge": "#1f6feb", "guard_text": "#79c0ff",
        "zotero": "#ff6b6b", "zlogo_line": "#e6e8eb", "zlogo_z": "#ff7b86",
    },
}

# Rungs, top to bottom: (number, title, what it does). y is the rung's height on the ladder.
RUNGS = [
    (3, "Browser with your library login", "the same browser, carrying your sign-in", 118),
    (2, "Browser, no login", "pages a plain script cannot read", 190),
    (1, "Open-access copy", "Unpaywall and OpenAlex, legal copies only", 262),
    (0, "Find and rank papers", "OpenAlex: a topic, or a paper's references", 334),
]


def text(x, y, s, c, size=14, weight="normal", anchor="start", style="normal"):
    return (f'<text x="{x}" y="{y}" fill="{c}" font-size="{size}" font-weight="{weight}" '
            f'font-style="{style}" text-anchor="{anchor}">{escape(s)}</text>')


def arrow(x1, y1, x2, y2, c, head="arr"):
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="1.6" '
            f'marker-end="url(#{head})"/>')


def box(x, y, w, h, t, title, sub, dashed=False, edge=None):
    dash = ' stroke-dasharray="6 4"' if dashed else ""
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="{t["box"]}" '
           f'stroke="{edge or t["box_edge"]}" stroke-width="1.4"{dash}/>']
    cx = x + w / 2
    out.append(text(cx, y + 22, title, t["text"], 14, "600", "middle"))
    for i, line in enumerate(sub):
        out.append(text(cx, y + 40 + 16 * i, line, t["muted"], 12, anchor="middle"))
    return out


def zotero_mcp_logo(t, x, y, size):
    """Zotero MCP's logo (github.com/54yyyu/zotero-mcp, docs/assets/logo-*.svg, MIT), drawn at (x, y)."""
    return (f'<g transform="translate({x} {y}) scale({size / 128:.4f})"><g transform="translate(4 9) scale(.94)" '
            'fill="none" stroke-linejoin="round" stroke-linecap="round">'
            '<path d="M40 12H88a26 26 0 0 1 26 26V78a26 26 0 0 1-26 26H62L38 118V104H40a26 26 0 0 1-26-26V38'
            f'a26 26 0 0 1 26-26Z" stroke="{t["zlogo_line"]}" stroke-width="5.5"/>'
            f'<path d="M47 39H81L47 77H81" stroke="{t["zlogo_z"]}" stroke-width="8"/></g></g>')


def pipeline(t):
    W, H = 1060, 440
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
         f'font-family="{FONT}" role="img" aria-labelledby="title desc">',
         '<title id="title">How lit-fetch-ladder works</title>',
         '<desc id="desc">A request (a topic, DOIs, or a paper\'s references) enters a ladder of four rungs: '
         'find and rank papers, an open-access copy, a browser without login, and a browser with your library '
         'login. Each paper climbs only as far as it needs. A guard of Claude Code hooks asks you to approve each '
         'batch for the browser with your library login and caps its page loads. Every fetched file is checked '
         'against its paper and recorded in a manifest, and can then '
         'be filed into Zotero through zotero-cli, which bridges to Zotero MCP, a separate project.</desc>',
         '<defs>'
         f'<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
         f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{t["line"]}"/></marker>'
         f'<marker id="arrL" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
         f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{t["ladder"]}"/></marker>'
         '</defs>']

    # This repository's boundary; Zotero MCP sits outside it.
    o.append(f'<rect x="8" y="34" width="800" height="392" rx="14" fill="none" stroke="{t["line"]}" '
             f'stroke-width="1.2" stroke-dasharray="7 5"/>')
    o.append(f'<text x="24" y="24" font-size="15"><tspan fill="{t["text"]}" font-weight="700">'
             f'lit-fetch-ladder</tspan><tspan fill="{t["muted"]}" font-size="13" dx="10">this repository'
             f'</tspan></text>')

    # Batch approval and the page-load caps apply to rung 3, the library browser.
    o.append(f'<rect x="138" y="56" width="404" height="88" rx="10" fill="{t["guard"]}" '
             f'stroke="{t["guard_edge"]}" stroke-width="1.2"/>')
    o.append(text(244, 76, "Guard: Claude Code hooks", t["guard_text"], 12.5, "700"))
    o.append(text(244, 92, "you approve each batch; page loads are capped", t["guard_text"], 12))

    # The ladder: two rails and four rungs.
    for x in (180, 228):
        o.append(f'<line x1="{x}" y1="100" x2="{x}" y2="384" stroke="{t["ladder"]}" stroke-width="7" '
                 f'stroke-linecap="round"/>')
    for n, title, sub, y in RUNGS:
        o.append(f'<line x1="180" y1="{y}" x2="228" y2="{y}" stroke="{t["ladder"]}" stroke-width="7" '
                 f'stroke-linecap="round"/>')
        o.append(text(246, y - 2, f"{n}", t["ladder"], 15, "700"))
        o.append(text(262, y - 2, title, t["text"], 15, "600"))
        o.append(text(262, y + 15, sub, t["muted"], 12))

    # Climbing: a paper goes up only when the rung below did not get it.
    o.append(f'<line x1="156" y1="322" x2="156" y2="128" stroke="{t["ladder"]}" stroke-width="1.8" '
             f'marker-end="url(#arrL)"/>')
    o.append(text(194, 410, "each paper climbs only as far as it needs", t["muted"], 12, anchor="middle",
                  style="italic"))

    # The request, deliberately without a box.
    for i, line in enumerate(("A topic,", "DOIs, or a", "paper's", "references")):
        o.append(text(22, 327 + 17 * i, line, t["text"], 14, "600"))
    o.append(arrow(116, 352, 170, 352, t["line"]))

    # Files from rungs 1-3 are collected and checked.
    cx = 560
    for _, _, _, y in RUNGS[:3]:
        o.append(f'<line x1="548" y1="{y}" x2="{cx}" y2="{y}" stroke="{t["line"]}" stroke-width="1.6"/>')
    o.append(f'<line x1="{cx}" y1="{RUNGS[0][3]}" x2="{cx}" y2="{RUNGS[2][3]}" stroke="{t["line"]}" '
             f'stroke-width="1.6"/>')
    o.append(arrow(cx, 190, 574, 190, t["line"]))

    o += box(576, 160, 212, 60, t, "Check the file", ["title and first author"])
    o.append(arrow(682, 220, 682, 246, t["line"]))
    o += box(576, 248, 212, 60, t, "Manifest", ["one recorded outcome per paper"])
    o.append(arrow(682, 308, 682, 334, t["line"]))
    o += box(576, 336, 212, 60, t, "File into Zotero", ["optional, through zotero-cli"])

    # The bridge out of this repository.
    o.append(arrow(788, 366, 856, 366, t["zotero"]))
    o.append(text(822, 356, "bridge", t["muted"], 11.5, anchor="middle"))
    o.append(text(954, 300, "outside this repository", t["muted"], 12, anchor="middle"))
    o += box(858, 312, 192, 108, t, "Zotero MCP",
             ["separate project", "your library: search, read,", "cite and annotate", "from any agent"],
             dashed=True, edge=t["zotero"])
    o.append(zotero_mcp_logo(t, 876, 316, 22))
    o.append("</svg>")
    return "\n".join(o) + "\n"


def logo(t):
    o = ['<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" '
         'aria-label="lit-fetch-ladder logo">',
         '<title>lit-fetch-ladder</title>']
    for x in (32, 64):
        o.append(f'<line x1="{x}" y1="10" x2="{x}" y2="86" stroke="{t["ladder"]}" stroke-width="8" '
                 f'stroke-linecap="round"/>')
    for y in (24, 41, 58, 75):
        o.append(f'<line x1="32" y1="{y}" x2="64" y2="{y}" stroke="{t["ladder"]}" stroke-width="7" '
                 f'stroke-linecap="round"/>')
    o.append("</svg>")
    return "\n".join(o) + "\n"


if __name__ == "__main__":
    for name, theme in THEMES.items():
        for stem, make in (("pipeline", pipeline), ("logo", logo)):
            path = os.path.join(HERE, f"{stem}-{name}.svg")
            with open(path, "w", encoding="utf-8") as f:
                f.write(make(theme))
            print("wrote", os.path.relpath(path, os.path.dirname(os.path.dirname(HERE))))
