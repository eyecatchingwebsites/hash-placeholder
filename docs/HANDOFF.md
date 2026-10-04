# Handoff: picking up in a new session

Last updated: October 4, 2026, at the end of the cloud session that built the website (branch `claude/vibrant-cray-fpbieb`). Read this, then `docs/PROJECT.md` (the project memory) and `docs/TECHNICAL-PLAN.md` (what to build next).

## 1. Get the code

Everything is committed and pushed. Nothing lives only in the cloud session.

```sh
git clone https://github.com/eyecatchingwebsites/hash-placeholder.git   # or, in an existing clone:
git fetch origin
git checkout claude/vibrant-cray-fpbieb
```

- All website work is on **`claude/vibrant-cray-fpbieb`**. There is no `main` branch: the repo's default branch is `claude/lucid-fermat-16svvo`. This branch is **not merged into it** and has no pull request yet. Merge it (or open a PR) before starting unrelated work, or keep working on this branch.
- Earlier branch: `claude/lucid-fermat-16svvo` (engine, switcher, API, desktop app; already the base of this branch).
- Tools: Python 3 (site scripts and `sim/`, stdlib only), Node 20+ (`npm test`, `npm run typecheck` from the repo root), Rust + Tauri 2 for `apps/desktop`. Playwright is optional (browser checks, below).

## 2. Where things stand

- **Website (`apps/web`)**: the main focus so far. Static HTML/CSS/JS, no backend. Live preview: **https://claude.ai/artifact/6mwmqXA78PGKKqr17gNmSc** (Version 24 as of the Oct 4 local session). What's on it now is summarized in `docs/PROJECT.md` §13, "Current website (Oct 4)".
- **Payout engine, coin switcher, assignment API, desktop app core**: built and tested on the earlier branch (see `docs/PROJECT.md` §10). The desktop app has not been run on Windows yet.
- **Next in the build plan**: the devnet test run (Token-2022 token, fee collection, mock pool feed, batch payouts), then real miners and pools research. See `docs/TECHNICAL-PLAN.md`.
- **Open decisions**: `docs/PROJECT.md` §11 (holder payout cadence, hold clocks, launchpad, legal review, etc.).

## 3. Working on the website

```sh
cd apps/web && python3 -m http.server 8123          # serve it; open http://localhost:8123
python3 apps/web/scripts/build_standalone.py         # after any change: rebuild the single-file pages
node apps/web/scripts/check_site.mjs                 # browser check at 6 sizes (needs Playwright and the server above running)
python3 apps/web/scripts/artifact_page.py            # make the artifact page in apps/web/.artifact/
```

- `check_site.mjs` checks that the hero fits the window, the flywheel caption bar never changes height, there's no horizontal scroll and no page errors, at 390×844 (phone), 1280×720, 1440×900, 1920×1080, 2048×1050 and 2560×1300, and saves screenshots to `apps/web/.shots/`. Install Playwright with `npm i -g playwright && npx playwright install chromium`.
- **Publishing the preview** (if the session has the Artifact tool): run `artifact_page.py`, then publish with `url` = the preview link above, `file_path` = `apps/web/.artifact/main.html`, `files` = `{"calculator.html": "apps/web/.artifact/calculator.html", "faq.html": "apps/web/.artifact/faq.html"}`. A new session must **read** the artifact first (Artifact tool, `action: "read"`, and `paths: ["calculator.html", "faq.html"]`) or the publish is refused. Without the Artifact tool, open `apps/web/standalone/index.html` in a browser instead.
- The routine after each round of website feedback: change → rebuild standalone → check (big screen, 1280×720, phone) → update `docs/PROJECT.md` → commit and push → republish the preview → reply with the link.

## 4. How the user likes to work (learned over the sessions)

- **Plain and short.** "Way too much text" came up several times. A line or two per block, bullets over paragraphs, nothing that needs a second read. The average visitor must get the mechanism without being overwhelmed.
- **No "AI slop" look.** No tag/pill labels above titles (removed Oct 4), no monospace uppercase labels, no rainbow or gradient buttons, no crowded layouts. Look like a real product company (references: usepaid.app, usehotbot.com).
- **Never promise returns or say anything untrue** (CLAUDE.md rule). Estimates are labeled "an estimate, not a promise". "First" is only used in the narrow, researched form: "The first token your GPU gets paid to buy" (see PROJECT.md §13 for the research and what must never be claimed).
- **Audience balance.** Traders matter most, but the site must not lean on mining or on trading: holding needs no GPU, mining needs no buying, and doing both is shown as a choice, never a requirement.
- **Big monitor.** The user views on a ~2560-wide screen. Always check large screens, not just 1440.
- **Feedback comes as screenshots plus a bullet list.** Fix every bullet, then publish and send the link.
- **Decisions get recorded** in `docs/PROJECT.md` with the date and the user's words where useful.
- Use they/them for the user.

## 5. The user's Windows PC (set up Oct 4, 2026)

- **Project lives at `C:\Users\LukeW\dev\hash-placeholder`**, not the old `OneDrive\Documents\GitHub` copy. Windows Security's *Controlled folder access* (ransomware protection) is on and blocks Python, Node, Git and PowerShell from writing anywhere under `Documents`, which shows up as "Bad file descriptor", "No such file" or a hanging `npm install`. Don't work in the old folder.
- Installed: Python 3.14 (`python`, also `py`), Node 24, npm 11, Git, Playwright + Chromium (global; `check_site.mjs` finds it). Rust/Tauri not installed yet.
- `.gitattributes` keeps `*.svg` and the generated site files at LF, and the site scripts read and write UTF-8 with LF explicitly (Windows Python otherwise defaults to cp1252 and CRLF), so `build_standalone.py` and `artifact_page.py` give the same bytes on Windows and Linux.
- `python` is 3.14; `python3` is a separate Microsoft Store 3.13. Both run the scripts.
- **Verified locally (Oct 4):** `npm test` (engine 21, now 29; switcher 11; API 4) and `npm run typecheck` pass; `python sim/hashsim.py` reproduces the PROJECT.md §8 numbers; the standalone build is byte-identical to the repo; `check_site.mjs` passes at all six sizes; the artifact build matches the published preview byte for byte, and this local session can read the preview (so it can republish). Not run: `apps/desktop` (no Rust yet).

## 6. Cloud-session leftovers that don't carry over

- The artifact "watch" subscription (republish/comment notifications) was tied to the cloud session.
- Scratch screenshots and test scripts lived in the session scratchpad; the useful parts are now `apps/web/scripts/check_site.mjs` and `artifact_page.py`.
- The cloud credits ($100 gifted) were for the cloud session only.
