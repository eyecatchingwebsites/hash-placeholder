# Hashcoin website (`apps/web`)

A static marketing site. Plain HTML, CSS and JavaScript with no framework and no wallet connection. The waitlist posts to the API (`services/api`) once `config.js` opens it; the download link, its SHA-256 and the contract address come from `config.js`. Live stats and the payout feed are still labeled placeholders.

**Hosting:** Cloudflare Pages at https://hashcoin.app (root directory `apps/web`, build command `node scripts/build_pages.mjs`, output `dist`). `build_pages.mjs` copies only the public files into `dist/` and fails the build on a broken link, a wrong-domain og/canonical URL or bad token metadata. Setup and the launch checklist: `docs/HOSTING.md`.

## Run it

Either open `index.html` directly in a browser, or serve the folder:

```sh
cd apps/web
python3 -m http.server 8000
# open http://localhost:8000
```

`index.html` needs the `assets/` and `brand/` folders beside it. If you open or share the HTML file on its own (a preview pane, a download, a chat attachment), it shows up unstyled. For that, use the single-file copies in `standalone/`. They have the CSS, JS and logo built in. Rebuild them after any change:

```sh
python3 apps/web/scripts/build_standalone.py
```

Fonts (Manrope for headlines, labels and numbers, Inter for body text, IBM Plex Mono only in the math formulas) load from Google Fonts. Offline, the site falls back to system fonts and still works.

**Preview link:** https://claude.ai/artifact/6mwmqXA78PGKKqr17gNmSc (private claude.ai artifact, republished after each change). `python3 apps/web/scripts/artifact_page.py` turns `standalone/` into the artifact files in `.artifact/` (publish steps in its docstring and in `docs/HANDOFF.md`).

**Check it in a browser:** serve the folder on port 8123, then `node apps/web/scripts/check_site.mjs` (needs Playwright). It checks the hero fits the window, the flywheel caption never changes height, and there's no horizontal scroll or page error at six sizes from phone to 2560 wide, and saves screenshots to `.shots/`.

## Pages

| File | What it is |
|---|---|
| `index.html` | Home: hero ("The first token your GPU gets paid to buy.", hold it / mine it / or both) beside two animated flywheels (the coin, your bag), then a topic explorer showing one topic at a time: what you'd make, how it works, levels, tokenomics, mining (with screenshots of the real app), launch, FAQ |
| `calculator.html` | Full calculator: GPU, power, electricity, miner level, bag and holder level, volume per GPU, average GPU and miner level mix |
| `faq.html` | FAQ and docs: getting started, mining, payouts, levels, token, safety, risks |

## Files

| Path | Purpose |
|---|---|
| `assets/css/site.css` | All styles. Design tokens are at the top (`--bg #0B0C0D`, `--gold #EBB447`, 8px radius), then the light theme. Gold used as text goes through `--gold-text-mix` so it darkens in light mode |
| `assets/img/app-dark.jpg`, `app-light.jpg` | Screenshots of the miner app (`apps/desktop/ui`) with a sample wallet, shown on the Mining tab; the one matching the site theme shows. Retake them when the app changes |
| `assets/js/config.js` | **Launch settings:** `site`, `api`, `launchAt`, `ca` (contract address), `waitlist` (opens the form), `download` (`url`, `version`, `sha256`), `x`, `discord`, `github`. Placeholders until set |
| `token/hash.json`, `token/hash.png` | Token metadata (`--uri` for the launch script) and its 512×512 logo |
| `_headers`, `robots.txt`, `sitemap.xml`, `404.html`, `wrangler.toml` | Cloudflare Pages: security headers, crawlers, unknown URLs, project settings |
| `scripts/build_pages.mjs`, `scripts/set_domain.mjs` | Build + check `dist/` for Cloudflare (`--serve` to preview it); move to another domain |
| `assets/js/site.js` | Shared behavior: header, light/dark button (dark by default; a choice is stored as `hc-theme` and applied before paint by a one-line script in each page's head), mobile menu, placeholder toasts, countdown, contract-address button, scroll reveal |
| `standalone/` | Generated single-file copies of the pages (see above) |
| `assets/js/model.js` | The pre-launch estimate for the decided design: a 2–5% tax (the lowest rate where miners reach 5× their mining and holders still get at least 1% of volume); dev 5–10% of the tax, miners 45–75%, holders the rest (at least 20%). Miner weight = √(GPU $/day) × M-level; holder weight = bag × H-level. Default $750 volume per GPU a day |
| `assets/js/home.js`, `assets/js/calculator.js` | Page logic. Home: topic tabs (one section shown at a time, `#hash` links open tabs), earnings with auto-cycling levels, GPU meter, tax-pot simulation; on big screens `fitExplore` scales the explorer to fill the screen |
| `assets/js/cycle.js` | Hero flywheels: two rings (the coin, your bag) built from one `makeWheel` engine, with a controller for the tabs, shared caption, step buttons and pause |
| `assets/js/gpus.js` | **Generated** GPU list (145 cards: 103 from `data/hashrate-no-gpus-2026-10-14.json`, plus 42 laptop GPUs estimated from desktop siblings and marked `est`) |
| `scripts/build_standalone.py`, `scripts/artifact_page.py` | Build the single-file pages; turn them into the artifact files |
| `scripts/check_site.mjs` | Browser check at six screen sizes (Playwright) |
| `scripts/gen_gpus.py` | Regenerates `gpus.js`: `python3 apps/web/scripts/gen_gpus.py data/<file>.json` (from the repo root) |
| `brand/` | Logo files, logo explorations and the website questionnaire |

## At launch

1. Set `launchAt` in `assets/js/config.js` when the date is decided. The countdown starts on its own.
2. Set `ca` only when the token is live. The header "CA" button then copies it. Never before launch.
3. Set the `x`, `discord` and `github` links. The X link also goes in `token/hash.json` (`twitter`, top level and in `extensions`); the build checks they match.
4. `waitlist: true` once the API answers at `https://api.hashcoin.app/v1/health`; `download` when the release is published (the SHA-256 shows beside the button and on `antivirus.html#check`).
5. Still placeholders: the payout feed and the wallet addresses in "Dev wallet transparency" (`docs/TECHNICAL-PLAN.md`, phases 3 and 4).
6. The "Your PC" tab says mining only uses spare GPU power and your PC works like normal. That's the user's experience mining PRL; change the copy if another coin or miner the app uses behaves differently.

## Copy rules

From `CLAUDE.md` and `docs/DESIGN-BRIEF.md`:
- Never promise returns. Avoid "pays for itself", "free" and "guaranteed". Price charts are fine (the user never ruled them out).
- Show one estimate, based on daily volume per GPU mining ($750 by default, launch-week trading), labeled "Estimate, not a promise". The math is on the home page (`#math`, inside How it works).
- Tax wording: a 2–5% tax set by a public formula; up to 3.75% to miners (what reaches 5× their mining on average); at least 1% to holders; 5–10% of the tax to development. Levels are M1–M3 and H1–H3; always explain them in plain words before using the codes. Level colors: 1 mint, 2 violet, 3 gold.
- Audience wording: "your GPU" / "any PC with a graphics card" (gaming PCs, laptops, AI rigs, editing and render workstations), not just "gaming PC". Keep copy to a line or two per block.
- Say "tax" rather than "fee" on the site; that's the word traders use.
- Keep "we will never ask for your seed phrase" and the risk disclaimer in the footer.

"Works with" uses plain-text names rather than logos. Check each brand's trademark rules before swapping in official logos.
