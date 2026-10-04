#!/usr/bin/env python3
"""Make the claude.ai artifact page from standalone/index.html.

The artifact host wraps the page in its own document, so the doctype, <html>, <head>, <body>,
charset and viewport tags come out, the title becomes "Hashcoin Website", and scroll-reveal
effects are switched off (they can stay invisible inside the preview frame).

Usage (from the repo root, after build_standalone.py):
    python3 apps/web/scripts/artifact_page.py [out_dir]

Writes out_dir/main.html (the page) and copies calculator.html and faq.html beside it.
out_dir defaults to apps/web/.artifact/ (git-ignored). Then publish with the Artifact tool:
    url       = https://claude.ai/artifact/6mwmqXA78PGKKqr17gNmSc
    file_path = <out_dir>/main.html
    files     = {"calculator.html": "<out_dir>/calculator.html", "faq.html": "<out_dir>/faq.html"}
"""
import re
import shutil
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
SRC = WEB / "standalone"


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else WEB / ".artifact"
    out.mkdir(parents=True, exist_ok=True)
    h = (SRC / "index.html").read_text(encoding="utf-8")
    h = re.sub(r"<!doctype html>\s*", "", h, flags=re.I)
    for tag in ("html", "head", "body"):
        h = re.sub(rf"</?{tag}[^>]*>", "", h)
    h = re.sub(r"<meta charset[^>]*>", "", h, flags=re.I)
    h = re.sub(r'<meta name="viewport"[^>]*>', "", h)
    h = re.sub(r"<title>.*?</title>", "<title>Hashcoin Website</title>", h, count=1, flags=re.S)
    h = h.replace("</style>", ".reveal { opacity: 1 !important; transform: none !important; }\n</style>", 1)
    (out / "main.html").write_text(h, encoding="utf-8", newline="\n")
    for name in ("calculator.html", "faq.html"):
        shutil.copyfile(SRC / name, out / name)
    print(f"wrote {out / 'main.html'} ({len(h) // 1024} KB), calculator.html, faq.html")


if __name__ == "__main__":
    main()
