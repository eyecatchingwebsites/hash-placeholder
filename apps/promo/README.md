# Promo reel (`apps/promo`)

An 80-second launch film (v6). The opening is a field of dots (every dot a PC) pouring into the $HASH coin. Then the loop: every step sits on one loop and the camera pans straight from step to step (about a second per move, smooth sine easing, no zoom dips). After the tax, the camera pushes into the vault and the film switches to slides for the parts that need a picture of their own (the self-adjusting tax, the split, miner bonus, holder rewards, levels), then comes back out at holders and miners and pulls back to the whole loop. Illustrated icons: a graphics card whose fans spin once it mines, a candlestick chart, a vault whose dial turns, a wallet with coins. One short line per step. Motion blur from blended sub-frames. 1920×1080, 60 fps, silent (add music when posting).

| Time | Line on screen | Picture |
|---|---|---|
| 0–8 s | Most coins need buyers. / $HASH makes its own. | Dots light up gold and pour into the coin |
| 8–12.8 s | Your GPU mines in the background. | The graphics card, fans spinning, rings breathing out |
| 12.8–17.6 s | It picks the coin that pays most. | Quantus, QubitCoin and Pearl; the app checks each, Pearl wins |
| 17.6–22.2 s | Then it buys $HASH on Solana. | Light runs into the $HASH coin (Solana badge), which beats as each buy lands |
| 22.2–26.6 s | People buy and sell $HASH. | The chart, with BUY and SELL tags rising |
| 26.6–32 s | Every trade pays a 2–5% tax. | Trails run into the vault; the camera pushes into it |
| 32–39.7 s | Slow trading? The tax goes up. / Busy trading? It goes down. | A 2%–5% gauge over a strip of trading bars: quiet bars, the rate climbs to 5%; busy bars, it falls to 2.25% |
| 39.7–45.3 s | The tax is split three ways. | One bar: miners 45–75%, holders 20–50%, dev 5–10% |
| 45.3–52.1 s | Miners get a bonus on top. / Up to 5× their mining, on average. | Pearl tokens flip out of the graphics card into "your mining", then gold $HASH coins drop in as the bonus, stacking to 5× |
| 52.1–58.7 s | Holders get paid just for holding. / At least 1% of every trade. | $HASH coins arcing into a wallet |
| 58.7–65 s | Hold longer and mine more. / Level up for up to 4× the share. | Level 1, 2, 3 cards: 1×, 2×, 4×, with dot bars 1 : 2 : 4 |
| 65–72.6 s | One loop. Around the clock. | Back out at holders and miners, then the whole loop |
| 72.6–80 s | $HASH. On Solana. | End card: Website and Windows app, both "Coming soon", and fine print |

Third-party marks, used unaltered: the Pearl, Quantus and QubitCoin marks the user supplied (`assets/pearl-mark.png`, `quantus.png`, `qubitcoin.png`, turned light-on-transparent for the dark nodes) and the Solana logomark (`assets/solana.svg`, from solana.com/branding, which forbids implying endorsement). The end card says we aren't affiliated with any of them.

## Files

- `index.html`: the film. The world (nodes in DOM, links and light on a canvas) sits under one camera transform; the words are in screen space, built word by word. Every frame is a pure function of time (`seek(t)`), so renders are exact. Open it in a browser to watch it loop, or add `?t=19.5` to freeze a moment.
- `render.mjs`: steps through the film with Playwright and pipes frames to ffmpeg. `--sub 4` (the default) renders four sub-frames per frame over half a frame and blends them (ffmpeg `tmix`), which is the motion blur.
- `assets/`: the coin, Inter (OFL), the Pearl and Solana marks above, and 3× screenshots of the app (`app-off.jpg`, `app-on.jpg`, used by earlier cuts) taken from `apps/desktop/ui` with a sample wallet.

## Render

```sh
node apps/promo/render.mjs                    # apps/promo/out/hashcoin-promo.mp4
node apps/promo/render.mjs --stills 2,12,19.5 # PNG stills for checking
```

Needs Playwright and ffmpeg (on PATH, or `FFMPEG=<path>`; the `ffmpeg-static` npm package works). A full render with motion blur takes about 45 minutes; `--sub 1` drafts in about 10.

Copy rules from `CLAUDE.md` apply: no promised returns; the app shot carries "Sample wallet and numbers." and the end card says "Estimates, not promises."
