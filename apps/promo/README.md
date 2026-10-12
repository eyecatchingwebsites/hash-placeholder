# Promo reel (`apps/promo`)

A 32-second launch teaser. The message is the thing that makes Hashcoin different from the thousands of GPU-mineable coins: **your GPU doesn't mine $HASH, it buys it, on Solana.** One field of about 3,600 dots carries the whole film (they are GPUs, they form the words, they flow through Solana into buys, they loop as the tax, and they end as $HASH), with Apple-style type on black. 1920×1080, 60 fps, silent (add music when posting).

| Time | Scene |
|---|---|
| 0–3.8 s | A field of dots with a wave of light: "There are thousands of GPU coins." A shock ring dims them: "$HASH isn't one of them." |
| 3.8–7.3 s | "Your GPU doesn't mine it." The dots fly together into gold dot-text: "It buys it." |
| 7.3–13 s | GPUs (a mining cluster) send white dots through a Solana ring, where they turn gold and stack into a rising chart of buys: "GPUs mine other coins in the background." / "Every payout buys $HASH on Solana." |
| 13–18.7 s | The dots become a loop (GPUs buy, people trade, 2–5% tax, paid back to miners and holders); each dot flashes as it passes the tax point |
| 18.7–22.6 s | "Built on" Solana, in dots coloured with Solana's purple-to-green, plus "Token-2022. 21 million supply. Minting switched off for good." |
| 22.6–27 s | The app tilts in; a cursor clicks the coin and dots burst out of it: "One click. It runs in the background." |
| 27–32 s | The dots form $HASH. "On Solana. Coming soon." and fine print |

Solana appears as the word in its brand colours, not the logo. Check the Solana Foundation's brand guidelines before adding their logo.

## Files

- `index.html`: the reel (a canvas of dots plus a few DOM layers for words and the app). Every frame is a pure function of time (`seek(t)`), so renders are exact. Open it in a browser to watch it loop, or add `?t=19.5` to freeze a moment.
- `render.mjs`: steps through the reel with Playwright and pipes PNG frames to ffmpeg.
- `assets/`: the coin, Inter (OFL), and 3× screenshots of the app (`app-off.jpg`, `app-on.jpg`) taken from `apps/desktop/ui` with a sample wallet. Retake them if the app changes.

## Render

```sh
node apps/promo/render.mjs                    # apps/promo/out/hashcoin-promo.mp4
node apps/promo/render.mjs --stills 2,12,19.5 # PNG stills for checking
```

Needs Playwright and ffmpeg (on PATH, or `FFMPEG=<path>`; the `ffmpeg-static` npm package works). A full render takes a few minutes.

Copy rules from `CLAUDE.md` apply: no promised returns; the app shot carries "Sample wallet and numbers." and the end card says "Estimates, not promises."
