# $HASH / Hashcoin: Project File (v3)

Last updated: October 3, 2026. Stage: design, simulation, and early build. Numbers are scenario assumptions, not forecasts. Not financial or legal advice.

- Original v1 notes (from the earlier chat): `docs/PROJECT-v1-original.md`
- Architecture: `docs/ARCHITECTURE.md`
- Simulation: `sim/` (see `sim/README.md`)
- Payout engine (TypeScript, tested): `packages/engine`
- Earnings calculator: `calculator/index.html` (published: https://claude.ai/artifact/CDWZXxmNsZw4DNCxHhdJY5)
- **Technical plan (ordered build plan for the next sessions): `docs/TECHNICAL-PLAN.md`**
- Website design brief: `docs/DESIGN-BRIEF.md` (3D brief `docs/3D-BRIEF.md` is shelved: no 3D models for now)
- **Website questionnaire (generates the build prompt): `apps/web/brand/website-questionnaire.html`** (published: https://claude.ai/artifact/T7dniP5JRG8bMSfKyZEfSe)
- Logo: `apps/web/brand/logo/` · logo explorations: https://claude.ai/artifact/JTubhyKEYFEAsCWrdL9jF9 · color picker: https://claude.ai/artifact/H4h9afZLydLLgRYaXWqFnd
- **Website (static front end): `apps/web`** (`index.html`, `calculator.html`, `faq.html`; how to run: `apps/web/README.md`). **Live preview link (always the latest version): https://claude.ai/artifact/6mwmqXA78PGKKqr17gNmSc**. Republish it after every website change (from `apps/web/standalone/`). The old draft artifact (https://claude.ai/artifact/6rNGUh1g9ajuANnbFjGzrJ) is outdated.
- Creator earnings over time: `calculator/creator.html` (published: https://claude.ai/artifact/GeRFqwnVPJuVLFzcsP6J1Y)
- Work happens in a Claude Code cloud session (the user has $100 of gifted cloud credits). Branches so far: `claude/lucid-fermat-16svvo`, then `claude/vibrant-cray-fpbieb` (website build).

---

## 1. Summary
A memecoin plus GPU-mining platform, marketed to **memecoin traders who have gaming PCs** (pre-existing miners will find it anyway if it pays). Users mine through the platform. What they mine is sold to buy $HASH, which is paid back to them. A 5% tax on every $HASH trade pays miners (up to 3.5%, targeted at 5× what their GPUs mine) and holders (at least 1%), with two level ladders: miner levels M1–M3 and holder levels H1–H3. Pitch: "The memecoin your GPU mines." Goal: a lasting coin. The creator prefers a stable $500K–1M market cap for 6 months over a few-day $10M runner, though both are fine outcomes.

## 2. Token and fee (decided, pending launchpad verification)
- **Solana, Token-2022 with the transfer-fee extension.** The fee is enforced by the token program on every transfer, in every pool, aggregator and wallet. Nobody can trade around it.
  - Lesson from **$UPLIFT**: it crashed because people bought on other exchanges and avoided its fee. Its chest (paying wallets that lost money) dried up. Token-2022 prevents this.
- **5% tax, split automatically (decided Oct 3, replaces the earlier 3% fee):**
  - **0.5% to development**, fixed.
  - **Miner chest: 0% to 3.5%.** Each epoch the chest takes exactly what lifts miners' total pay to **5× what their GPUs mined** (mining + a chest cut worth 4× mining, averaged over all miners), capped at 3.5%.
  - **Holders: 1% to 4.5%.** Everything the chest doesn't take. Holders always get at least 1%.
  - **No burn** (decided). The tax is collected in $HASH, so a "buyback" would just be a burn; all of the holder side is paid out instead.
  - The formula is public and mechanical, and the site shows the current split live. Engine: `splitTax` in `packages/engine`.
  - Reaching 5× needs about **$283 of daily volume per mining GPU** (4 × $2.50 ÷ 3.5% − $2.50). Above that miners get exactly 5× and holders get more; below it miners get the full 3.5% and holders get 1%.
- **Why 5% now:** with a dynamic split, the higher tax pays miners and holders more instead of looking like extraction. Trade-offs: a round trip costs 10% instead of 6% (fewer flippers, less volume), and Raydium LaunchLab's reward launch (1% or 3%, unverified) probably can't do 5%, so the likely route is our own Token-2022 token with a Raydium CPMM or Orca pool. The sim: if 5% cuts volume 30%, miner income falls ~20%.
- **Fee authorities:** fee config and withdraw authorities in a multisig. Publicly commit to never raising the fee, and ideally renounce the config authority after launch. Set the max fee per transfer high.
- **Our own transfers are taxed too** (payouts to miners, etc.). The fee is held in the recipient account and collected back into the treasury, so it recirculates. Send a little extra so miners receive the full amount.
- **Launchpad:**
  - **pump.fun can't do this.** Its creator fee is fixed (0.30% on the curve, then 0.95% → 0.05% on PumpSwap), only charged in its own pools, and can be avoided elsewhere, which is the $UPLIFT problem.
  - **Options:**
    - (a) Raydium LaunchLab reward launch. Needs verifying: whether 5% is possible (it appeared to allow 1% or 3%), who controls the authorities, and where fees go.
    - (b) Our own Token-2022 token plus a Raydium CPMM or Orca pool (both support transfer-fee tokens). We'd bring our own traffic.
  - **"Fomo"** (a trading app): unknown. If it routes to any exchange, the Token-2022 fee still applies.
- **Dev holding: 1% of supply.**
  - Bought openly as a dev buy at launch, in one public wallet.
  - Locked or vested publicly, e.g. no sells for 90 days, then at most 0.25% of supply per month.
  - **The dev wallet is excluded from the chest and the holder pot** (no self-dealing).
  - Dev holdings, the dev-fee wallet, and the treasury/float multisig are kept separate.

## 3. Levels: two ladders (decided Oct 3, replaces the earlier L1–L3)
**Holder levels** (anyone holding $HASH, mining or not):

| Level | Bag | Hold clock | Holder-pot weight |
|---|---|---|---|
| H1 | ≥ $50 | none | 1× |
| H2 | ≥ $500 | ≥ 24 hours | 2× |
| H3 | ≥ $2,500 | ≥ 72 hours | 4× |

- **Holder pot share** = bag × holder multiplier, each wallet capped at 5% of the pot (excess shared out, rest carries). Linear in the bag, not √, so splitting one bag across wallets gains nothing.
- **Hold clock:** starts when $HASH first lands in the wallet and keeps running through dips. **Selling shrinks it in proportion** (sell 25% of the bag → the clock drops 25%; sell everything → it resets). Buying never moves it. Short clocks because tokens move fast (user decision). Transfers out count as selling, including wallet-to-wallet moves, LP and CEX deposits.
- **Dips:** falling below a bag threshold drops the level; recovering restores it immediately, no new wait.
- **Excluded from the holder pot:** dev, treasury, payout, liquidity-pool and exchange wallets.
- **Payout cadence:** hourly or daily (paying every holder every 10 minutes costs too much in transactions). Draft.

**Miner levels** (chest weight = √(GPU USD earnings) × miner multiplier, 5% cap per wallet):

| Level | Days mined (last 7) | Needs | Chest weight |
|---|---|---|---|
| M1 | any | – | 1× |
| M2 | ≥ 2 | H1 | 2× |
| M3 | ≥ 5 | H2 | 4× |

- Gating M2/M3 on holder levels keeps the reason for miners to buy and hold (user decision); the sim found buying-in to level up is what lifts price most.
- Miners who hold also earn from the holder pot on their own bag: doing both pays from both pots.
- **Mined $HASH counts** toward holder thresholds. **Position value** uses a ~1-hour average price, checked at each payout.
- **The website shows "paid in the last 24h" per level** after launch, never promised percentages. Only the 1:2:4 ratios, the 5× target, the 3.5% cap and the 1% holder minimum are fixed.
- **Sqrt balancing** for miners: small GPUs get the biggest multiplier relative to what they mine.
- Engine: `computeHolderLevel`, `computeMinerLevel`, `applyBalanceChange` (hold clock), `runEpoch` (miners), `runHolderPayout` (holders) in `packages/engine`.

## 4. Payouts and trust (decided)
- **Credit by shares.** Shares are proof of work, checked by the pool instantly, and can't be faked. "Flash" fake crypto doesn't apply, since miners never send us crypto.
- **Hybrid payout:**
  - ~75% of estimated mining earnings paid in $HASH every ~10 minutes from a float.
  - The remaining ~25% after the mined coin confirms (10+ hours) and sells, trued up to the actual sale price. The platform absorbs any overpayment and never claws it back.
  - The float shrinks the immediate share automatically when it runs low.
- **The chest** is already in the treasury, so it pays every epoch.
- **Float:** about 1–2× miner revenue over the confirmation window (≈ $1K at 500 miners).
- **Wait for confirmation (Solana `finalized`)** on: stake deposits, anything users send, and float top-ups (confirmed sales only).
- **Block withholding:** monitor expected vs actual blocks, and flag big-share wallets that never land a block.
- **Dashboard:** "Paid" and "Pending confirmation" balances, level progress bars ("$12 to Level 2", "4 days to Level 3").
- **Keys:** never in the repo or chat. Deploy secrets only, payout wallets hold only the float, and the treasury is in a multisig.

## 5. Mining and auto-switching (decided direction)
- **Pearl (PRL)** faces competition from QUAN, QTC and EPIC (confirmed on hashrate.no: each is the top coin for some cards), so auto-switching is needed.
- **One coin for everyone, chosen centrally,** re-checked every few hours. Switch only when the gain is more than 10–15% and sustained.
- **Score coins by revenue you can actually sell:** revenue × price − slippage at platform sell volume − confirmation-delay risk.
- **Weights are in USD,** so different algorithms compare fairly. The float absorbs each chain's different confirmation times.
- **Minimum version:** an existing pool with per-worker stats, with worker name = payout wallet. The miner must support every algorithm we might switch to.
- **Open-source miner, published checksums, a VirusTotal link, and a code-signing certificate.**
- **GPU revenue data:** hashrate.no/gpus, fetched 2026-10-03. 91 cards (plus 42 estimated laptop GPUs in the site's list), saved in `data/hashrate-no-gpus-2026-10-03.json` and loaded into the calculator. 24h revenue on each card's best coin:
  - 5090 $10.71, 4090 $7.81, 5080 $5.22, 5070 Ti $4.37, 4080 $4.08, 4070 $2.96, 3090 $2.82, 3080 $2.70, 4060 $1.30, 3060 $1.08, 3060 Laptop $1.09.
  - AMD: RX 9070 XT $2.37 (PRL), RX 7900 XTX $1.56 (QTC).
  - The user's earlier figures for the 4060 ($2) and 3060 Laptop ($1.20) were higher than this.
  - **Best coin differs by card:** PRL tops most newer NVIDIA cards and even some AMD (RX 9070/XT). QUAN tops many older NVIDIA cards (20/30-series, 4060). QTC tops most AMD and Intel cards. EPIC tops some older and pro cards.
  - **AMD and Intel cards can mine too** (mostly QTC), so the platform isn't NVIDIA-only. One coin for everyone would leave AMD owners earning little. Consider per-brand or per-card coin choice (e.g. PRL for NVIDIA, QTC for AMD/Intel), or at least two pools.

## 6. Website (hashcoin .com, domain to be bought)
- **For traders:** "The memecoin your GPU mines."
  - Live stats: GPUs online, $HASH bought by miners, chest paid.
  - Why it has buy pressure, and why holders stay (levels).
  - Proof: Solscan payout feed, the pool's public page, the open-source repo.
  - Tokenomics box (5% tax: 0.5% development, up to 3.5% miners, at least 1% holders; 1% dev holding locked; contract address only at launch).
- **For miners:** "Mine with the PC you already have. Get paid in $HASH every 10 minutes."
  - A calculator showing what a GPU like yours earned yesterday, per level.
  - 3-step setup, the level explainer, safety.
  - The catch, stated honestly: volatile token, fees on exit, payouts vary.
- **Never say** "pays for itself," "free," "earn 10x," or "guaranteed." Show real numbers once they exist.

## 7. Launch plan (decided)
- **Nothing goes on X until the website and tech are basically finished and proven.**
- **No paid SOL beta** (boring, costs money, adds little).
- **Proof:**
  - One unedited, timestamped video: install → first payout with a Solscan link.
  - A small free test with people you know.
  - Open-source repo.
  - A devnet demo of the fee → chest → payouts.
- **Hype once ready:**
  - A "register your GPU" waitlist with a live counter. This also tests demand.
  - A visual of the full loop.
  - An illustrative calculator (clearly labeled).
  - GPU and gamer memes ("the weaker your GPU, the bigger your boost").
- **Launch-day readiness is the hook:** launch day pays the most per GPU.
- **No token promises to early users.** A launch-day head start is fine. Don't make the contract address easy to snipe.

## 8. Findings
*The first tables in this section use earlier designs (5% fixed split, then 3%) and the old sim accounting; the current design's results are in the "5× target, holders ≥ 1%" table further down.*

**Simulation (90 days, Python, `sim/`):**

| Design | Typical miner extra d7 / d30 / d90 | Renters' chest share | Price at d90 |
|---|---|---|---|
| Original (5% chest, linear) | 188% / 59% / 25% | 37% | 0.17× |
| Hold ramp + $50 stake | 410% / 279% / 44% | 7% | 0.20× |
| **Levels 1/2/4** | 862% / 157% / 59% (L1/L2/L3 at d30: 77% / 153% / 250%) | 16% | 0.40× |

- **Levels roughly double the price outcome,** because people buy in to reach L3.
- **Renters take ~16%,** because $50 gets them L2. Fixes: a higher L2 threshold, or a wallet-age requirement for L2.
- **Every design fades as the hype does.** The mechanism softens the decline but doesn't create demand.
- **Assumptions:** 20% of miners top up to $500 and 35% to $50.
- **Correction (Oct 3): the table above overstated prices.** The old sim treated every fee dollar (chest, burn, creator) as a market buy of $HASH. The Token-2022 tax is withheld in $HASH, so paying the chest, burning or paying holders creates no buying; only miners' mined coins do, and the dev share is sold for costs. Re-run with correct accounting (20 seeds, medians): Levels 1/2/4 at the old 3/1.5/0.5 split ends at **0.15×**, and the current 3% design (2.5% chest, 0.5% dev) at **0.12×**.

**Simulation: 5% dual-ladder proposal vs current 3% (Oct 3, corrected accounting, 20 seeds, medians, same miner buy-in in both):**

| Design | Miner extra d7 / d30 / d90 | Chest rate d7 / d30 | Holder pot (90d) | H3 yield d7 / d30 | Renters' chest share | Price d90 | Burned |
|---|---|---|---|---|---|---|---|
| Current: 3% fixed (2.5 chest / 0.5 dev) | 279% / 55% / 38% | 2.5% / 2.5% | $0 | – | 7.4% | 0.12× | 0% |
| 5% dual, boost thresholds 0.5×–2× | 399% / 94% / 43% | 2.5% / 3.8% | $57K | 0.53% / 0.09% a day | 8.5% | 0.16× | 1.3% |

- **Thresholds matter most.** With boost thresholds of 3×–10×, the miner boost drops below 3× after the hype week, the chest keeps the full 4.5%, and holders get almost nothing after week 1. Thresholds around 0.5×–2× give holders a real share early and hand most of the tax back to miners as hype fades.
- **If 5% cuts volume by 30%,** miner income falls about 20% (lowboost: d30 extra 124% vs 152% with bigger buy-ins).
- **Price is the weakest result.** Trader flow in the sim doesn't react to the tax rate or to holder rewards, so it can't show a 5% tax scaring flippers or holder rewards attracting buyers. Bigger assumed buy-ins (up to $2,500 for H3) lifted price to ~0.3×, so buy-in behavior drives the price outcome more than the split does.
- **Renters aren't reduced** by M2 at 2 days mined (they stay ≥ 3 days and hold $50). A longer M2 window would cut them, at the cost of slower leveling.

**Target mode (user decision Oct 3): no burn; the split self-adjusts so miners' total pay = 5× what their GPUs mine** (mining + a chest cut worth 4× mining, averaged over all miners). Whatever the chest doesn't need goes to holders. The chest can take at most 4.5%, so the target is only reachable when daily volume per GPU (V/N) is high enough: (5 − 1) × a ÷ 4.5% − a ≈ **$220 of volume per GPU per day** (a = $2.50 average GPU). Above that, miners get exactly 5× and holders get the rest; below it, miners get all 4.5% (still under 5×) and holders get nothing.
- At the website estimate ($750 per GPU): miners need 1.33% of volume, holders get 3.17%.
- In the sim, V/N stays above ~$220 only for the first ~4 days, then falls to ~$40–100 as hype fades. Holder pot over 90 days: $26K at a 5× target, $50K at 3×, $16K at 8×. Miner extra d30 ~111–114% in all three (vs 55% for the current 3% design); price 0.16–0.18× vs 0.12×.
- Consistency note: the website's $750/GPU matches the first week; the sim's day-30 ratio is ~10× lower.

**Holder minimum (user decision Oct 3): holders always get at least 1% of volume**, so the chest is capped at 3.5%. Split per trade: 0.5% dev, 1% to 4.5% to holders, 0% to 3.5% to miners (whatever reaches the 5× target, up to 3.5%). The 5× target now needs ≈ $283 of volume per GPU per day (4 × $2.50 ÷ 3.5% − $2.50).

| Design (20 seeds, medians) | Miner extra d7 / d30 / d90 | M1 / M2 / M3 extra d30 | Holder pot (90d) | H1 / H2 / H3 yield d7 | H1 / H2 / H3 yield d30 | Renters | Price d90 |
|---|---|---|---|---|---|---|---|
| Current 3% fixed | 279% / 55% / 38% | – | $0 | – | – | 7.4% | 0.12× |
| 5×, no holder minimum | 615% / 111% / 46% | 66% / 117% / 229% | $26K | ~0 | ~0 | 8.7% | 0.16× |
| **5×, holders ≥ 1% (decided)** | 490% / 90% / 44% | 54% / 98% / 206% | **$66K** | 0.11% / 0.22% / 0.43% a day | 0.04% / 0.08% / 0.16% a day | 7.7% | 0.16× |
| Same, if 5% cuts volume 30% | 368% / 74% / 43% | 44% / 79% / 164% | $50K | 0.07% / 0.14% / 0.29% | 0.03% / 0.06% / 0.12% | 7.0% | 0.17× |

Miner "extra" includes holder rewards that home miners earn on their own bags. Yields are % of the bag paid per day.

**Calculator presets (4070, L2, old 3% chest rate; outdated):**

| Stage | Per day |
|---|---|
| Launch day | ~$347 (116×) |
| Hype week | ~$36 (12×) |
| Peak | ~$38 |
| Cooling off | ~$7 |
| Steady state | ~$5.6 |
| Flop | ~$12 |
| Breakout | ~$30 |

L3 is locked for the first 14 days. A 3060 laptop does not pay for itself in 2 weeks: about $650–700 over 90 days on a good path, valued at payout prices.

**Creator earnings (0.5% fee + 1% held, 90-day lock, $300/month costs, 6 months):**

| Scenario | Creator earns |
|---|---|
| Dies in hours | ~$4.5K |
| $10M runner, few days | ~$158K |
| Stable $500K–1M | ~$70K |
| Run then plateau | ~$140K |
| Flop | ~−$0.3K |

- The fee beats the 1% holding in every scenario.
- The stable path's income depends on daily volume. At 6% of market cap, it's about $6K/month.

## 9. Running costs
- **Monthly (about $100–250 at launch):**

  | Item | Cost |
  |---|---|
  | Web hosting | $0–20 |
  | Backend VPS | $5–40 |
  | Postgres | $0–25 |
  | Solana RPC (Helius, QuickNode, Triton) | $50–150 |
  | Monitoring | $0–20 |
  | Transaction fees (500 miners paid every 10 min ≈ 3,600 tx/day; hourly cuts this 6×) | ~0.02–0.4 SOL/day |

- **One-time:**

  | Item | Cost |
  |---|---|
  | .com domain | $10–20/yr |
  | Code-signing certificate | $200–400/yr |
  | Token accounts for new miners | ~0.002 SOL each (~2 SOL per 1,000) |
  | Float (capital, recovered) | ~$1K |
  | Lawyer | $500–3,000 |
  | Launchpad fee, dev buy, liquidity | Depends on the launchpad |

- **Inside the system:**
  - Pool fee 0.5–2%, slippage, and settlement overpayment come out of payouts and the float.
  - Our own transfer-fee payments recirculate.

## 10. Build status
| Piece | Status |
|---|---|
| Payout engine (`packages/engine`): tax split (5× target, 3.5% cap, 1% holder minimum), holder levels with hold clock, miner levels, chest and holder-pot weights with caps, epoch, hybrid payout, settlement, token split | Done, 21 tests (updated Oct 3 for the two ladders) |
| Coin switcher (`packages/switcher`): per-card scoring (benchmarks or hashrate.no catalog, slippage and confirmation-delay penalties), hysteresis, Ed25519-signed assignments, wallet validation | Done, 11 tests |
| Assignment API (`services/api`): `POST /v1/assignments`, signed miner list `GET /v1/miners`, `/v1/keys`, `/v1/health` | Done, 4 tests. Placeholder pools and miners in `config/` |
| Desktop app (`apps/desktop`): Rust core (GPU detection, signature checks, hash-verified downloads, safe unzip, flag-injection guard, crash-restart supervisor) + Tauri 2 shell (wallet entry, Start/Stop, tray, background check-ins) | Core: 13 tests. App compiles. End-to-end test passes (API + app + stand-in miner). Not yet run on Windows |
| CI (`.github/workflows/ci.yml`) and Windows installer build (`desktop-release.yml`, blocks until the production key is set) | Added, not yet run on GitHub |
| Architecture doc, simulation, calculator, creator page | Done |
| Devnet test run: Token-2022 3% token, fee collection, mock pool feed, batch payouts | Next |
| Website (`apps/web`) | Updated Oct 3 for the 5% two-ladder design (mining/holding estimate, both level tables, new math, tokenomics, FAQ). Static front end built Oct 3 from the questionnaire answers: home, calculator, FAQ/docs pages. Backend features (waitlist, download, live stats, payout feed, wallet addresses) are labeled placeholders. Launch settings in `apps/web/assets/js/config.js` |
| Real miners and pools (licenses, dev fees, per-worker APIs) for PRL / QUAN / QTC | Research needed |
| Desktop: code signing, temperature/power limits, pause while gaming, auto-update, benchmarks, AV false-positive submissions | To do (`apps/desktop/README.md`) |
| Engine: exclude dev/treasury wallets from the chest | Done (`excluded` in `runEpoch` and `runHolderPayout`) |
| Simulation: correct token accounting, two ladders, 5× target (`dual_target5x_hmin1`) | Done |
| Calculators in `calculator/` (old 5%/3% fixed-split models) | Outdated; the website calculator uses the new design |

## Install and antivirus plan (decided)
- **One signed Windows installer** (Tauri, ~10 MB). The user pastes a public Solana address and clicks Start. The app detects GPUs, the server picks a coin per card, and the app downloads a hash-verified miner and runs it. Tray icon, Start/Stop, Quit.
- **Per-card coin choice on the server** (e.g. PRL for NVIDIA, QTC for AMD and Intel), signed so a hijacked connection can't redirect mining.
- **Antivirus:** be clearly legitimate, never evade.
  - Code-sign everything.
  - Mine only after the user clicks Start; auto-start is opt-in.
  - Visible tray icon, clean uninstall.
  - No packing or obfuscation, never touch Defender.
  - Submit each release to Microsoft and VirusTotal vendors.
  - Open source with published checksums.
  - Some antivirus will still label any miner as "potentially unwanted": the FAQ explains, and users only ever allow the Hashcoin folder.

## 11. Open decisions
- Exact hold clocks (24h / 72h) and holder payout cadence (hourly vs daily).
- Whether the website estimate should show launch-week conditions ($750 volume per GPU) or later ones (the sim sees ~$40–100 per GPU by day 30).
- Launchpad: our own Token-2022 token and pool (likely, since LaunchLab appears limited to 1%/3%) vs LaunchLab if it allows 5%.
- Renter capture (~8% of the chest in the sim): a longer M2 window would cut it, at the cost of slower leveling.
- Payout cadence (10 min vs hourly) vs transaction cost.
- Coins to support for switching, and which pools have per-worker APIs.
- Legal review (payouts funded by other people's fees, custody, marketing language).

## 12. Name: Hashcoin ($HASH), decided Oct 3
It follows the classic coin pattern (Bitcoin, Litecoin, Dogecoin, Hashcoin), and "hash" is literally what payouts are measured by (hashrate). Before launch, check the .com and the $HASH ticker for clashes on Solana (HASH is also Provenance Blockchain's ticker on other chains).
**Logo (decided Oct 3):** option C, an italic two-bar hash on a coin. Coin #EBB447, hash white. Final files in `apps/web/brand/logo/` (SVG master, PNGs 16–1024, favicon, wordmark lockups). Brand accent color = #EBB447.

## 13. Website direction (Oct 3)
- **Positioning (user, Oct 3): not a memecoin.** Present $HASH as a token with real tech: any PC with a GPU mines, every payout is a market buy of $HASH, holders are rewarded, and a 5% tax pays it all back out. **Audience: traders who already own a PC with a GPU**: gaming PCs, gaming laptops, AI rigs, editing and render workstations (user, Oct 3: "it's not just gaming PCs"). A few clicks to start. Don't market to existing GPU miners: they'd flood the chest without caring about the coin.
- **Hero (Oct 3, revised):** title "Your GPU buys $HASH for you." with four short bullets (Press Start / every payout is a buy / every trade pays you / your PC works like normal, it only uses spare GPU power) and device chips (gaming PCs, laptops, AI rigs, editing & render). No ticker strip. Right side: the looping five-station ring (Press Start → your GPU mines → it buys $HASH → paid to your wallet → every trade pays 5%) around a large coin, one step at a time, with the chain link to the next station drawing itself in gold. Four spokes to the coin stay visible the whole time with labels ("Buy inflow", "5% tax" in; "Pays miners", "Pays holders" out); the ones that matter for the current step glow. Transitions are smoothed: finished stations keep their last frame, links and captions fade, a station's picture fades out before it rewinds. The hero fills one screen on desktop (sized to the window height).
- **Positioning:** a platform with a real function, not a joke memecoin. Look like a real product company. References: usepaid.app, usehotbot.com, boneronlong.xyz (plus octoprotocol.io).
- **No rainbow or gradient buttons, no crowded layouts.**
- **Brand:** logo option C (italic two-bar hash on a coin), gold **#EBB447**, white hash. Wordmark in Manrope ExtraBold.
- **Fonts (Oct 3):** Manrope for headlines, labels and numbers (tabular figures), Inter for body. No monospace uppercase labels (user: "every Claude-generated website has it"); IBM Plex Mono only inside math formulas.
- **3D models dropped** for now (user decision). Use 2D/SVG animation for the mining cycle instead.
- **First build (Oct 3) from the questionnaire answers:** dark premium (#0B0C0D, gold accent), Manrope ExtraBold, 8px corners, waitlist button (coming soon), launch countdown (date TBA), header with X, Discord and contract address button. Pages: Home, Calculator, FAQ. Front end only: no backend, no sign-ups, no wallet connection.
- **Redesign for traders (Oct 3, after user feedback "looks like AI slop, a trader has no idea what this means, earnings too low"):** the home page now leads with plain trader language ("Every trade pays the miners", "3% tax", "your cut") and an earnings panel in the hero. The abstract loop animation is gone; a labeled simulation shows trades → tax → chest → payouts to miners instead. Fewer sections, terminal-style data panels, a ticker strip under the header.
- **Earnings estimate (decided Oct 3, updated for the 5% design):** one pre-launch estimate based on daily volume per GPU mining (V/N), default **$750** (30% volume/mcap × $1,000 mcap per holder ÷ 40% of holders mining; market cap cancels). Per GPU: pot = 4.5% × (V/N + a); miner chest = min(4 × a, 3.5% × (V/N + a)); holders get the rest. With a = $2.50, miner mix 30/50/20% (M1/M2/M3, average 2.1×) and 60% of mcap held by earning wallets (30/35/20% by value at H1/H2/H3): miners are at the 5× target ($10/GPU from the chest = 1.3% of volume) and holders get 3.2% of volume. **RTX 4070: $8.14 / $13.32 / $23.69 per day at M1 / M2 / M3. Holders: 0.88% / 1.77% / 3.54% of the bag per day at H1 / H2 / H3** ($50 → $0.44, $500 → $8.84, $2,500 → $88 a day). These are launch-week conditions; at $100/GPU the chest is capped (miners ~2.4×, holders at their 1%). The site labels them "Pre-launch estimate, not a promise" and shows the math (`#math`).
- **Home layout (Oct 3, user: "too many sections, too much text"):** hero, then one tab bar with a topic shown at a time: What you'd make, How it works (tax-pot simulation, the math behind a "Show the math" toggle), Levels, Your PC, Tokenomics, Launch (waitlist, countdown, status), FAQ. Header links and `#hash` links open the matching tab. Copy cut to a line or two per block.
- **Earnings tab (Oct 3):** levels are explained first as three cards (Level 1/2/3 = 1×/2×/4× share, with the M and H requirement on each), plus a one-line key ("M = how often you mine, H = how much you hold and how long"). Until the visitor picks a level, the cards play through Level 1 → 2 → 3 on their own so nobody only sees the lowest payout. Mining card: GPU dropdown with names only (no "$/day" next to the name, which read as a conflict with the total), then the total as "your GPU mines $X + your share of the tax $Y". Holding card: bag with quick picks ($50 / $500 / $2.5K / $10K), default $2,500.
- **Round 3 fixes (user, Oct 3):**
  - **Hero fills big monitors.** The ring's cards are laid out at a base size and scaled (up to 2×) to fit the window's width and height; the hero and header widen to 2240px and the title and bullets grow with the screen. Checked at 1280×720, 1440×900, 1920×1080 and 2560×1440.
  - **Topic switcher is big:** seven tiles with icons under "Tap a topic to learn more".
  - **Wording: the tax is extra earnings.** Station 5 is "Trades pay you extra"; its picture ends with "+ Miner bonus" and "+ Holder rewards". The ring's out-spokes are labeled "Miner bonus" and "Holder rewards". Hero bullet: "Trades pay you extra. 5% of every trade goes to miners and holders."
  - **Mined $HASH earns holder rewards at the same time.** Station 4's wallet shows "+203 from mining" then "+14 holder reward" (the "Holder rewards" spoke lights up). Hero bullet: "Your earnings buy $HASH, and that $HASH earns holder rewards too." The earnings tab adds "Mine and hold: $X a day" (mining total + holder rewards on the bag).
  - **Dynamic split explained** in How it works ("The split balances itself"): a trading-volume slider (sweeps quiet ↔ busy on its own until dragged) moves the 4.5% bar between miners and holders and shows the average miner's multiple and the holders' share of volume. Tokenomics adds "Split: adjusts itself".
- **Round 4 (user: "way too much to look at"):** earnings tab is level cards (Level N, 1×/2×/4×, "Mine: 2 days a week", "Hold: $500+ for a day"; no M/H codes) over three totals side by side: Mining (GPU, $/day, mined + bonus), Holding (bag, $/day, % a day), Both ($/day; mined $HASH counts as your bag). How it works: three numbers (5% tax / up to 3.5% miner bonus / 1%+ holder rewards), then the split slider with one status line; the tax-pot simulation and the math sit behind toggles.
- **Two flywheels in the hero (user, Oct 3):** the single loop is split into two rings with big tabs ("1 The coin flywheel", "2 Your bag flywheel"). Until someone picks a tab they take turns: the coin wheel plays three times, then the bag wheel once per level (three loops), then back.
  - **The coin flywheel:** miners buy in (GPU → market buys landing on a rising price line) → holders hold (holding longer unlocks bigger rewards) → trades fill the reward pot (5% of every trade) → both get paid every 10 minutes (miners topped up to 5×, holders share the rest) → more people join → around. Every step has its own bubble on its spoke: Buy inflow, Holding, Tax inflow, Rewards out, Demand.
  - **Your bag flywheel (dollars, user Oct 3):** an RTX 5090 example (user, Oct 3) from the site's own estimate (model.js) with a sample bag at each level ($450 / $2,200 / $6,000): you mine ($10.71/day) → miner bonus (+$9.86 / $19.71 / $39.42 a day) → holder rewards on the whole bag, mined $HASH included → your bag grows (a week of mining + rewards counts up, crossing the next level's threshold) → level up → around at the next level. Bubbles: Mined $HASH, Bonus, Rewards, Bag grows, Level up. **The whole wheel takes the level's color** (mint → violet → gold), including the tab and step buttons. A note under it says "Example: RTX 5090 and a sample bag at each level, at launch-week trading. An estimate, not a promise."
  - After the Level 3 loop it always returns to the coin wheel, and the two take turns again. Bubbles keep a clear gap from cards and coin (the ring prefers wider spacing and only tightens on short screens).
  - Switching between wheels crossfades (the old one fades and shrinks slightly, the new one fades in). On phones each step's bubble sits on its card.
  - Price charts are allowed (user, Oct 3: there was never a rule against them; an earlier session had added one to the design brief by mistake). Station 1 of the coin wheel shows a price line climbing as the buys land.
- **Big screens (user, Oct 4):** the hero text column is bigger (headline, bullets, chips and buttons scale with the screen). The flywheel caption sits in a framed bar centered under the wheel, always the same height so the wheel never jumps. The topic explorer matches the hero's width and scales up as a whole (home.js `fitExplore`, CSS `zoom`), fills at least one screen, and short topics sit centered in the space under the tiles.
- **Level colors (Oct 3):** Level 1 mint #5ED3A5, Level 2 violet #8FA3FF, Level 3 gold #EBB447. Selecting a level recolors the earnings panel; level badges and the calculator's M/H buttons use the same colors.
- **Your PC claim (user, Oct 3):** mining doesn't take away any of the PC's functionality: it only uses unoccupied GPU power, and with heavy programs open only the hashrate drops. This is the user's own experience mining PRL on their PC (no difference even in heavy games); **it's how the miner behaves, not a feature we build.** The site says so ("Your PC works like normal. It only uses spare GPU power.") with an illustrated GPU meter (idle / browsing / gaming / rendering). Re-check if the app switches a card to another coin or miner.
- **Laptop GPUs (Oct 3):** the GPU list has 133 cards including 45 laptop GPUs. hashrate.no measures only three laptops (RTX 3060/3070/3070 Ti Laptop); the other 42 are estimated from the desktop card with the same or nearest chip, scaled for laptop power limits (`apps/web/scripts/gen_gpus.py`), and labeled "est." on the site.
- **Before the site goes live:** set `launchAt`, `ca` and the social links in `apps/web/assets/js/config.js`, connect the waitlist and the live data, keep "temperature/power limits" marked as planned until the app ships them, and re-check the "only uses spare GPU power" claim on any coin other than PRL.
- **Not started yet (deliberately):** real miners and pools research, devnet token, backend, desktop app on Windows. See `docs/TECHNICAL-PLAN.md`.
