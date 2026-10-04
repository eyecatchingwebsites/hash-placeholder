# Hashcoin Technical Plan

Written October 3, 2026 for the next (local) work sessions. Read `docs/PROJECT.md` for the decisions and numbers, and `docs/ARCHITECTURE.md` for the system diagram. This file is the **ordered build plan**: what to build, in what order, what each piece needs, and how we'll know it works.

Legend: ✅ done · 🟡 started · ⬜ not started · 🔑 needs the user (accounts, money, hardware, decisions)

---

## 0. Where things stand
| Area | State | Location |
|---|---|---|
| Payout engine (tax split, holder + miner levels, weights, caps, epoch, holder payout, settlement, token split) | ✅ 29 tests | `packages/engine` |
| Coin switcher (per-card scoring, hysteresis, signed assignments) | ✅ 11 tests | `packages/switcher` |
| Assignment API (`/v1/assignments`, `/v1/miners`, `/v1/keys`) | ✅ 4 tests, placeholder pools and miners | `services/api` |
| Desktop app (Rust core + Tauri shell) | 🟡 core 13 tests, end-to-end test passes, never run on Windows | `apps/desktop` |
| Website (home, calculator, FAQ/docs; backend parts are placeholders) | 🟡 static front end | `apps/web` |
| CI + Windows release workflow | 🟡 written, never run on GitHub | `.github/workflows` |
| Simulation, calculators | ✅ (defaults still on the old 5% split) | `sim/`, `calculator/` |

---

## Phase 1: Decisions and research (first local session) 🔑
These block real mining. Each one is research plus a decision from the user.

1. **Miner programs per coin** (PRL, QUAN, QTC, and maybe EPIC).
   - For each: name, NVIDIA/AMD/Intel support, open or closed source, **dev fee %**, license terms on redistributing or auto-downloading, and the Windows build URL and SHA-256.
   - Must-haves:
     - A local stats API (hashrate per GPU), for the dashboard and benchmarking.
     - Device selection flags.
     - No bundled crypto-wallet or telemetry surprises.
   - Output: fill in `services/api/config/miners.json`.
2. **Pools per coin.**
   - Must-haves:
     - **Per-worker stats API** (accepted shares or hashrate per worker name), because payouts are credited from this.
     - Worker names in the form `wallet.rig-gpu`.
     - Payout to one platform address. **The login must be our coin address plus the worker name** (`PLATFORM_COIN_ADDRESS.solWallet.rig-gpu`), or a pool account. `packages/switcher/src/assign.ts` currently logs in with the Solana wallet alone, which on a normal pool would send the coin nowhere. Check each pool's worker-name length limit (Solana addresses are 32–44 characters) and fix `assign.ts` once a pool is chosen.
     - PPS/PPLNS terms and the pool fee.
     - Regions.
   - Output: fill in `services/api/config/coins.json`.
   - Fallback if no pool fits: run our own pool for that coin (more work, see Phase 6).
3. **Launchpad.** The tax is now 5%, which LaunchLab's reward launch probably can't do (it appeared to allow 1% or 3%), so the likely route is our own Token-2022 token + Raydium CPMM pool. Verify LaunchLab anyway. 🔑 decision.
4. **Accounts** 🔑:
   - .com domain.
   - Hosting:
     - Web: Vercel.
     - Backend: a small VPS (e.g. Hetzner or DigitalOcean) or Railway/Fly.
   - Postgres (e.g. Neon or Supabase).
   - Solana RPC (Helius, QuickNode or Triton, with webhooks or enhanced transactions for transfer indexing).
   - Code-signing (Azure Trusted Signing is cheapest; otherwise an OV certificate).
   - Squads multisig.
5. **Legal check** 🔑 before any public marketing.

## Phase 2: Devnet token and money flow
Goal: prove fee → chest → payouts on devnet with fake miners.

