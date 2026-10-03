# Website Design Brief

Written October 3, 2026. For the website build in a local session (where the site can be run in a browser and iterated on). Read with `docs/PROJECT.md`.

## Positioning
Hashcoin is a **mining platform with its own token**, not a meme. The site should feel like a real product company: confident, minimal, built on live data. The token is how you take part, not the punchline.

## What the reference sites have in common
The user picked these from the fomo.family trending list: usepaid.app, usehotbot.com, octoprotocol.io, boneronlong.xyz.

| Site | What to take from it |
|---|---|
| **usepaid.app** | Product first. A short, plain headline that says exactly what it does ("Direct creator fees to X accounts"), then **live feeds of real activity**: recent payments, top tokens, top profiles. Little decoration; the data is the decoration. Monospace numbers. |
| **usehotbot.com** | Big confident headlines with dry humor ("Built different. Up all night"). **Real product screenshots** instead of abstract art. Logos of tools it works with (Pump.fun, Jupiter, Raydium) for legitimacy. "Keep using the tools you already use." |
| **octoprotocol.io** | One clear metaphor carried through the brand ("Liquidity with many arms"). (Most of the page renders in JavaScript and couldn't be fetched; check it in a browser during the build.) |
| **boneronlong.xyz** | **Commits fully to one concept:** it dresses up as a real company in another industry (a pharmaceutical brand) and keeps the joke perfectly consistent. Clean, lots of white space, one mascot used again and again. |

**Shared traits to copy:**
- One idea per site, stated in under 3 seconds.
- Restraint: one accent color, lots of space, few elements per screen.
- Real product UI and live numbers instead of generic crypto art.
- Copy with personality, but short.
- A clear buy or use button in the same place every time.

**Avoid (the user's instruction):**
- Rainbow or gradient buttons.
- Overcrowded layouts.
- Stacks of badges, glowing everything, emoji as decoration.

## The concept
**"Your GPU's night shift."** The site presents Hashcoin as a clean hardware/cloud company whose product is putting idle gaming GPUs to work. The hero is one beautifully lit GPU. As you scroll, the camera follows the work it does through the whole cycle.

Tone: calm, precise, a little dry, like a premium hardware launch. Humor sits in small copy lines ("Your GPU doesn't sleep. Neither does the chest."), never in the layout.

## Page structure (scroll story)
| # | Section | Visual | Copy job |
|---|---|---|---|
| 1 | **Hero** | A single 3D GPU, fans slowly spinning, a thin line of light pulsing through it on black. Subtle mouse parallax | Name, ticker, one line: "The memecoin your GPU mines." Two buttons: Register your GPU / How it works |
| 2 | **Live strip** | Monospace counters: GPUs online, $HASH bought by miners, paid to miners, chest now | "—" until launch, then live. Credibility from real data |
| 3 | **The cycle** (pinned, scroll-driven) | Camera pulls back. Hash particles leave the GPU and become mined coins (PRL/QTC tokens), which flow into the $HASH coin. Trades around the coin throw 2.5% sparks into the chest, which pays back out to the GPUs. The loop closes and keeps orbiting | One short caption per step, appearing as each step plays: Mine → Convert → Fee → Chest → Paid |
| 4 | **Live payouts feed** | A usepaid-style list of real payouts (wallet, GPU, amount, Solscan link) | Proof it works. A labeled preview before launch |
| 5 | **The app** | Real screenshot or 3D render of the desktop app on a monitor | "Paste your wallet. Press Start." 3 steps, the signed and open-source note |
| 6 | **Levels** | Three pedestals at 1×, 2× and 4×, each with a coin stack of a different height | The rules in four short lines |
| 7 | **Earnings example** | The calculator, restyled to match | Clearly labeled as an example |
| 8 | **Token** | One clean fee bar (2.5% / 0.5%) and a facts list | The Token-2022 fee nobody can avoid, dev 1% locked, the contract address only on this site |
| 9 | **Works with** | Logos: Solana, Jupiter, Raydium, NVIDIA/AMD/Intel Arc (check trademark rules), Solscan | Legitimacy |
| 10 | **FAQ + footer** | Plain | Antivirus, safety, risks, disclaimer |

## Visual system
- **Background:** near-black with a faint cool tint. One accent color, used only for actions and the energy moving through the cycle (current proposal: amber, open to change).
- **Light:** most of the drama comes from lighting the 3D objects (rim lights, soft reflections on a dark floor), not from UI color.
- **Type:** one distinctive display face (wide or technical), one clean sans for body text, one monospace for numbers. Big headlines, short lines.
- **Motion:** scroll-driven only where it explains something (the cycle). Everything else uses small hover and number transitions. Respect reduced-motion settings with a static illustrated fallback.
- **Mobile:** a lighter scene (lower polygon count, no post-processing). The cycle becomes a pre-rendered video loop or a simplified animation if the device is slow.

## Tech
Next.js (or Astro) on Vercel, Three.js via react-three-fiber, GSAP ScrollTrigger + Lenis for scroll, drei helpers. Models as compressed `.glb` (Draco/meshopt) with a load budget of about 3 MB on desktop and about 1.2 MB on mobile. Track Lighthouse performance from the start.

## Copy rules
- No return promises ("pays for itself", "free", "guaranteed"). Price charts are fine (user, Oct 3); the cycle shows the **mechanism**: the buying and the chest filling.
- Live numbers only from real data. Before launch, show "—" or label things clearly as a preview.
- The contract address appears only on the site, at launch.

## Open questions for the user
- Final name (candidates in PROJECT.md).
- The accent color once the GPU render exists (try amber, electric blue and white-only).
- Whether to add a small mascot (e.g. a tiny GPU character) for social posts while keeping the site clean.
- Whether to make a 20–30 s trailer from the cycle scene for X at launch.
