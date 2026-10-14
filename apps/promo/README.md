# Promo reel (`apps/promo`)

An 80-second launch film (v7, paced for reading, cut to music). The opening is a field of dots (every dot a PC) pouring into the $HASH coin. Then the system: the coin stays large in the centre and every other step orbits it on a tilted ring (graphics card, Pearl with Quantus and QubitCoin, traders, the tax vault, holders and miners). The ring turns one step per beat to bring the next icon to the front-left, with a slow drift so nothing sits still; flows run between icons and into the coin. An iris opens out of the vault into slides that push left one after another (the tax and its split moving with the market, the miner bonus, a holder example, the levels), then closes back onto the whole system spinning, which collapses into the coin for the end card. One short line per beat, a grey second line where needed. 1920×1080, 60 fps, motion blur, with music and sound effects.

**Pace and music.** The timeline is written at 58.5 s of story time. `PACE` in `index.html` plays the stretches with something to read slower (eased in and out) and the moves between them at full speed. The film is then locked to the music (`MUSIC` and `SYNC`): the track (`audio/hashmusic.mp3`) plays from its 0:10 mark with a 1.2 s fade-in; the orbit unfolds on the drop at track 0:17.5 (film 0:07.5); the end screen lands as the track falls into its outro at 1:21 (film 1:11). Between sync points the reading pace is deepened or eased by one factor per stretch so each point lands exactly. The end card holds to 1:20, where the picture and music fade out (3.5 s). The times in the table below are story time.

**Sound effects.** `SFX_FILES` and `sfxCues()` in `index.html` place 146 effects, each written against the animation (story time), so they stay on their frames if the pace changes: a reversed deep whoosh building into the coin, the closing iris and the collapse; ticks as the app checks Quantus and QubitCoin and a chime when Pearl wins; whooshes on orbit turns and slide pushes; a pop on the Solana badge and the BUY/SELL tags; coin clinks (three files rotated, levels varied) wherever tokens land; a deep whoosh as the iris opens; a tick on every 0.25% the tax moves and every 0.2% of the holder counter; stamps as 1×, 2×, 4× land; a soft low thud under "$HASH" and ticks on the "Coming soon" cards. `LIFT` sets each kind's level against the music (which is mastered loud, about −11 dB RMS).

**Audio files.** The music and effects are licensed and kept out of git (the repo is public): `apps/promo/audio/hashmusic.mp3` and `apps/promo/audio/sfx/` (`coin1.wav`, `coin2.wav`, `coin3.wav`, `deepwhoosh.wav`, `pop.wav`, `stampthud.ogg`, `success.wav`, `tick.wav`, `woosh.flac`). Render with `--no-music` / `--no-sfx` to leave either out. The picture renders to `out/video.mp4`; `--mix-only` redoes just the sound over it in a few seconds.

| Story time | Line on screen | Picture |
|---|---|---|
| 0–6.9 s | Most coins need buyers. / $HASH makes its own. | Dots light up gold and pour into the coin; the orbit unfolds around it |
| 6.9–9.6 s | Your GPU mines whatever pays most. | The graphics card (fans spinning) checks Quantus, QubitCoin and Pearl; Pearl wins |
| 9.6–12.8 s | Then it buys $HASH on Solana. | Pearl tokens flip into $HASH on the way into the coin, which beats as they land (Solana badge) |
| 12.8–15.7 s | People buy and sell $HASH. | The chart, BUY/SELL tags rising, buys and sells running in and out of the coin |
| 15.7–19.2 s | Every trade pays a 2–5% tax. | Coins from each trade drop into the vault; an iris opens out of it |
| 19.2–28.6 s | The tax is split three ways. It shifts with the market. / Slow trading? The tax goes up. Most of it goes to miners. / Busy trading? The tax goes down. Holders get a bigger cut. | Trading bars, the rate (2–5% track) and one split bar, all moving together: typical 2.75% (miners 48 / holders 43 / dev 9), slow 5% (75 / 20 / 5), busy 2.25% (45 / 45 / 10). Numbers from the engine's formula (`apps/web/assets/js/model.js`) |
| 28.6–34.4 s | Miners get a bonus on top. Up to 5× their mining, on average. | Pearl tokens flip out of the graphics card into "your mining", then $HASH coins stack the bonus to 5× |
| 34.4–41.2 s | Holders get paid just for holding. At least 1% of every trade goes to them. / What can a holder earn? Example: Level 3, 5% tax, busy trading. | Coins arc into a wallet; a one-day ring sweeps round it while "+2.8% of your bag, every day" and "$2,500 bag: about $70 a day" count up, with an "Example only … not guaranteed" line |
| 41.2–48.6 s | Bigger bag, higher level. Hold it longer to unlock the next one. / Higher level, bigger share. Level 3 counts your bag 4 times. | Three cards as steps: $50+ (no wait), $500+ (held 1 day), $2,500+ (held 7 days), coin stacks growing; then 1×, 2×, 4× land and each stack splits into 1, 2 and 4 copies |
| 48.6–53.4 s | One loop. Around the clock. | The iris closes onto the whole system spinning, labelled, comets running round the ring; it collapses into the coin |
| 53.4–58.5 s | $HASH. On Solana. | End card: Website and Windows app, both "Coming soon", and fine print |

The holder example is `model.js` at a forced 5% tax, Level 3, 30% of market cap traded a day (the site's default turnover): holders get 50% of the tax (2.5% of volume) and a Level 3 bag earns 2.79% a day. It is labelled as an example and not guaranteed on screen.

Third-party marks, used unaltered: the Pearl, Quantus and QubitCoin marks the user supplied (`assets/pearl-mark.png`, `quantus.png`, `qubitcoin.png`, turned light-on-transparent for the dark nodes) and the Solana logomark (`assets/solana.svg`, from solana.com/branding, which forbids implying endorsement). The end card says we aren't affiliated with any of them.

## Files

- `index.html`: the film. The system (coin and orbiting icons in DOM, the ring, beams and tokens on canvases under and over them) sits under one camera transform; the slides are a clipped layer (the iris) of slides that push; the words are in screen space, built word by word. Every frame is a pure function of time (`seek(t)`), so renders are exact. Open it in a browser to watch it loop, or add `?t=19.5` to freeze a moment.
- `render.mjs`: steps through the film with Playwright and pipes frames to ffmpeg. `--sub 4` (the default) renders four sub-frames per frame over half a frame and blends them (ffmpeg `tmix`), which is the motion blur.
- `assets/`: the coin, Inter (OFL), the Pearl and Solana marks above, and 3× screenshots of the app (`app-off.jpg`, `app-on.jpg`, used by earlier cuts) taken from `apps/desktop/ui` with a sample wallet.

## Render

```sh
node apps/promo/render.mjs                    # apps/promo/out/hashcoin-promo.mp4
node apps/promo/render.mjs --stills 2,12,19.5 # PNG stills for checking
```

Needs Playwright and ffmpeg (on PATH, or `FFMPEG=<path>`; the `ffmpeg-static` npm package works). A full render with motion blur (`--sub 4`) takes about 30 minutes; `--sub 1` (no blur) about 5.

Copy rules from `CLAUDE.md` apply: no promised returns. The only earnings figure (the holder example) states its assumptions on screen and says payouts change with trading and are not guaranteed; the end card says "Not financial advice."
