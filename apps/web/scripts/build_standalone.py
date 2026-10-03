#!/usr/bin/env python3
"""Build single-file copies of the site pages into apps/web/standalone/ (stdlib only).

Each page gets its CSS, JS and logo inlined, so it renders correctly even when the
HTML file is opened or shared on its own, without the assets/ and brand/ folders.

Usage (from the repo root):
    python3 apps/web/scripts/build_standalone.py
"""
import base64
import re
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
OUT = WEB / "standalone"
PAGES = ["index.html", "calculator.html", "faq.html"]


def data_uri(path: Path) -> str:
    mime = {".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}[path.suffix]
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def build(name: str) -> str:
    html = (WEB / name).read_text()
    css = (WEB / "assets/css/site.css").read_text()
    html = html.replace('<link rel="stylesheet" href="assets/css/site.css">', f"<style>\n{css}\n</style>")

    def inline_script(m):
        js = (WEB / m.group(1)).read_text()
        return "<script>\n" + js.replace("</script", "<\\/script") + "\n</script>"

    html = re.sub(r'<script src="(assets/js/[^"]+)"></script>', inline_script, html)

    # Logo and favicon as data URIs (skip og:image, which needs a real URL once hosted).
    def inline_asset(m):
        attr, path = m.group(1), m.group(2)
        return f'{attr}="{data_uri(WEB / path)}"'

    html = re.sub(r'(src|data-logo|href)="(brand/logo/[^"]+\.(?:svg|ico))"', inline_asset, html)
    # loop.js builds the core logo from data-logo, defaulting to the relative path.
    return html


def main():
    OUT.mkdir(exist_ok=True)
    for name in PAGES:
        html = build(name)
        leftovers = re.findall(r'(?:src|href)="(?:assets|brand)/[^"]+"', html)
        (OUT / name).write_text(html)
        print(f"wrote standalone/{name} ({len(html) // 1024} KB)" + (f"  unresolved: {leftovers}" if leftovers else ""))


if __name__ == "__main__":
    main()
