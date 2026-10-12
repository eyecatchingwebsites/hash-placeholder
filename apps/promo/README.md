# Promo reel (`apps/promo`)

A 60-second launch film for traders (v3). It opens on a hook, then explains the whole architecture one step at a time, styled after $PAID's fee-configuration video: a dark grid, one sentence at a time with words sharpening out of a blur, and a pipeline of round nodes with light travelling along the links. Our signature is the dot field: every dot is a PC. 1920×1080, 60 fps, silent (add music when posting).

| Time | Scene |
|---|---|
| 0–11 s | "What if every gaming PC was buying your bag?" over a field of dots lighting up gold; "Around the clock. Automatically."; the dots pour into the coin: "Meet $HASH. The token GPUs buy. On Solana." |
| 11–18 s | "Your GPU mines whatever pays most." GPU → Quantus / QubitCoin / Pearl; the app scans and Pearl wins (Pearl's own art and logotype) |
| 18–25 s | "Mined coins are sold. Every payout buys $HASH." GPU → Pearl → Sold → Buys $HASH on Solana → Your wallet |
| 25–32 s | "Every trade pays a 2–5% tax." Buys and sells each send their tax into the reward pot (Token-2022: every DEX) |
| 32–39 s | "A public formula splits the tax." Miners 45–75%, holders 20–50%, development 5–10% |
| 39–45 s | "Quiet market, higher tax. Busy market, lower." A slider moves the rate from 5% to 2.25% |
| 45–51 s | "Hold longer. Mine more. Up to 4× the share." Level 1 / 2 / 4 bars made of dots |
| 51–57 s | "GPUs buy. Traders trade. The tax pays it back." The loop |
| 57–60 s | $HASH. "On Solana. Coming soon." Fine print, including "Not affiliated with Pearl or the Solana Foundation." |

Third-party marks, used unaltered: Pearl's logotype and "genesis" pearl art (`assets/pearl-logotype.svg`, `assets/pearl-genesis.webp`, from pearlresearch.ai's brand files) and the Solana logomark (`assets/solana.svg`, from solana.com/branding, which forbids implying endorsement).

## Files

- `index.html`: the reel (a canvas for the dots, links and light; DOM for nodes, labels and words built word by word). Every frame is a pure function of time (`seek(t)`), so renders are exact. Open it in a browser to watch it loop, or add `?t=19.5` to freeze a moment.
- `render.mjs`: steps through the reel with Playwright and pipes PNG frames to ffmpeg.
- `assets/`: the coin, Inter (OFL), the Pearl and Solana marks above, and 3× screenshots of the app (`app-off.jpg`, `app-on.jpg`, used by earlier cuts) taken from `apps/desktop/ui` with a sample wallet.

## Render

```sh
node apps/promo/render.mjs                    # apps/promo/out/hashcoin-promo.mp4
node apps/promo/render.mjs --stills 2,12,19.5 # PNG stills for checking
```

Needs Playwright and ffmpeg (on PATH, or `FFMPEG=<path>`; the `ffmpeg-static` npm package works). A full render takes a few minutes.

Copy rules from `CLAUDE.md` apply: no promised returns; the app shot carries "Sample wallet and numbers." and the end card says "Estimates, not promises."
