# Promo reel (`apps/promo`)

A 53-second launch film (v4). **One world, one camera:** every part of the system sits on a single loop, and the camera flies from step to step along it, dipping out a little on each move, then pulls back to show the whole loop at once. The coin that forms in the opening is the same $HASH node the story comes back to. One short line per step, written plainly. Motion blur comes from blending sub-frames (see Render). 1920×1080, 60 fps, silent (add music when posting).

| Time | Line on screen | Picture |
|---|---|---|
| 0–3 s | Most coins need buyers. | A dim field of dots (every dot a PC) |
| 3.7–8 s | $HASH makes its own. | The dots light up gold and pour into the $HASH coin |
| 8–14 s | Your GPU mines in the background. | The camera flies to the GPU; soft rings breathe out of it |
| 14–20 s | It picks the coin that pays most. | Quantus, QubitCoin and Pearl appear; the app checks each, Pearl wins |
| 20–25.6 s | Then it buys $HASH on Solana. | Light runs from Pearl to the $HASH coin (Solana badge); the coin beats as each buy lands |
| 25.6–30.8 s | People buy and sell $HASH. | Traders, with BUY and SELL tags rising |
| 30.8–36 s | Every trade pays a 2–5% tax. | Small gold trails run into the tax node |
| 36–41.6 s | The tax pays holders and miners. | Light runs from the tax to holders and miners, and back to the GPUs |
| 41.6–47 s | One loop. Around the clock. | The camera pulls back: the whole loop, light running all the way round |
| 47–53 s | $HASH. On Solana. Coming soon. | End card and fine print |

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

Needs Playwright and ffmpeg (on PATH, or `FFMPEG=<path>`; the `ffmpeg-static` npm package works). A full render with motion blur takes about 20 minutes; `--sub 1` drafts in about 5.

Copy rules from `CLAUDE.md` apply: no promised returns; the app shot carries "Sample wallet and numbers." and the end card says "Estimates, not promises."
