# Promo reel (`apps/promo`)

An 84-second launch film (v5). The opening is a field of dots (every dot a PC) pouring into the $HASH coin. Then the loop: every step sits on one loop and the camera pans straight from step to step (smooth sine easing, no zoom dips). After the tax, the camera pushes into the vault and the film switches to slides for the parts that need a picture of their own (the self-adjusting tax, the split, miner bonus, holder rewards, levels), then comes back out at holders and miners and pulls back to the whole loop. Illustrated icons: a graphics card whose fans spin once it mines, a candlestick chart, a vault whose dial turns, a wallet with coins. One short line per step. Motion blur from blended sub-frames. 1920×1080, 60 fps, silent (add music when posting).

| Time | Line on screen | Picture |
|---|---|---|
| 0–8 s | Most coins need buyers. / $HASH makes its own. | Dots light up gold and pour into the coin |
| 8–13.8 s | Your GPU mines in the background. | The graphics card, fans spinning, rings breathing out |
| 13.8–19.8 s | It picks the coin that pays most. | Quantus, QubitCoin and Pearl; the app checks each, Pearl wins |
| 19.8–25.4 s | Then it buys $HASH on Solana. | Light runs into the $HASH coin (Solana badge), which beats as each buy lands |
| 25.4–30.6 s | People buy and sell $HASH. | The chart, with BUY and SELL tags rising |
| 30.6–37 s | Every trade pays a 2–5% tax. | Trails run into the vault; the camera pushes into it |
| 37–44.6 s | Slow trading? The tax goes up. / Busy trading? It goes down. | A 2%–5% gauge over a strip of trading bars: quiet bars, the rate climbs to 5%; busy bars, it falls to 2.25% |
| 44.6–50 s | The tax is split three ways. | One bar: miners 45–75%, holders 20–50%, dev 5–10% |
| 50–57 s | Miners get a bonus on top. / Up to 5× their mining, on average. | The graphics card sends light into a bar: "your mining", then the gold bonus stacking to 5× |
| 57–63.6 s | Holders get paid just for holding. / At least 1% of every trade. | $HASH coins arcing into a wallet |
| 63.6–70 s | Hold longer and mine more. / Level up for up to 4× the share. | Level 1, 2, 3 cards: 1×, 2×, 4×, with dot bars 1 : 2 : 4 |
| 70–77 s | One loop. Around the clock. | Back out at holders and miners, then the whole loop |
| 77–84 s | $HASH. On Solana. Coming soon. | End card and fine print |

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
