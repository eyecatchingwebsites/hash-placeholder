# Hashcoin website (`apps/web`)

A static, front-end-only marketing site. Plain HTML, CSS and JavaScript with no build step, no backend, no sign-ups and no wallet connection. Anything that needs a backend (waitlist, download, buy, live stats, payout feed) is a labeled placeholder ("Coming soon" or "Preview").

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

Fonts (Manrope, Inter, JetBrains Mono) load from Google Fonts. Offline, the site falls back to system fonts and still works.

**Preview link:** https://claude.ai/artifact/6mwmqXA78PGKKqr17gNmSc (private claude.ai artifact, republished after each change from the `standalone/` files).

## Pages

| File | What it is |
|---|---|
| `index.html` | Home, written for traders: hero with a "what your GPU makes" estimate, a simulated chest (trades → tax → split to miners), the estimate math, why the tax pays out, levels table, the miner app, tokenomics, status, waitlist with countdown, FAQ |
| `calculator.html` | Full earnings calculator: GPU, power, electricity, level, and market scenarios |
| `faq.html` | FAQ and docs: getting started, mining, payouts, levels, token, safety, risks |

## Files

| Path | Purpose |
|---|---|
| `assets/css/site.css` | All styles. Design tokens are at the top (`--bg #0B0C0D`, `--gold #EBB447`, 8px radius) |
| `assets/js/config.js` | **Launch settings:** `launchAt`, `ca` (contract address), `x`, `discord`, `github`. All `null` until launch |
| `assets/js/site.js` | Shared behavior: header, mobile menu, placeholder toasts, countdown, contract-address button, scroll reveal |
| `standalone/` | Generated single-file copies of the pages (see above) |
| `assets/js/model.js` | The pre-launch estimate: cut = 2.5% × (daily volume per GPU + ā) × √(your GPU) × level ÷ (√ā × average level). Default $750 volume per GPU (30% volume/mcap × $1,000 mcap per holder ÷ 40% of holders mining) |
| `assets/js/home.js`, `assets/js/calculator.js` | Page logic |
| `assets/js/gpus.js` | **Generated** GPU list (91 cards) from `data/hashrate-no-gpus-2026-10-03.json` |
| `scripts/gen_gpus.py` | Regenerates `gpus.js`: `python3 apps/web/scripts/gen_gpus.py data/<file>.json` (from the repo root) |
| `brand/` | Logo files, logo explorations and the website questionnaire |

## At launch

1. Set `launchAt` in `assets/js/config.js` when the date is decided. The countdown starts on its own.
2. Set `ca` only when the token is live. The header "CA" button then copies it. Never before launch.
3. Set the `x`, `discord` and `github` links.
4. Replace the placeholders with live data: the waitlist form, the payout feed, the wallet addresses in "Dev wallet transparency", and the download button. Each needs the backend (`docs/TECHNICAL-PLAN.md`, phases 3 and 4).
5. The app preview lists temperature and power limits and pause-while-gaming as "Planned before release". Change that copy only once those features ship.

## Copy rules

From `CLAUDE.md` and `docs/DESIGN-BRIEF.md`:
- Never promise returns. Avoid "pays for itself", "free", "guaranteed" and rising price charts.
- Show one estimate, based on daily volume per GPU mining ($750 by default), labeled "Estimate, not a promise". The math is on the home page (`#math`).
- Say "tax" rather than "fee" on the site; that's the word traders use.
- Keep "we will never ask for your seed phrase" and the risk disclaimer in the footer.

"Works with" uses plain-text names rather than logos. Check each brand's trademark rules before swapping in official logos.
