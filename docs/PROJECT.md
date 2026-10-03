# $HASH / Hashcoin: Project File (v3)

Last updated: October 2, 2026. Stage: design, simulation, and early build. Numbers are scenario assumptions, not forecasts. Not financial or legal advice.

- Original v1 notes (from the earlier chat): `docs/PROJECT-v1-original.md`
- Architecture: `docs/ARCHITECTURE.md`
- Simulation: `sim/` (see `sim/README.md`)
- Payout engine (TypeScript, tested): `packages/engine`
- Earnings calculator: `calculator/index.html` (published: https://claude.ai/artifact/CDWZXxmNsZw4DNCxHhdJY5)
- **Technical plan (ordered build plan for the next sessions): `docs/TECHNICAL-PLAN.md`**
- Website design brief: `docs/DESIGN-BRIEF.md` · 3D asset brief: `docs/3D-BRIEF.md`
- Website design draft: `apps/web/index.html` (published: https://claude.ai/artifact/6rNGUh1g9ajuANnbFjGzrJ)
- Creator earnings over time: `calculator/creator.html` (published: https://claude.ai/artifact/GeRFqwnVPJuVLFzcsP6J1Y)
- Work happens in a Claude Code cloud session (the user has $100 of gifted cloud credits). Branch: `claude/lucid-fermat-16svvo`.

---

## 1. Summary
A memecoin plus GPU-mining platform, marketed to **memecoin traders who have gaming PCs** (pre-existing miners will find it anyway if it pays). Users mine through the platform. What they mine is sold to buy $HASH, which is paid back to them. A trading fee funds a chest that's shared among miners, weighted by GPU earnings (square-root balanced) and the miner's **level**. Pitch: "The memecoin your GPU mines." Goal: a lasting coin. The creator prefers a stable $500K–1M market cap for 6 months over a few-day $10M runner, though both are fine outcomes.

## 2. Token and fee (decided, pending launchpad verification)
- **Solana, Token-2022 with the transfer-fee extension.** The fee is enforced by the token program on every transfer, in every pool, aggregator and wallet. Nobody can trade around it.
  - Lesson from **$UPLIFT**: it crashed because people bought on other exchanges and avoided its fee. Its chest (paying wallets that lost money) dried up. Token-2022 prevents this.
- **3% total fee:**
  - **2.5% to the miner chest**
  - **0.5% to development** (disclosed: "3% fee: 2.5% to miners, 0.5% funds development")
  - **No burn** (dropped in favor of a simpler split)
- Why 3% over 5%:
  - A round trip costs 6% instead of 10%, so more flippers and more volume.
  - It's what Raydium LaunchLab "reward launches" appear to allow (1% or 3%, unverified).
  - It sounds cleaner on a chart page.
  - A chest at 3% equals one at 5% if volume is ≥ 1.67× higher.
- **Fee authorities:** fee config and withdraw authorities in a multisig. Publicly commit to never raising the fee, and ideally renounce the config authority after launch. Set the max fee per transfer high.
- **Our own transfers are taxed too** (payouts to miners, etc.). The fee is held in the recipient account and collected back into the treasury, so it recirculates. Send a little extra so miners receive the full amount.
- **Launchpad:**
  - **pump.fun can't do this.** Its creator fee is fixed (0.30% on the curve, then 0.95% → 0.05% on PumpSwap), only charged in its own pools, and can be avoided elsewhere, which is the $UPLIFT problem.
  - **Options:**
    - (a) Raydium LaunchLab reward launch at 3%. Needs verifying: fee options, who controls the authorities, and where fees go.
    - (b) Our own Token-2022 token plus a Raydium CPMM or Orca pool (both support transfer-fee tokens). We'd bring our own traffic.
  - **"Fomo"** (a trading app): unknown. If it routes to any exchange, the Token-2022 fee still applies.
- **Dev holding: 1% of supply.**
  - Bought openly as a dev buy at launch, in one public wallet.
  - Locked or vested publicly, e.g. no sells for 90 days, then at most 0.25% of supply per month.
  - **The dev wallet is excluded from the chest** (no self-dealing).
  - Dev holdings, the dev-fee wallet, and the treasury/float multisig are kept separate.

## 3. Levels (decided)
| Level | Requirement | Chest weight |
|---|---|---|
| 1 | Mining (default) | 1× |
| 2 | $HASH position ≥ $50 | 2× |
| 3 | Position ≥ $500 **and** ≥ 14 days since $HASH first landed in the wallet **and** never sold | 4× |

- **Weight** = (GPU USD earnings)^0.5 × level multiplier. Each wallet is capped at 5% of the chest. The excess is shared out to the other wallets, and anything left carries to the next epoch.
- **The 14-day clock** starts the first time $HASH lands in the wallet (a mining payout or a buy). It keeps running through dips. Side effect: people can "pre-age" wallets with dust, but L3 still needs $500 and never having sold.
- **Downgrades:**
  - L2 → L1 when the position is below $50.
  - L3 → L2 when the position is below $500. Back above $500 restores L3 immediately, with no new 14-day wait.
- **Selling at any time permanently disqualifies the wallet from L3.** It can still be L1 or L2.
- **Transfers out count as selling,** including wallet-to-wallet moves, LP deposits and CEX deposits. Buying never counts.
- **Mined $HASH counts toward thresholds.**
- **Position value** uses a ~1-hour average price, checked at each payout.
- **The website shows "paid in the last 24h" per level,** never promised percentages. Only the 1:2:4 ratio is fixed.
- **Possible L3 perks:** 100% instant payout, a vote on auto-switch coins, a badge or role.
- **Consequence:** L3 holders can't take partial profits, so exits tend to be all at once.
- **Sqrt balancing:** small GPUs get the biggest multiplier, which makes good marketing. Splitting one rig across wallets only pays at L1, because each wallet needs its own $50 or $500.

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
- **GPU revenue data:** hashrate.no/gpus, fetched 2026-10-03. 91 cards, saved in `data/hashrate-no-gpus-2026-10-03.json` and loaded into the calculator. 24h revenue on each card's best coin:
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
  - Tokenomics box (3% = 2.5% miners / 0.5% development, 1% dev holding locked, contract address only at launch).
- **For miners:** "Mine with your gaming PC. Get paid in $HASH every 10 minutes."
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
- Note: the simulation still uses the old 5% split. Update it for 3% (2.5/0.5).

**Calculator presets (4070, L2, old 3% chest rate):**

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
| Payout engine (`packages/engine`): levels, weights, cap, epoch, hybrid payout, settlement, token split | Done, 15 tests |
| Coin switcher (`packages/switcher`): per-card scoring (benchmarks or hashrate.no catalog, slippage and confirmation-delay penalties), hysteresis, Ed25519-signed assignments, wallet validation | Done, 11 tests |
| Assignment API (`services/api`): `POST /v1/assignments`, signed miner list `GET /v1/miners`, `/v1/keys`, `/v1/health` | Done, 4 tests. Placeholder pools and miners in `config/` |
| Desktop app (`apps/desktop`): Rust core (GPU detection, signature checks, hash-verified downloads, safe unzip, flag-injection guard, crash-restart supervisor) + Tauri 2 shell (wallet entry, Start/Stop, tray, background check-ins) | Core: 13 tests. App compiles. End-to-end test passes (API + app + stand-in miner). Not yet run on Windows |
| CI (`.github/workflows/ci.yml`) and Windows installer build (`desktop-release.yml`, blocks until the production key is set) | Added, not yet run on GitHub |
| Architecture doc, simulation, calculator, creator page | Done |
| Devnet test run: Token-2022 3% token, fee collection, mock pool feed, batch payouts | Next |
| Website: landing page design (`apps/web`) | Draft done. Dashboard, wallet page, download page and waitlist backend next (see TECHNICAL-PLAN Phase 4) |
| Real miners and pools (licenses, dev fees, per-worker APIs) for PRL / QUAN / QTC | Research needed |
| Desktop: code signing, temperature/power limits, pause while gaming, auto-update, benchmarks, AV false-positive submissions | To do (`apps/desktop/README.md`) |
| Engine: exclude dev/treasury wallets from the chest | To do |
| Update the simulation and calculator defaults to 3% (2.5/0.5), $150/month lean costs, a SOL fee line | To do |

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
- Launchpad: LaunchLab 3% reward launch vs our own Token-2022 token and pool (verify LaunchLab details).
- L2 threshold or minimum wallet age, to reduce renter capture.
- Payout cadence (10 min vs hourly) vs transaction cost.
- Coins to support for switching, and which pools have per-worker APIs.
- Legal review (payouts funded by other people's fees, custody, marketing language).

## 12. Name: Hashcoin ($HASH), decided Oct 3
It follows the classic coin pattern (Bitcoin, Litecoin, Dogecoin, Hashcoin), and "hash" is literally what payouts are measured by (hashrate). Before launch, check the .com and the $HASH ticker for clashes on Solana (HASH is also Provenance Blockchain's ticker on other chains).
**Logo (decided Oct 3):** option C, an italic two-bar hash on a coin. Coin #EBB447, hash white. Final files in `apps/web/brand/logo/` (SVG master, PNGs 16–1024, favicon, wordmark lockups). Brand accent color = #EBB447.

Design direction from the user (Oct 3): product company look like usepaid.app / usehotbot.com / boneronlong.xyz. No rainbow buttons, no crowded layouts. Logo: the user makes it with ChatGPT. 3D: free models and code-built, try both. Colors undecided.
