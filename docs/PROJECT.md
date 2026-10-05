# $HASH / Hashcoin: Project File (v3)

Last updated: October 4, 2026. Stage: design, simulation, and early build. Numbers are scenario assumptions, not forecasts. Not financial or legal advice.

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
- **Resuming in a new or local session: `docs/HANDOFF.md`.** Work so far happened in Claude Code cloud sessions. Branches: `claude/lucid-fermat-16svvo`, then `claude/vibrant-cray-fpbieb` (website build; all work pushed, not yet merged into `main`).

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
- **Adjustable tax, 2–5% (user, Oct 4, decided; formula = option #2, built into engine and site):** "if we can adjust the tax thats good because it means it can automatically adjust between 2-5% depending on current payouts and other measurable metrics." Facts that shape it:
  - Token-2022 applies a new fee only **two epochs after it's set (~4 days)**, so the tax follows trends over days, and every change is public before it lands.
  - Whoever holds the fee config authority can set any rate (Token-2022 allows up to 100%), and rug-check tools show "mutable transfer fee". To make 2–5% a guarantee: an on-chain program holds the authority and only allows 2–5% per the published formula (needs building and an audit). Cheaper first step: multisig + published formula + the built-in ~4-day delay.
  - On Meteora DBC this means `MigratedTransferFeeAuthorityOption::Partner` or `Creator` instead of `Immutable`: the fee stays fixed on the curve and the authority is handed to us at graduation (reading of the option names; verify).
  - **Formula (user chose option #2, Oct 4):** the rate is the lowest of 2–5% in 0.25% steps at which miners reach 5× **and** holders still get ≥1% of volume; otherwise 5%. Shares of the tax (user): dev 10% at a 2% tax down to 5% at 5% (linear), miners 45–75% (what reaches 5×, capped so holders keep ≥20%), holders the rest. Engine: `targetTaxRate` / `splitTax` in `packages/engine/src/tax.ts`; site: `apps/web/assets/js/model.js`.
  - Consequences: the effective floor is **2.25%** (at 2% holders can't get 1%). Reaching 5× takes about **$264/GPU/day**; below it the tax stays at 5%. At the $750/GPU default: tax **2.75%**, miners 48% / holders 43% / dev 8.75% of it, holders get 1.18% of volume, an H3 bag earns ~**1.32%/day** (was 3.54% on the flat-5% site). Any cut lowers holders' pay per dollar traded; the bet is that cheaper trading brings more volume.
  - **Site copy changed (Version 27):** "5% … Never raised" → "2–5%, set by a public formula; changes show on-chain ~4 days ahead". The engine's split (dev 0.5%, chest up to 3.5%, holders 1%+) also has to be restated for a 2% tax (e.g. as shares of the tax rather than fixed % of volume).
- **Fee authorities:** fee config and withdraw authorities in a multisig. (Superseded by the adjustable tax: the commitment is now the public 2–5% formula, ideally enforced by a program holding the config authority.) Set the max fee per transfer high.
- **Our own transfers are taxed too** (payouts to miners, etc.). Token-2022 has no per-wallet fee exemption. The fee is held in the recipient account and collected back into the treasury, so it recirculates. Send a little extra so miners receive the full amount. The treasury's market buy is also taxed, so mining value reaches miners ~5% smaller (that 5% goes to the pot); a miner who sells straight away loses another 5%, ~10% plus swap costs versus selling the mined coin directly.
- **Stats exclude our own transfers.** Volume and "tax collected" shown on the site count only outside trades, not treasury buys or payouts (their withheld fee still goes into the split).
- **Only mining is bought on the market.** The chest and holder pot are paid from the harvested tax, which is already $HASH (engine: `totals.buyUsd` = the immediate mining share).
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

## 3. Levels: two ladders (decided Oct 3, replaces the earlier L1–L3; clocks changed Oct 4)
**Holder levels** (anyone holding $HASH, mining or not):

| Level | Bag | Hold clock | Holder-pot weight |
|---|---|---|---|
| H1 | ≥ $50 | none | 1× |
| H2 | ≥ $500 | ≥ 24 hours | 2× |
| H3 | ≥ $2,500 | ≥ 7 days (was 72 hours) | 4× |

- **Holder pot share** = bag × holder multiplier. **No per-wallet cap** (user, Oct 4: "I never said there should be a cap"; an earlier session had added a 5% cap, removed from the engine and the site). Linear in the bag, not √, so splitting one bag across wallets gains nothing.
- **Hold clock:** starts when the bag first reaches the H1 size ($50) and keeps running through dips (changed Oct 4 from "when $HASH first lands", so a $1 dust buy can't pre-age a wallet for an instant H3 later; `clockStartTokens` in the engine). Pre-aging still works with $50 per wallet. Transfers out count as selling, including LP and CEX deposits, except between linked wallets (below).
- **Wallet linking (user, Oct 4: "lets do that"):** without it, moving 40%+ to a hardware wallet would reset the clock. The chain can't tell a self-transfer from a sale, so the user must prove both wallets are theirs: **wallet linking**. On the wallet page they connect each wallet and sign a free message (no transaction, no spending approval). Linked wallets become one group: one bag, one clock, one 5% cap. Transfers inside the group don't touch the clock (they still pay the 5% tax; Token-2022 can't exempt them). Linking a wallet merges clocks **weighted by bag** (an aged $2,500 wallet linked to a fresh $7,500 one ends at 25% of its clock), so linking a friend's or a fresh wallet can't hand out an aged clock. Unlinking counts as that wallet selling its share. Never let the clock travel with tokens to an unlinked wallet: that would make aged clocks something you could sell. Exchange and liquidity-pool deposits still count as selling. Engine: `linkWallet`, `unlinkWallet`, `isInternalTransfer` (`packages/engine/src/links.ts`). Still needs wallet connect on the site (Phase 4 wallet page) and a `links` table.
- **Clock speed and selling (user, Oct 4):** "buying more accelerates the hold clock and selling takes away time or resets it."
  - **Bigger bags age faster:** clock speed = bag ÷ $2,500, from 1× to 3× ($5,000 → 2×, $7,500+ → 3×). H3's 7 days takes 7 days at $2,500, 3.5 at $5,000, ~2.3 at $7,500+. Buying speeds the clock up from then on and never jumps it, so there's no buy-then-sell trick. The engine keeps the clock as accumulated time (`clockMs`, `clockAt`) and brings it up to date at every balance change and payout check (`advanceClock`).
  - **Selling costs 2.5× its share of the clock** (user: "5% takes 10% clock but selling 20% takes 50% clock or something similar"): sell 5% → lose 12.5%, 10% → 25%, 20% → 50%, 40%+ → reset. User's example: H3 for two weeks (a ~21-day clock), sell 30% → lose 75%, ~5 days left → back to H2 until the clock passes 7 days again, sooner if they buy back (bigger bag, faster clock).
  - Was (Oct 3): selling shrank the clock in proportion, buying never moved it, H3 at 72 hours.
- **Dips:** levels value the bag at the **higher of the ~1h and ~7-day average prices** (Oct 4, was ~1h only), so a crash takes about a week to drop anyone's level while a rise counts within the hour. This softens the crash spiral (price drops → H levels drop → M2/M3 drop too). Falling below a bag threshold drops the level; recovering restores it immediately, no new wait. Engine: `levelPriceUsd`.
- **Excluded from the holder pot:** dev, treasury, payout, liquidity-pool and exchange wallets.
- **Payout cadence:** hourly or daily (paying every holder every 10 minutes costs too much in transactions). Draft.

**Miner levels** (chest weight = √(GPU USD earnings) × miner multiplier, no per-wallet cap):

| Level | Hours mined (last 14 days) | Needs | Chest weight |
|---|---|---|---|
| M1 | any | – | 1× |
| M2 | ≥ 48 | H1 | 2× |
| M3 | ≥ 120 | H2 | 4× |

- **Hours mined (user, Oct 4; was 2 / 5 of the last 7 days):** clock time with at least one GPU getting accepted shares, not summed per GPU (so 10 GPUs don't reach M3 in 12 hours). The 14-day window lets an everyday PC that's off at night reach M3 (~8.6 h a day); stopping lets the hours age out over two weeks.
- **Slow mining counts for less (user, Oct 4):** an hour counts in full when the GPU earns at least 80% of the expected rate for its model on the assigned coin; below that it counts in proportion (60% → 45 min, 40% → 30 min). Stops a throttled card from collecting M2/M3 hours while barely mining. Gaming or rendering slows the miner, so those hours count for less too (the FAQ says so). Measured per hour (not per 10-minute epoch) so share luck evens out. Expected rate = the catalog rate for the reported model; the rig's own benchmark only for cards the catalog lacks, because a benchmark can be sandbagged. A card running far above its claimed model (>150%) is flagged as a likely false model. Engine: `hourCredit`, `creditedHours` (a wallet gets its best GPU's credit).

- Gating M2/M3 on holder levels keeps the reason for miners to buy and hold (user decision); the sim found buying-in to level up is what lifts price most.
- Miners who hold also earn from the holder pot on their own bag: doing both pays from both pots.
- **Mined $HASH counts** toward holder thresholds. **Position value** uses the level price above (higher of the 1h and 7-day averages), checked at each payout.
- **"5×" is an average across all miners**, and only when volume per GPU is high enough. With √ weighting a small GPU at M3 gets more than 5× and a big GPU at M1 less, so the site says miners "average up to 5×", never that each miner is topped up to 5× (copy fixed Oct 4).
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

**Miner and pool research for PRL (Oct 4, web research; the user has mined PRL with ForgeMiner on Kryptex):**
- **Pool: Kryptex is the first choice.** PPS+ at 2% (solo 1%), so every share is paid at a fixed rate with no luck, orphan or block-withholding risk to us, and our share-based payouts are exact (the 25% "pending" leg could shrink). It's large (about 27.65 EH/s, 17,280 miners, 80k workers), has 7 regions with SSL on port 7048, a 1 PRL minimum payout and optional auto-convert to BTC/USDT. Its public API (`pool.kryptex.com/openapi.yaml`, no key) lists workers per address with hashrate, shares and last share (`/{coin}/api/v3/miner/workers/{address}`). Login: `address/worker` or `username/worker`. **To check:** worker-name length limits, terms on one address carrying thousands of other people's workers, API rate limits. Alternatives: f2pool (launched PRL), pearlpool.io, PearlPow (per-wallet API with workers), k1pool, LuckyPool (tied to IpMiner).
- **Worker names:** don't put the 44-character Solana address in the worker name. The app's signed check-in already sends the wallet, so the server can hand out a short worker id and keep the mapping. This avoids length limits, keeps wallets out of the pool's public pages, and fixes the pool-login issue in `assign.ts`.
- **Miners (all closed source, NVIDIA-first):** ForgeMiner 1.8.4 (2% on PRL, NVIDIA only, local JSON API on 127.0.0.1:7777, `--gpu` selection, any pool); SRBMiner-Multi 3.7.1 (sources say 2% or 3%, NVIDIA plus some AMD, mature); WildRig-Multi 0.51.3 (NVIDIA and AMD; 0% only on the pearlhash.xyz pool); HydraX (claims fastest at 1%, but the comparison is its own); BzMiner, PeakMiner (2%), AlphaMiner (1%). Fee claims disagree between sources, so **benchmark the top three on the user's RTX 4070 SUPER** (effective hashrate = hashrate × (1 − fee), plus watts) rather than trust them. Licenses: the app downloads only each miner's official release (never rehosted, pinned SHA-256); the user decided (Oct 4) there's no need to ask the developers.
- **AMD on PRL is weak or unsupported** (hashrate.no: RX 9070 XT 92 TH/s vs RTX 4070 Super 132 TH/s; some guides say NVIDIA only). AMD and Intel cards should default to QTC.
- **Decision (Oct 4): ForgeMiner 1.8.4 for NVIDIA, on Kryptex.** The user asked for one miner for all GPUs with easy switching and download. SRBMiner-Multi was the only one covering every coin on NVIDIA and AMD (PRL 2%, QTC 1.5%, QUAN 2%, EPIC 0.85%), but Windows Defender quarantined its official release (checksum verified) as **Trojan:Win32/Ravartar!rfn, severity severe**, within seconds, and did the same to an earlier copy on Sep 27. Every user would see that. ForgeMiner (the user's own miner) wasn't flagged, matches its published SHA-256, and covers PRL (2%), Quantus/QUAN (2%) and QubitCoin/QTC (1%) on NVIDIA from the GTX 10-series up, with temperature protection built in (`--temp-limit 80 --temp-resume 70`). The app does the coin switching and the verified download itself, so one binary for all NVIDIA coins is enough. Config: `services/api/config/miners.json`, `coins.json` (SSL pools from ForgeMiner's own Kryptex/LuckyPool samples). **Gaps:** no AMD/Intel miner yet (AMD cards get no assignment for now; try WildRig or BzMiner against Defender next); EPIC disabled; ForgeMiner's flags in our template are **confirmed by a live run** (Oct 4, user's RTX 4070 SUPER, Kryptex US SSL): 122.9 TH/s at 196 W (hashrate.no lists 132), falling to 115 TH/s at 79 C after 3 minutes; the share was accepted and Kryptex's public worker API showed the worker with `valid: 1`. Temperature limit set to 83/75 C (80 would cycle on a normal gaming card). **Shares are slow:** ~0.29/min on a 4070 SUPER at Kryptex's difficulty (~17/hour), so one hour of shares estimates hashrate only to about ±25%; judge the 80%-of-expected rule on a 3-hour average (Kryptex's `avg_hashrate_3h`), not a single hour; the pool login is still the Solana wallet (needs the platform PRL address + short worker id).
- **Built Oct 4 (user: "do all steps"):**
  - **Pool login:** `<platform payout address>.<worker id>-<gpu>`, worker id = "h" + 10 base32 chars of SHA-256("wallet:rigId") (`workerId` in the switcher, `worker_id` in the app, same test vectors). The app refuses any login that isn't its own worker id. The API records worker → wallet for the collector. PRL's payout address is the user's own PRL address for testing (replace with the platform's before launch); coins without a payout address aren't offered.
  - **Collector** (`services/collector`): reads Kryptex's per-worker stats under the payout address, maps workers to wallets, credits M-level hours and values mining at PPS+ rates. Kryptex's 30-minute and 3-hour averages count time before a session as zero (a worker 8 minutes in showed 30 TH/s while doing 115), so the collector scales by session length. Ran live: found the manual `hashcoin-test` worker and listed it as unregistered. PRL price on Kryptex Oct 4: ~$1.03. Kryptex carries about half of Pearl's network hashrate (27.7 of 54.2 EH/s), a concentration risk.
  - **AMD/Intel miner:** WildRig 0.51.3 was quarantined too (Trojan:Script/CoinMiner!rfn). **BzMiner v100.45 passed** (download and unpack, checksum matches GitHub's) and mines **Quantus on NVIDIA, AMD and Intel Arc**; its readme lists Pearl on NVIDIA and Intel only, and no QubitCoin. Configured for Quantus on AMD/Intel. Unknowns until a live run on an AMD PC: its dev fee (printed at startup), device numbering for `--devices`, and `--set http_port`. Quantus also needs a platform payout address (a 49-character `q...` address) before anything is assigned.
- **First real run from the app (Oct 4, user's PC):** the app downloaded and verified ForgeMiner and mined PRL on Kryptex at ~124 TH/s, 218 W, 76–79 °C, under `<PRL address>.h2ju2rm5lut-0`; the collector mapped that worker to the user's Solana wallet and credited mining hours. Bugs found and fixed on the way: an NVIDIA card and the Ryzen's built-in graphics were both "GPU 0", so the AMD's "no coin" answer stopped the NVIDIA miner (GPUs now have unique slot ids; built-in graphics are skipped); the dev key lost its trailing `=` when pasted (now accepted either way); miner output was discarded (now `gpu-<n>.log` with exit codes). Also: the first launch used the placeholder server despite a correct settings file (cause not found; `HASHCOIN_API` sidesteps it).
- **Young sessions can't be judged from pool data:** a session 6 minutes in had 2 shares and Kryptex estimated 51 TH/s for a card doing 125. The collector now gives each session full credit for its first hour and judges only after that. The PRL estimate for young sessions is still low (0.0009 vs ~0.003 PRL for 2 minutes): true it up to Kryptex's actual balance before paying anyone from it.
- **First devnet round (Oct 4):** `packages/chain/scripts/devnet-run.ts` created $HASH on devnet (Token-2022, 5% fee, mint authority revoked, no freeze authority), gave four test holders bags, ran test trades, harvested **771,176 $HASH of tax** (includes the bags' own 5%), split it with the engine using the collector's real Kryptex data for the user's GPU, and paid out: **21.51 $HASH to the user's wallet** (M1: $0.017 mining now + $0.0045 bonus), $34.70 to each test holder (H1), $77.12 to dev (0.5%). Everything is on Solscan (devnet); the round's report is in `packages/chain/data/round-1.json`.
  - The round also showed the old 5% per-wallet caps holding back most of a small pot (95% of the miner bonus with one miner). The user never asked for a cap, so it's removed (Oct 4).
  - **Solana's public RPC can't run the backend:** it refuses to list Token-2022 accounts and rate-limits (HTTP 429). Fine for tests (the harvester takes the token accounts it already knows, as the transfer indexer will on mainnet), but production needs a dedicated RPC (Helius etc., free tiers exist). The devnet faucet allows little per day; 0.025 SOL covered a full round.
- **Ticker clash:** "QTC" is both Quantus (Kryptex's label) and QubitCoin. Here QUAN = Quantus (`quantus`), QTC = QubitCoin (`qhash`), matching hashrate.no.
- **PRL risk:** Pearl hard-forks often (MoE certificates June 12, salted noise seed at block 99,000 on Aug 11, which invalidated old miners) and published an FP8 spec in September. SRBMiner 3.6.8's notes warn that "Soon, Pearl will be getting an upgrade that will make consumer-grade GPUs pretty much useless" (unverified). The app must update miners fast (the signed miner list supports it), and the switcher's other coins are the hedge. Re-check before launch.

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
- **Launch day is expected to be the big day (user, Oct 4):** "I expect launch day to be really high if not the only day with lots of volume because we will be hyping it up the previous week on X." So launch-day payouts matter most. On launch day nobody has a hold clock or mining hours yet, so everyone is H1/M1, which just means equal weight: holders split by bag, miners by √(mining), and nobody gets less (user, Oct 4: "everyone being level 1 just means its all equal weight"). Levels start separating people from day 2.
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
| Same + Oct 4 levels (H3 7 days, clock speed 1–3×, selling 2.5×; `levels_oct4`) | 490% / 90% / 44% | 54% / 98% / 206% | $66K | same | same | 7.7% | 0.14× |
| Same, if 5% cuts volume 30% | 368% / 74% / 43% | 44% / 79% / 164% | $50K | 0.07% / 0.14% / 0.29% | 0.03% / 0.06% / 0.12% | 7.0% | 0.17× |

Miner "extra" includes holder rewards that home miners earn on their own bags. Yields are % of the bag paid per day.

The Oct 4 level changes barely move the sim, and it can't judge them: its miners mine 24/7 (so 48h / 120h mined land on day 2 / day 5 as before), and non-mining holders are one aggregate that doesn't buy or sell in response to clocks. Whether "a bigger bag ages faster" draws in buyers is a judgment call the sim can't test.

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
| Payout engine (`packages/engine`): tax split (5× target, 3.5% cap, 1% holder minimum), holder levels with hold clock, miner levels, chest and holder-pot weights with caps, epoch, hybrid payout, settlement, token split | Done, 33 tests (Oct 4: wallet linking, slow mining counts for less, clock starts at the H1 bag, level price, `buyUsd`, clock speed, 2.5× sell penalty, H3 7 days, hours mined over 14 days) |
| Coin switcher (`packages/switcher`): per-card scoring (benchmarks or hashrate.no catalog, slippage and confirmation-delay penalties), hysteresis, Ed25519-signed assignments, wallet validation | Done, 11 tests |
| Assignment API (`services/api`): `POST /v1/assignments`, signed miner list `GET /v1/miners`, `/v1/keys`, `/v1/health` | Done, 4 tests. Placeholder pools and miners in `config/` |
| Desktop app (`apps/desktop`): Rust core (GPU detection, signature checks, hash-verified downloads, safe unzip, flag-injection guard, crash-restart supervisor) + Tauri 2 shell (wallet entry, Start/Stop, tray, background check-ins) | Core: 12 tests. App compiles and launches on Windows (Oct 4, user's RTX 4070 SUPER PC). End-to-end test (API + app + stand-in miner, `examples/stand_in_miner.rs`) passes on Windows, Linux and Mac. No real miner or pool yet |
| CI (`.github/workflows/ci.yml`) and Windows installer build (`desktop-release.yml`, blocks until the production key is set) | Added, not yet run on GitHub |
| Architecture doc, simulation, calculator, creator page | Done |
| Devnet test run: Token-2022 5% token, fee collection, batch payouts (`packages/chain`) | **First round done Oct 4** (see below): token `9dqUCFnTrTdsA3XNANTrdSSCnDTmx2NAfkFbGzMbXwvR` on devnet; real mining data from the collector; payouts landed. No pool/market yet (devnet assumes $0.001) |
| Website (`apps/web`) | Static front end (home, calculator, FAQ/docs), reworked through Oct 4 from user feedback; current state in §13 "Current website (Oct 4)". Preview Version 27. Backend features (waitlist, download, live stats, payout feed, wallet addresses) are labeled placeholders. Launch settings in `apps/web/assets/js/config.js`. Browser check: `apps/web/scripts/check_site.mjs` |
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
- Legal review (payouts funded by other people's fees, custody, marketing language). The holder pot (passive rewards from other people's trading, run by us) is the part most likely to look like a security.
- **Pre-launch mining (idea, Oct 4, not decided):** let GPUs mine through the hype week before launch; everything they mined is paid in $HASH at launch, which puts a week of mining revenue into market buys on launch day (on top of the hype volume). Needs: the float or a launch-day buy of the accumulated mining, and clear wording that nothing is promised before launch.
- **Launch token setup: recommendation (Claude, Oct 4; the user is unsure, nothing decided):**
  - **Supply (decided, user Oct 4): 21,000,000 $HASH**, 6 decimals, all minted once; then the mint authority is revoked (no more can ever be made) and there is no freeze authority.
  - **Allocation:** 98% into the liquidity pool, 1% dev (bought openly, locked/vested as decided in §2), 1% treasury float in the multisig (fronts the "paid now" share of mining before the mined coin sells; shown publicly). No team, marketing or presale allocation: payouts come from the tax and from mining, so none is needed.
  - **Budget (user, Oct 4): "I don't have 5 thousand dollars, I am broke."** So no self-funded pool: launch on a **bonding curve** instead, like pump.fun, where buyers fund the curve and it graduates into a real pool on its own. Leading candidate: **Meteora Dynamic Bonding Curve (DBC)**. **Checked against Meteora's code (Oct 4)**, version 0.2.2 (`release_0.2.2` branch, PR #212 merged Sep 23; CHANGELOG: "Added support for creating base mints with a transfer fee"):
    - **The tax reaches us:** `create_config2` takes `TransferFeeParameters`; the withdraw-withheld authority is set to the **partner or the creator** (`TransferFeeWithheldAuthority`), a wallet we choose (the treasury or its multisig). Meteora doesn't hold it. Harvesting withheld fees into the mint is permissionless, so the curve's own vault fees can be collected too.
    - **5% is allowed:** `MAX_BASE_TRANSFER_FEE_BPS = 1000` (10%); the per-transfer max fee is `u64::MAX` (no cap).
    - **The fee can be locked for good:** `MigratedTransferFeeAuthorityOption::Immutable` (the default) creates the mint with no fee config authority, so 5% can never be changed, which matches "never raised". Other options: drop to zero at migration, or hand the authority to creator/partner.
    - **It survives graduation:** migration to DAMM v2 deposits fee-excluded amounts (a little less starting liquidity; the base kept out goes to the protocol).
    - **Conditions with a base fee:** fixed supply (21M fits), no locked vesting on the curve (the 1% dev bag must be a public buy plus our own lock, not DBC vesting), `MigrationFeeOption::Customizable`, `MigratedCollectFeeMode::Compounding`. No token badge is needed for a fee on our token (badges are for the quote mint).
    - **Re-checked Oct 5:** the **devnet** program already has `CreateConfig2` (the 0.2.2 instruction set; read from the deployed binary), **mainnet doesn't** (only `CreateConfig`). GitHub: main is still 0.2.1; release_0.2.2 is getting audit fixes (Offside; PRs #215, #221, #229 open); SDK sync PR #116 still open. So we can rehearse a DBC launch with our tax on devnet now (building `create_config2` from the IDL, no SDK), and mainnet waits for Meteora's release.
    - **Not live yet (Oct 4):** 0.2.2 sits on a release branch with audit fixes still open (PRs #215, #229), the SDK hasn't shipped `createConfig2` (SDK sync PR #116 open), and main has no base-fee code. Re-check that 0.2.2 is deployed on mainnet (and devnet, to rehearse) before launch. An earlier search summary claiming "SDK 2.0.0 (Oct 2) added createConfig2" was wrong. Fallback: Raydium LaunchLab (1%/3% fee options, unverified). With a curve, the cost to launch is small (rent, transaction fees and the 1% dev buy at the curve's starting price), the LP question goes away (the launchpad locks the graduated pool), and the 1% treasury float can be in $HASH rather than cash.
  - **Starting liquidity (only if self-funding later):** the SOL put in sets the starting market cap (with ~98% of supply in the pool, starting mcap ≈ the SOL side's value). It depends on budget: $5–10K starts small with room to run; $25K+ is steadier against early sells. **Open: the user's budget.**
  - **LP:** burn the LP tokens at launch (strongest trust signal; rug-check tools show it). Locking instead keeps the option to withdraw later, which traders read as a risk.
  - **Fee authorities:** the 5% fee is fixed; renounce the fee config authority once launch is stable (the fee can then never change). The withdraw authority must stay (it collects the tax) and goes in a multisig.
  - **Snipers:** no bonding curve, so: create the pool, the dev buy and the trading start in one bundle; publish the contract address only on the site at launch time; the 5% tax already costs a sniper 10% per round trip. The launch-day head start for miners (§7) stays.
- **Launch token setup** (none decided yet): total supply and where the other 99% goes; the pool's starting liquidity and whether the LP is locked or burned; revoke the mint and freeze authorities; no other Token-2022 extensions (no permanent delegate, no transfer hook); a plan against snipers, since launching our own pool has no bonding curve.
- Website estimate: the 5% tax filters out bot and arbitrage volume, which is much of Solana memecoin volume, so $750 per GPU is optimistic even for launch week. Consider a lower default or a clearly labeled range.

**Technical review (Oct 4, local session) and the user's answers:**
- **Splitting mining across wallets (√ weighting):** one hashrate split over K wallets gets √K times the chest weight, and M1 needs no bag, so extra wallets are free. One person with one GPU can do this, so it doesn't depend on how many miners join. **User (Oct 4):** pre-launch visitors will be traders, so it won't be flooded with miners; as more GPUs come in, change the protocol to **require more $HASH buying as an entry ticket into mining**. That ticket (a bag in every mining wallet) is also the fix for splitting, so add it before the chest is large. Known risk until then.
- **Rented and farm hashrate:** the 5× target makes renting profitable and anyone can point a miner at the pool with their wallet, with or without the app. Same answer: the entry ticket grows with GPU count.
- **Pool login:** `packages/switcher/src/assign.ts` logs in to the pool with the miner's Solana wallet. On normal pools that login must be the coin's payout address, so the coin would never reach us. Needs `PLATFORM_COIN_ADDRESS.solWallet.rig-gpu` (or a pool account, or our own pool); fix it when the pool is chosen (Phase 1). User: none of the tech is set up yet.
- **Money in vs money moved:** the only outside money is mining revenue (1,000 GPUs ≈ $2.5K/day of buys against ≈ $283K/day of volume at the 5× target); the chest and holder pot redistribute traders' tax. **User:** the level system makes miners buy more and feel pressure to hold (the sim agrees: levels roughly doubled the price outcome).
- **Trust:** all the tax lands in a wallet we control and our server decides payouts; the fee withdraw authority can't be renounced. Plan: publish every payout round (inputs, who got what, Solscan links) so anyone can re-run the open-source engine and check it; a multisig with independent signers; an on-chain claim later.

## 12. Name: Hashcoin ($HASH), decided Oct 3
It follows the classic coin pattern (Bitcoin, Litecoin, Dogecoin, Hashcoin), and "hash" is literally what payouts are measured by (hashrate). Before launch, check the .com and the $HASH ticker for clashes on Solana (HASH is also Provenance Blockchain's ticker on other chains).
**Logo (decided Oct 3):** option C, an italic two-bar hash on a coin. Coin #EBB447, hash white. Final files in `apps/web/brand/logo/` (SVG master, PNGs 16–1024, favicon, wordmark lockups). Brand accent color = #EBB447.

## 13. Website direction (Oct 3)
**Current website (Oct 4, preview Version 27).** The bullets further down are the dated history; where they disagree, this summary wins.
- **Hero, left:** title "The first token your GPU gets paid to buy." (no tag above it), lede "Spare power on everyday PCs becomes nonstop buying of $HASH. Then 5% of every trade flows back: a bonus that lifts miners' average pay up to 5× what they mine, and rewards for everyone holding." (Oct 4: was "tops miners up to 5×", which isn't true for each miner), bullets Hold it (no GPU needed) / Mine it (no buying needed) / Or both, buttons "Join the waitlist (Coming soon)" and "What would I make?".
- **Hero, right:** two flywheels with tabs. The coin flywheel (Miners buy in → Holders hold → Trades fill the pot → Both get paid → More people join) plays three times, then the bag flywheel once per level (Get $HASH: buy, mine or both → Trades pay you → Your bag grows → Level up → Bigger share; mint/violet/gold per level), then back. A framed caption bar under the wheel with step buttons and Pause.
- **Topic explorer** (seven tiles, one topic at a time, fills the screen on big monitors): What you'd make (level cards; Holding "No GPU needed", Mining "No buying needed", Hold + mine), How it works (5% pot, holder rewards, miner bonus, the self-balancing split slider, tax-pot simulation and math behind toggles), Levels, Tokenomics, Mining (your PC works like normal), Launch (waitlist placeholder, countdown, status), FAQ.
- **Header:** Earnings, How it works, Levels, Tokenomics, Mining, FAQ; X, Discord, CA (at launch), Join the waitlist.
- Still to verify before launch: the "first" claim (re-search), the "your PC works like normal" claim on every coin the app switches to, and the holder payout cadence (the site must not say holders are paid every 10 minutes until decided).

- **Positioning (user, Oct 3; audience order updated Oct 4, see "Traders first"): not a memecoin.** Present $HASH as a token with real tech: any PC with a GPU mines, every payout is a market buy of $HASH, holders are rewarded, and a 5% tax pays it all back out. **Audience: traders who already own a PC with a GPU**: gaming PCs, gaming laptops, AI rigs, editing and render workstations (user, Oct 3: "it's not just gaming PCs"). A few clicks to start. Don't market to existing GPU miners: they'd flood the chest without caring about the coin.
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
- **Traders first (user, Oct 4):** the site read as made for miners, so traders thought "no need to buy, I'll just mine it" or "I don't want to mine, so no point holding". Traders are the most important audience; mining is the optional extra. Changes:
  - Hero: "Hold $HASH. Every trade pays you." Bullets: No GPU needed (holders share a cut of the 5% tax) / GPUs buy it 24/7 (miners' earnings are swapped into $HASH) / Hold longer, earn more (Level 2 2×, Level 3 4×) / Got a GPU? Stack both (mining adds more $HASH, the bag unlocks the bigger miner bonuses). Device chips moved out of the hero. Second button: "What would I make?"
  - Bag flywheel starts from holding: You buy → Trades pay you → Add a GPU (optional) → Your bag grows → Level up. Bubbles: Your buy, Rewards, Mining, Bag grows, Level up.
  - Earnings tab: "What would you make?"; Holding (No GPU needed) first, then Add a GPU (Optional), then Hold + mine ("Mining alone stays at Level 1: the 2× and 4× miner bonus also need a bag"). Level cards list Hold before Mine.
  - "Your PC" is renamed "Add a GPU" (tab, header and footer links) and moved after Tokenomics. How it works lists holder rewards before the miner bonus ("Busier trading pays holders more").
  - FAQ answers both objections: "Do I need a GPU?" (no; miners' share is capped, so busier trading means more for holders) and "Why buy if I can just mine it?" (mining alone stays at Level 1/M1; holding unlocks M2/M3 and earns holder rewards).
  - Copy no longer says holders are paid every 10 minutes (holder cadence is still hourly or daily, to be decided).
- **Balanced, plain title and a bag loop with two ways in (user, Oct 4, replaces the trader-first hero and bag wheel above):** the title shouldn't lean on mining or on trading, and shouldn't be a catchphrase. The bag flywheel shouldn't read as "you have to buy and you have to mine", but the two shouldn't be split apart either.
  - Hero title (plain description): "A token that pays its holders and its miners." Bullets: 5% of every trade goes back out (a public formula splits it) / Hold it (holders share at least 1% of every trade; no GPU needed) / Mine it (any PC with a GPU, paid in $HASH plus a bonus; no buying needed) / Or both (mined $HASH counts toward your bag, holding unlocks the bigger miner bonuses).
  - Bag flywheel: buying and mining are two ways in to one shared loop, which is the bag itself: Get $HASH (Buy or Mine, "or both") → Trades pay you (holder rewards on the bag; "+$X a day bonus if you mine" in small type) → Your bag grows (a week holding, and separately "plus an RTX 5090") → Level up (the next level's requirement) → Bigger share (2× / 4×) → around. Bubbles: Buy or mine, Rewards, Bag grows, Level up, Bigger share.
  - Earnings cards: Holding "No GPU needed", Mining "No buying needed", Hold + mine. The "Add a GPU" tab and links are "Mining" again. FAQ adds "Do I need to buy $HASH to mine?" next to "Do I need a GPU?" and "Why buy if I can just mine it?".
  - Ring bubbles are placed so their box clears the card's box (not just the point on the spoke).
- **Hero tells what's new (user, Oct 4: "A token that pays its holders and its miners" doesn't tell the story, anything can do that; people need to see this is new):** eyebrow "A new kind of token", title "GPU power buys it. Trading pays it back." (two sentences, two lines on desktop), one-sentence lede: "Spare GPU power on everyday PCs becomes nonstop buying of $HASH, and a 5% tax on every trade goes back to the people holding and mining it." Then Hold it / Mine it / Or both. **"First of its kind" is not on the site yet:** two web searches (Oct 4) found nothing combining GPU mining → market buys of a Solana token → a trade tax paid back to holders and miners, but that doesn't prove it, and "first mineable Solana token" would be wrong (ORE is mined on Solana). Add "first" only after a proper check.
- **"First" claim research (Oct 4) and the title it allows:** each piece of $HASH already exists somewhere, so broad "first" claims would be false:
  - A mineable Solana token: **ORE** (proof of work on Solana since April 2024; mining revenue funds ORE buybacks and staker yield).
  - Mining a Solana memecoin with your GPU: **unMineable** (mine a GPU algorithm, get paid in BONK, SHIB, SOL and 90+ others).
  - Your GPU earns a Solana token: **Nosana** (NOS), **io.net**; **GamerHash** for gaming PCs (AI compute, paid in GUSD/GHX).
  - Holders paid from mining: **BlockDrop** (leased Bitcoin ASICs → weekly SOL airdrops to holders, April 2024), **GoMining**.
  - Holders paid from trading fees: **pump.fun Holder Rewards** tokens and classic reflection tokens.
  - Nothing found (about a dozen searches) where **the token's own trading tax pays the GPU miners whose earnings buy it** (topped up to 5× their mining), in one loop with holder rewards. That narrow claim is the one the site uses: title "The first token where trading pays the GPUs that buy it." Absence in searches isn't proof; re-check before launch and keep the claim this narrow (never "first mineable token" or "first token your GPU earns").
  - **Title chosen by the user (Oct 4): "The first token your GPU gets paid to buy."** (Same claim, shorter. "The first token you get paid to buy" was rejected: cash buyers pay the 5% tax rather than get paid, and tokens that pay holders after a buy already exist.) The tag above the title was removed (user: "feels like AI slop"). Earlier draft: eyebrow "Built on Solana", "The first token where trading pays the GPUs that buy it.", and the lede "Spare power on everyday PCs becomes nonstop buying of $HASH. Then 5% of every trade flows back: a bonus that tops miners up to 5× what they mine, and rewards for everyone holding."
- **Big screens (user, Oct 4):** the hero text column is bigger (headline, bullets, chips and buttons scale with the screen). The flywheel caption sits in a framed bar centered under the wheel, always the same height so the wheel never jumps. The topic explorer matches the hero's width and scales up as a whole (home.js `fitExplore`, CSS `zoom`), fills at least one screen, and short topics sit centered in the space under the tiles.
- **Earnings cards say what each path needs (user, Oct 4):** the Level 2/3 cards showed the H2/H3 hold rule, which isn't what M2/M3 need, and the Mining card said "No buying needed" at every level. Now the Mine line carries its own bag rule ("48h in 2 weeks + hold $50", "120h in 2 weeks + hold $500 a day") and the Mining badge follows the level (No buying needed / Needs $50 held / Needs $500 held a day). **The default GPU is whatever is first in the list** (RTX 5090), never a hand-picked card (`hcTopGpu` in site.js; home and calculator).
- **Level colors (Oct 3):** Level 1 mint #5ED3A5, Level 2 violet #8FA3FF, Level 3 gold #EBB447. Selecting a level recolors the earnings panel; level badges and the calculator's M/H buttons use the same colors.
- **Your PC claim (user, Oct 3):** mining doesn't take away any of the PC's functionality: it only uses unoccupied GPU power, and with heavy programs open only the hashrate drops. This is the user's own experience mining PRL on their PC (no difference even in heavy games); **it's how the miner behaves, not a feature we build.** The site says so ("Your PC works like normal. It only uses spare GPU power.") with an illustrated GPU meter (idle / browsing / gaming / rendering). Re-check if the app switches a card to another coin or miner.
- **Laptop GPUs (Oct 3):** the GPU list has 133 cards including 45 laptop GPUs. hashrate.no measures only three laptops (RTX 3060/3070/3070 Ti Laptop); the other 42 are estimated from the desktop card with the same or nearest chip, scaled for laptop power limits (`apps/web/scripts/gen_gpus.py`), and labeled "est." on the site.
- **Before the site goes live:** set `launchAt`, `ca` and the social links in `apps/web/assets/js/config.js`, connect the waitlist and the live data, keep "temperature/power limits" marked as planned until the app ships them, and re-check the "only uses spare GPU power" claim on any coin other than PRL.
- **Not started yet (deliberately):** real miners and pools research, devnet token, backend, desktop app on Windows. See `docs/TECHNICAL-PLAN.md`.
