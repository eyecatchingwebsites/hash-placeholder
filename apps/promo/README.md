# Promo reel (`apps/promo`)

A 35-second launch teaser in the style of Apple's product films: black, one line of type at a time, blur-to-sharp reveals, and the product (the coin, then the real app) as the hero with slow camera moves. 1920×1080, 60 fps, silent (add music when posting).

| Time | Scene |
|---|---|
| 0–3 s | "Your GPU." / "Idle most of the day." |
| 3–7 s | A field of dots (PCs) lights up gold from the middle: "What if it got paid to work?" |
| 7–11 s | The dots pour into the coin; it turns in, a light sweeps across it, "Hashcoin" |
| 11–15 s | "The first token your GPU gets paid to buy." |
| 15–23 s | The app tilts up into view; the camera zooms to the coin, a cursor clicks it and it starts mining, then pans to the levels |
| 23–27 s | Hard cuts: "Mine it." "Hold it." "Or both." |
| 27–31 s | The tax split donut: "A 2–5% tax on every trade. Back to miners and holders." |
| 31–35 s | End card: coin, "Hashcoin", "Coming soon.", fine print |

## Files

- `index.html`: the reel. Every frame is a pure function of time (`seek(t)`), so renders are exact. Open it in a browser to watch it loop, or add `?t=19.5` to freeze a moment.
- `render.mjs`: steps through the reel with Playwright and pipes PNG frames to ffmpeg.
- `assets/`: the coin, Inter (OFL), and 3× screenshots of the app (`app-off.jpg`, `app-on.jpg`) taken from `apps/desktop/ui` with a sample wallet. Retake them if the app changes.

## Render

```sh
node apps/promo/render.mjs                    # apps/promo/out/hashcoin-promo.mp4
node apps/promo/render.mjs --stills 2,12,19.5 # PNG stills for checking
```

Needs Playwright and ffmpeg (on PATH, or `FFMPEG=<path>`; the `ffmpeg-static` npm package works). A full render takes a few minutes.

Copy rules from `CLAUDE.md` apply: no promised returns; the app shot carries "Sample wallet and numbers." and the end card says "Estimates, not promises."