1. `packages/chain` (TypeScript, `@solana/web3.js` + `@solana/spl-token`):
   - `createHashMint()`: Token-2022 mint with the transfer-fee extension at 500 bps, a high max fee, and both fee authorities set to a multisig. Mint and freeze authorities revoked after minting; no other extensions. Devnet: a throwaway keypair from env, never committed.
   - `harvestFees()`: collect withheld fees from token accounts (`harvestWithheldTokensToMint` + `withdrawWithheldTokensFromMint`), then split with `splitTax` into dev, chest and holder-pot wallets.
   - `indexTransfers(fromSlot)`: stream every $HASH transfer, then call `applyBalanceChange` per wallet (any outflow shrinks the hold clock in proportion). Webhook or polling.
   - `sendBatch(transfers)`: pack about 20 transfers per transaction (Token-2022 `transferChecked` with fee), with priority fees and retry. Create associated token accounts for new miners (budget ~0.002 SOL each).
   - `buyHash(usd)`: Jupiter swap quote and execute from the treasury, with a max-slippage guard.
   - Gross-up: a payout of N tokens needs N / (1 − 0.05) sent so the recipient nets N. The withheld 5% returns via harvest.
2. **Devnet end-to-end script:**
   - Mint the token and seed a devnet pool.
   - A bot trades to generate fees.
   - Fake pool feed → engine `runEpoch` → `splitTokens` → `sendBatch`.
   - Check the balances and the ledger.
3. **Engine changes:**
   - Exclude dev and treasury wallets from the chest (config list).
   - Done: 5% tax with `splitTax` (5× miner target, 3.5% chest cap, 1% holder minimum), holder and miner levels, `runHolderPayout`. Remaining: wire `splitTax` → `runEpoch` / `runHolderPayout` in the backend.

## Phase 3: Backend service
`services/backend` (Node + Postgres), deployed on the VPS. Jobs:

| Job | Every | Does |
|---|---|---|
| collector | 1 min | Pulls per-worker stats from each pool, then earnings estimates per wallet. Each hour, credits mining hours per wallet with `creditedHours` (actual vs the catalog rate for the GPU's model; full at 80%+), keeps a rolling 14-day total for M levels, and flags GPUs running >150% of their claimed model |
| chain-watch | live | Transfer indexer, then `WalletState` per wallet (`applyBalanceChange` with `clockStartTokens`), plus the level price (`levelPriceUsd` of the 1h and 7-day averages). Tags treasury and payout transfers so volume stats count outside trades only |
| fee-watch | 10 min | Harvests the Token-2022 tax, then `splitTax` → dev / chest / holder-pot buckets |
| holders | 1 h or 1 day | `runHolderPayout` over all wallets (excluding dev, treasury, pools, exchanges) → `sendBatch` |
| epoch | 10 min | `runEpoch` → buy $HASH → `splitTokens` → `sendBatch` → write the ledger |
| settler | 15 min | Confirmed and sold mined coins → `settle` true-ups |
| prices | 15 min | Per-card revenue per coin (hashrate.no API or our own calculation from network difficulty), feeding the switcher's quotes |
| api | — | Assignments (existing), plus a public dashboard API: totals, recent payouts, wallet page (level, progress, paid / pending) |

**Ledger tables (Postgres):**
- `wallets` (address, first_hash_at, ever_sold, balance)
- `workers` (wallet, rig, gpu, last_seen)
- `epochs` (id, chest_usd, carry_usd, price)
- `payout_lines` (epoch, wallet, level, mining_usd, immediate_usd, pending_usd, chest_usd)
- `pending` (epoch, wallet, est_usd, settled)
- `settlements`
- `transfers` (sig, wallet, amount, status)
- `float` (balance snapshots)
- `waitlist`

**Public payout record (trust):** every payout round publishes its inputs (tax harvested, mined USD per wallet, levels, prices) and its results (who got what, Solscan links) on the dashboard, so anyone can re-run the open-source engine and get the same numbers. Later: publish a hash of each round on-chain and pay through an on-chain claim.

**Safety:**
- Treasury in a Squads multisig, with signers who aren't all the same person. The hot payout wallet holds only the float, with an automatic refill from the multisig needing manual approval above a limit.
- A kill switch: pause payouts.
- Alerts: float low, epoch failed, pool feed stale, RPC errors, payout tx failures.
- Watch for block withholding: expected vs actual blocks per pool, and flag wallets with many shares but no blocks.
- Rate limiting on the API (per IP and per wallet).

## Phase 4: Website (`apps/web`)
The static front end exists (`apps/web`, plain HTML/CSS/JS; see its README and `docs/HANDOFF.md`). Its current state is in `docs/PROJECT.md` §13. Next:
1. **Framework:** move to a small Next.js or Astro site on Vercel, keeping the current design (tokens, fonts, sections).
2. **Pages:**
   - `/`: landing (done as a draft)
   - `/dashboard`: live totals, chest, burn of fees, recent payouts with Solscan links, coin mix, GPUs online
   - `/wallet/[address]`: miner and holder level, progress ("$12 to H1", "18h to H2", "40 more hours mined to M3"), paid / pending, payout history
   - `/download`: signed installer, SHA-256, VirusTotal link, antivirus FAQ
   - `/calculator`: the full calculator (`calculator/index.html`), fed live inputs at launch
3. **Waitlist backend:** a `waitlist` table, a POST endpoint, and a live counter. Store an X handle or email, the GPU model, and an optional public wallet. Rate-limit and validate.
4. **Status strip and hero numbers** read from the dashboard API. Until launch they show "—", never invented numbers.
5. **Rules (from CLAUDE.md):** no return promises, and the contract address published only on the site.
6. **Site claim to keep true:** the site says mining only uses spare GPU power and your PC works like normal (only the hashrate drops when a game or render runs). That's the user's own experience mining PRL, not a feature we build. Re-check it on other coins/miners the app switches to; if one behaves differently, change the copy.

## Phase 5: Desktop app to release 🔑 (needs a Windows PC with a GPU)
1. Put the real miners and pools into config. Run the app against the dev API on the user's PC. Confirm GPU detection (nvidia-smi, AMD and Intel via Win32_VideoController), download, verify, and that mining starts.
2. **Benchmarks:** on first run, 60–120 s per supported algo per card, reading hashrate from the miner's local API. Report it in check-ins (the API already accepts `benchmarks`).
3. **Safety:**
   - Temperature limit (pause above ~83 °C).
   - Power limit via the miner's flags where supported.
   - Pause while a fullscreen game or a listed game process is running (optional; mining PRL already doesn't affect games in the user's experience).
   - "Mine only when idle" option.
4. **Settings:**
   - Auto-start at login (off by default).
   - API region.
   - A "Paid / Pending" panel read from `/wallet/[address]`.
5. **Updates:** Tauri updater with a signed update feed.
6. **Release:**
   - Put the production public key in `TRUSTED_KEYS`.
   - Enable the code-signing step.
   - Run `desktop-release.yml`.
   - Submit to Microsoft's false-positive portal and VirusTotal.
   - Publish the SHA-256.
7. **Proof video:** unedited install → first payout, with the Solscan link on screen.

## Phase 6: Hardening and launch
- Security review of the backend, payout signing and key handling. Consider an external review of `packages/chain` and the treasury flows.
- Load test the epoch job (5,000 wallets → transfer batching and RPC limits).
- Our own pool for any coin without a suitable pool (open-source stratum server + node), only if Phase 1 found no option.
- **Mining entry ticket (user, Oct 4):** as GPUs grow, require a $HASH bag in every mining wallet before it gets any chest share. It also stops one GPU being split across many wallets for extra √ weight. Add it to the engine and sim before the chest is large.
- Launch checklist:
  - Token setup decided (`docs/PROJECT.md` §11): supply, starting liquidity and LP lock/burn, mint and freeze authorities revoked, no other extensions, anti-snipe plan.
  - Multisig configured and fee authorities moved.
  - Dev wallet locked or vested publicly.
  - Float funded (~$1K).
  - Kill switch tested.
  - Alerts on.
  - Waitlist emailed.
  - Contract address posted on the site first.

---

## Open technical questions
1. Payout cadence: 10 minutes (best proof, about 6× the transaction cost) vs hourly after launch week.
2. The renter leak at L2 ($50 buys 2× immediately). Add a minimum wallet age for L2, or raise the threshold? Test in `sim/`.
3. Price source for level thresholds: Jupiter price API vs our own pool's average (TWAP).
4. Whether hashrate.no has an API or terms that allow automated use. Otherwise compute revenue from network difficulty, block reward and price per coin.
5. How to handle a GPU that can only mine one coin, if that coin's pool goes down: stop it, or fall back to the next coin even if it scores lower?

## Next session: suggested first steps
1. Phase 1, items 1–2: research miners and pools, then fill in the configs.
2. Phase 1, item 4: open the accounts.
3. Phase 2: build `packages/chain` and run the devnet end-to-end.
4. In parallel on the user's PC: Phase 5, step 1 (first real run of the app).
