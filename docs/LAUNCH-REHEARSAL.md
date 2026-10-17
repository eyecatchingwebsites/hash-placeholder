# Launch dress rehearsal (devnet, October 17, 2026)

Everything together as on launch day: the real launch script, the payout loop in its mainnet setup, the local API, the collector on **live** Kryptex mining, alerts to a webhook, the kill switch and crash restarts. Devnet only, throwaway keys in `packages/chain/data/rehearsal/` (gitignored). Driver: `services/payouts/scripts/launch-rehearsal.ts`. The runbook that came out of it: `docs/LAUNCH-RUNBOOK.md`.

**Result: passed end to end, after fixing four bugs it found** (below). Times are UTC.

## Setup

| | |
|---|---|
| Token | `CR81N6TeKVY29bKcETKkQCNQSawbBYALw8BsNPadQHiy` (DBC config `CG74K3j5FdLBWUXjdsrLpGMikT1qi7et1X48MmiiBrjg`, DBC pool `CxkoQ9zwjUdw1mxoC9nXe1m5mnpRQqRFpkMD9Ama5Dy3`, DAMM v2 pool `7EeshxEYgzRk69MiaXjL1xNiYM5UMQZ5YqL97wh6BfT3`) |
| Launch | `launch-mainnet.ts --cluster devnet --graduation-sol 0.08` with the decided settings (5% tax, 25% to the pool, curve fee 20% → 1% over 5 min, 0.25% pool fee, 1% dev buy in the pool transaction) |
| Wallets | launcher `CEtWDx4L…`, a separate dev wallet `DFusaJq3…`, a separate partner = payout wallet `fqRC83Vk…`, 3 traders, multisig stand-in `HW3Etz9c…` |
| Payout loop | `payouts.mainnet.example.json` plus the market from the launch, `settlement: sales`, a round every 3 min (collector every 1 min); `--dry-run` first, then live |
| Alerts | `HASH_ALERT_WEBHOOK` → a local test endpoint (`launch-rehearsal.ts webhook`, logs to `webhook.log`) |
| Mining | **Live**: the user's Kryptex worker `h2ju2rm5lut-0` (RTX 4070 SUPER, ForgeMiner 1.8.8, ~45–50 TH/s on PRL) mined during the whole run. The local API (`services/api`, port 8788) recorded worker → the user's test wallet on a check-in; the loop's collector read the live worker from Kryptex and credited that wallet. Not recorded data. |
| Multisig | A plain key stands in for the Squads vault (no Squads on devnet). The loop's proposal was executed by signing its exact instruction with that key; a Squads vault signs the same instruction in a vault transaction. |
| Devnet stand-ins | SOL/USD fixed at **$25,000**, so the 0.08 SOL curve has a mainnet-sized market cap in dollars (holder levels, the formula and every USD limit see launch-like numbers). Graduation target 0.08 SOL (devnet SOL was short: the faucet was dry, 0.24 SOL came from older throwaway wallets). We ran the migration ourselves (Meteora's keeper does it on mainnet). |

## What was covered

| Step | Result |
|---|---|
| Launch dry run, then launch | ✅ Dry run 2.9 s (config simulation ok). Launch 4.9 s: config, pool + dev buy, checks PASSED (supply 21M, mint and freeze authority none, 5% tax, withdraw authority = payout wallet, dev bag 212,081) |
| Payout loop dry run, then live | ✅ The dry run read everything live: would claim 0.0015 SOL of curve fee, $12.25 of tax, the formula wants 2.25% (refused on the curve) |
| Curve fee funds the float | ✅ 0.00346 SOL claimed in 6 claims, the first 6 s after the loop started. After graduation the DAMM v2 pool fee too (0.0000505 SOL, 2 claims) |
| Market buys on the curve | ✅ Rounds 2–15. The first buy (round 2, 4.5 min after launch) cost exactly the 4% limit while the sniper fee wound down; later ones 1–3% |
| Miners credited and paid in devnet $HASH | ✅ Every round from round 2: the live worker's mining ($0.0011–0.0081 a round) bought on the market and paid to the user's test wallet (605,741 devnet $HASH as miner, plus holder rewards once its bag passed $50). The app endpoint `/v1/wallet/<address>` shows it (after fix 3) |
| Holders and dev | ✅ 3–4 holders paid every 2nd round (H1); dev every round with tax |
| Graduation | ✅ Round 16 saw "graduating": no buy, the miner's mining stayed owed, `phase-graduating` and `graduating` alerts |
| DAMM v2 migration and rounds after | ✅ Rounds 17–22 on DAMM v2 (buy cost 0.35–0.65%), `phase-damm` alert, the owed mining bought and paid |
| Rate change by the formula | ✅ Round 17: the payout wallet (rate authority after graduation) scheduled 2.25% (from epoch 1187) on its own |
| `ctl handover-rate-authority` | ✅ To the multisig stand-in. Afterwards (round 19) the loop wrote a proposal and a `rate-proposal-225` alert instead of sending; executing the proposal's instruction with the stand-in scheduled 2.25% on chain |
| Kill switch between rounds | ✅ Round skipped, `kill-switch` alert, `ctl resume` |
| Kill switch mid-round | ✅ Round 6: engaged right after the round was staged (its buy had landed): all 4 payouts refused and kept owed with their tokens; after `ctl resume`, round 7 paid each exactly once |
| Crash and restart | ✅ After fix 1: killed mid-payout 4 times. Landed while killed → recorded as paid, not sent again (round 14). Signed but not landed → waited for its blockhash to expire, then paid once (round 12) |
| Launch fails halfway | ✅ Re-running the launch with the pool already on chain (its result "lost") adopts that pool and runs the checks; no second token |
| Alerts to the webhook | ✅ rpc-errors, kill-switch, payout-failed, harvest-empty, phase-graduating, graduating, phase-damm, rate-proposal |
| Ledger vs chain | ✅ The dev wallet matches to the base unit; the miner matches except the one double payout from before fix 1 (11.896624) |

## Bugs found and fixed (with tests)

1. **Double payout after a crash.** A payout transaction that landed while the loop was killed (or whose confirmation timed out) stayed "owed" and was sent again after the restart. Seen live: round 8 paid 11.896624 devnet $HASH twice. Fix: each payout transaction is recorded (signature, last valid block height) before it's sent; before the next round plans anything it's looked up on chain: landed → recorded as paid; failed or expired → paid again; still pending → the round waits (`services/payouts/src/inflight.ts`, `sendBatch`'s `onSigned`). Proven live on rounds 12 and 14.
2. **An RPC hiccup erased a miner's payout.** `tokenBalance` read every RPC error as "no account, 0". After a buy, a rate-limited read made round 21 "buy −47,757.6 $HASH", give the miner 0 and mark the payout as sent. Fix: `tokenBalance` returns 0 only for a missing account and throws otherwise; what a buy returned is read from the buy transaction itself (falling back to the swap's guaranteed minimum); a payout that needed buying is never sent as 0 (it stays owed); the tokens-low check can't fail a round after its buy. Round 22 measured its buy from the transaction.
3. **The app showed "no activity" for a paid miner.** The public record listed only wallets the indexer had seen trade, so a miner who never bought didn't appear in `/v1/wallet/<address>` (the app's Paid / Still coming) until a later round. Fix: every wallet with mining credited, held back, owed or paid is listed.
4. **A launch re-run could create a second token.** If the pool transaction landed but the script never heard back, a re-run made a new pool and mint on the same config; and the funding check stopped any re-run once the launcher had paid the config's rent. Fix: a re-run first looks for a pool on the saved config and adopts it; with the config already made, only the pool's rent is asked for.

Smaller changes: the launcher check asks 0.02 SOL on devnet (mainnet stays 0.08); the payout config accepts devnet throwaway keys in `packages/chain/data`; `ctl` prints the message instead of a stack trace; new `ctl test-alert`, `packages/chain/scripts/keygen.ts` and `services/payouts/scripts/payouts.ps1` for launch day.

## Not covered, or known limits

- **A crash in the second between a market buy landing and the round being saved** makes the next round buy again: the float pays twice and the first tokens stay in the payout wallet; nobody is paid twice. The same for a crash right after a harvest: that tax stays in the payout wallet uncounted. Narrow windows; a follow-up.
- **Mining while the PC is off isn't credited** beyond 15 minutes per collector run (by design, so an outage doesn't hand out hours). The true-up to Kryptex's balance makes up part of it over the next day.
- Held-back mining paid from coin sales (`ctl sold`) wasn't re-run (the mainnet setting waits 10 h); it passed the Oct 16 rehearsal.
- The live SOL price path wasn't used (fixed at $25,000 here); the mainnet dry run reads it.
- No real Squads vault and no real Discord webhook: create both before launch and run `ctl test-alert`.
- The public devnet RPC rate-limited constantly (`rpc-errors` alerts, 429s in the log). Mainnet uses a paid RPC.
- Something else on this PC posted an empty body to the webhook port once (04:17:00), and another session held port 8799; neither came from the loop.

## Timeline

| Time | What |
|---|---|
| 04:12:59 | Devnet SOL moved from older throwaway wallets (faucet dry) |
| 04:13:22 | Local API up; the user's rig checked in: `h2ju2rm5lut-0` → the test wallet |
| 04:13:46 | Launch dry run: config simulation ok |
| 04:13:55–04:14:00 | **Launch**: config, pool + dev buy, checks passed |
| 04:14:09 | Traders buy into the 20% sniper fee (pool cost 23–38%) |
| 04:14:46 | Payout loop dry run |
| 04:15:02 | Payout loop live; round 1 claims the curve fee, harvests, pays dev |
| 04:18:27 | Round 2: first buy on the curve (cost 4.0%), first miner and holder payouts |
| 04:24:26 | Kill switch engaged after round 4; 04:27:11 round skipped with an alert; 04:27:23 `ctl resume` |
| 04:33:24 | Kill switch mid-round 6: buy landed, 4 payouts blocked and owed; 04:36:24 round 7 pays them once |
| 04:39:27 | Crash during round 8 (old code): the payout landed, the restart paid it again → bug 1 |
| 04:47:06 | Crash during round 12 (fixed code): not landed → the restart waits for expiry, pays once |
| 04:51:10 | Crash during round 14: landed → the restart records it as paid, sends nothing |
| 04:52:33 | Curve bought out → round 16 "graduating", no buy, alerts |
| 04:54:59 | Migration to DAMM v2 |
| 04:57:39 | Round 17: the formula schedules 2.25% (payout wallet); first DAMM v2 buy |
| 04:58:20 | `ctl handover-rate-authority` → multisig stand-in |
| 04:59:01 | Round 18 claims the DAMM v2 pool fee |
| 05:02:21 | Round 19: rate proposal for the multisig + alert; 05:02:47 executed by the stand-in |
| 05:03 | Launch re-run adopts the existing pool (fix 4) |
| 05:08:29 | Round 21: "bought −47,757.6" → bug 2 |
| 05:10:27 | Round 22 on the fix: buy measured from the transaction |
| 05:11 | Stopped |

## Rounds

Rounds 8, 12 and 14 were the crash tests (no round file; their transactions are in the list below). Trading paused during rounds 6–15 to keep devnet SOL for graduation, hence no tax there.

| Round | Time | Phase | Tax | Mined | Buy | Miners / holders | Transfers sent |
|---|---|---|---|---|---|---|---|
| 1 | 04:15:03 | curve | $12.25 | $0.0000 | — | 0 / 0 | 1/1 |
| 2 | 04:18:11 | curve | $12.88 | $0.0016 | bought 15.70 (cost 4%) | 1 / 3 | 5/5 |
| 3 | 04:21:11 | curve | $14.69 | $0.0028 | bought 20.60 (cost 1.11%) | 1 / 0 | 2/2 |
| 4 | 04:24:11 | curve | $11.48 | $0.0031 | bought 20.86 (cost 2%) | 1 / 3 | 5/5 |
| 5 | 04:30:11 | curve | $11.79 | $0.0062 | bought 38.66 (cost 1.02%) | 1 / 0 | 2/2 |
| 6 | 04:33:11 | curve | $0.00 | $0.0026 | bought 16.06 (cost 1.22%) | 1 / 3 | 0/4 (kill switch) |
| 7 | 04:36:11 | curve | $0.00 | $0.0020 | bought 12.69 (cost 1.54%) | 1 / 0 | 5/5 (4 retries) |
| 9 | 04:39:54 | curve | $0.00 | $0.0011 | bought 6.74 (cost 2.86%) | 1 / 0 | 2/2 (one was round 8's, again) |
| 10 | 04:43:08 | curve | $0.00 | $0.0016 | bought 9.91 (cost 1.96%) | 1 / 0 | 1/1 |
| 11 | 04:43:39 | curve | $0.00 | $0.0015 | bought 9.52 (cost 2.04%) | 1 / 0 | 1/1 |
| 13 | 04:47:28 | curve | $0.00 | $0.0023 | bought 14.08 (cost 1.39%) | 1 / 0 | 2/2 (one was round 12's) |
| 15 | 04:51:23 | curve | $0.00 | $0.0019 | bought 11.90 (cost 1.64%) | 1 / 0 | 1/1 |
| 16 | 04:54:33 | graduating | $117.50 | $0.0036 | none (graduating) | 1 / 3 | 4/5 |
| 17 | 04:57:33 | damm | $109.37 | $0.0056 | bought 19.41 (cost 0.35%) | 1 / 0 | 3/3 |
| 18 | 04:59:00 | damm | $0.00 | $0.0049 | bought 10.34 (cost 0.65%) | 1 / 4 | 5/5 |
| 19 | 05:02:16 | damm | $0.00 | $0.0051 | bought 10.75 (cost 0.62%) | 1 / 0 | 1/1 |
| 20 | 05:05:16 | damm | $12.26 | $0.0069 | bought 15.78 (cost 0.45%) | 1 / 4 | 6/6 |
| 21 | 05:08:16 | damm | $0.00 | $0.0073 | "−47,757.61" (bug 2) | 1 / 0 | 0/1 |
| 22 | 05:10:23 | damm | $0.00 | $0.0081 | bought 18.45 (cost 0.39%) | 1 / 0 | 1/1 |

Totals: tax 1,389,650 devnet $HASH ($458 at the rehearsal's scale), paid to miners 605,741, holders 666,974, dev 69,483; 116 mint transactions indexed.

## Every transaction

The payout wallet's and the mint's transactions from the chain, plus the funding transfers, labelled from the loop's records and the driver's log. Left out here: 58 harvest and payout-batch transactions, because the payouts go to the user's own wallet, which stays out of this public repo. The full list (131 transactions) is in `packages/chain/data/rehearsal/tx-table.md` on the user's PC (gitignored).

| Time | What | Transaction |
|---|---|---|
| — | fund 0.015689221 SOL 8Xf3wi → Bjn3sA | [4pVxcLRY…](https://solscan.io/tx/4pVxcLRYSZi6rqUGKSChrgGHMDzoFsX9J4xkUMtAMMbgNV7cZLmq89h5wRQibnQaK4eFwhN7LKhY4JwmxgP2TYj5?cluster=devnet) |
| — | fund 0.004310779 SOL 7xfyZN → Bjn3sA | [3U2iKvzs…](https://solscan.io/tx/3U2iKvzsrsBFMptJ5RHCcRMN7KtjKBth1YrsBTFQDZe3Jj2UWHSKDMMeUpwRrWF43QwSxxKud9nod1pDSNbkU11g?cluster=devnet) |
| — | fund 0.02 SOL 7xfyZN → BjcKPy | [4bExqt1m…](https://solscan.io/tx/4bExqt1mYdfgRSxu6i9Cji25CiWfRYy54UJhrfa2fs5eKGpEvNC3WCyyCZR677rpbUrGLEfYjBQkSuixrRsWGy6d?cluster=devnet) |
| — | fund 0.016613657 SOL 7xfyZN → 7y4m2t | [3n49Vn3f…](https://solscan.io/tx/3n49Vn3for93HSQxQAQnfj3CbdPswZ9JvvAwa7c1dpRFaVDRVm1A7fYEASNczsebAy48LQSpzBTZD6qfdsFmSDeE?cluster=devnet) |
| — | fund 0.046551804 SOL 2Cs4Ad → 7y4m2t | [5EgcnHH7…](https://solscan.io/tx/5EgcnHH7ee9aWX4PN1Y15CNjzjf2bBkH5dWCqPuMBz5k8MwF3zsGbBkhGphwdAiqq2Wop7fwRiyewBbxUhaLvip7?cluster=devnet) |
| — | fund 0.026834539 SOL FGN9sW → 7y4m2t | [4pZacoYt…](https://solscan.io/tx/4pZacoYt7NTgpxJx97eebkTPD3UxpStCkmXd9FLLrC4zgg9ehdozYL9AmiW4wejTdkhRMD9SjLYbRWkJQkdMZGJP?cluster=devnet) |
| — | fund 0.002 SOL FGN9sW → HW3Etz | [3ryrMF3K…](https://solscan.io/tx/3ryrMF3K6CXEEyTNe3V2xT1wUqrHPWtYUNM4RWwVdb4toiN48DNEozWbQeA9krRzjqB3nx2NfZ1VSJEenupnXzf2?cluster=devnet) |
| — | fund 0.012 SOL FGN9sW → DFusaJ | [3EY5YLQV…](https://solscan.io/tx/3EY5YLQVHoN23Qha1jUiVB46oUTTGxXc57hBwcusns5p8soMguoN6NMLivYKtmUgGVcXGbbxfwStsMcTfRknf4Nv?cluster=devnet) |
| — | fund 0.022 SOL FGN9sW → CEtWDx | [HQ31771B…](https://solscan.io/tx/HQ31771BvtsxxAwxXwAxr4P41JswHMZL5MQFS4jGNHrjRM3pYBbRhSRYeK7jKGybRxLJEyrpq3oJUQLxAuj5Q6e?cluster=devnet) |
| 04:12:56 | fund 0.05 SOL FGN9sW → fqRC83 | [2aGyk44P…](https://solscan.io/tx/2aGyk44PXKaogGh8v8MpC2tNaRh2ZLehwEUwbkhPpMv5Xh9pGM8BsgD3UTgAhW3AoisZZE7xFe17sG1VVTcgo6BP?cluster=devnet) |
| 04:13:57 | launch: create config (create_config2) | [2WVot4ci…](https://solscan.io/tx/2WVot4ciuVMnBwrPbcs8jxnx8sCAT3w5ewPa6DGEzDk5f68ucEvVGSPZsmBqKiJ8LMYRw7EczCUxVrE4CVZeho38?cluster=devnet) |
| 04:13:58 | launch: create pool + dev buy | [3cs6JpWX…](https://solscan.io/tx/3cs6JpWXmQuPuJjkyaNysdL4CTz49PFkCwoBFXR74H1pheev5V1NuyvEPjtwa7WnD9Fpi8LcbUjdeLrhiFhiuQhJ?cluster=devnet) |
| 04:14:08 | curve: trader 0 bought 850518 $HASH for 0.002 SOL (pool cost 22.76%) | [5ZJu9r8r…](https://solscan.io/tx/5ZJu9r8rTKq9f8jLUFtD2BXhhpNEdvGVKPELQTPNycJHX7xsuUd9riNKNMHXNBoXeQ4KgTPQsiAtpULeg7Xf7wLR?cluster=devnet) |
| 04:14:09 | curve: trader 1 bought 1164364 $HASH for 0.003 SOL (pool cost 29.5%) | [2v1kc3ZR…](https://solscan.io/tx/2v1kc3ZRJVWw2gjucB7e7swzMW2ekgyB6uZRsmFrNun5MCZUh4rvEDQUYM1r7xxuaB13bKW9x9GgM9zWUXgSmrs4?cluster=devnet) |
| 04:14:18 | curve: trader 2 bought 1368543 $HASH for 0.004 SOL (pool cost 37.85%) | [7KYynzji…](https://solscan.io/tx/7KYynzjipVeVn4NktBmyW6ew7kZqj2sHHEEULVYKZhDNDVq3uViSt73SwbkW7encATJjLUXh62w6obZGwyY4q9H?cluster=devnet) |
| 04:14:23 | curve: trader 2 sold 459520 $HASH | [4cwbdtUF…](https://solscan.io/tx/4cwbdtUFosaTmSK1Cz6xGsYuZYp6TYvyHt6iFTcxAMJc2RAHqvdcEJjSsGJwDSAQvs3ymRkWscy5h63jnjLsXvNh?cluster=devnet) |
| 04:15:05 | fee claim (curve) | [3mL94Xm8…](https://solscan.io/tx/3mL94Xm8VseMpVZgPiYNqX2mqER6CNq2gwDB699bpZvAmq5UMk6caVtD1hFiNTGnv814A7rhpda7RCmSoJCvKE9j?cluster=devnet) |
| 04:15:23 | curve: trader 0 bought 677519 $HASH for 0.002 SOL (pool cost 17.93%) | [3m3okBuG…](https://solscan.io/tx/3m3okBuGxYaSExrHjQoSbVXSsU45s9bvB36dxHTFGBZVx5x6vHX19wtqtX2T6evP2DkMgyHqGsgESQNUbeJ7enRw?cluster=devnet) |
| 04:15:24 | curve: trader 1 bought 934394 $HASH for 0.003 SOL (pool cost 24.54%) | [2ccZoWY7…](https://solscan.io/tx/2ccZoWY71KhnJzwoxfiHMv8vF6RrbBYEkTs73rvjSegocaGkG1q1qSN868HYRHwj5sf7LsSdCJq5bXfV17Lg5ewa?cluster=devnet) |
| 04:15:32 | curve: trader 2 bought 1108781 $HASH for 0.004 SOL (pool cost 32.84%) | [4oGJMwoN…](https://solscan.io/tx/4oGJMwoNWdBeXzC4nK4NfMVmZrLoCwGiVy7HrsiuueGotguQuRDuyckU6g4UWM1Ba68GsMmrmhPudjuqzbKHcJ9a?cluster=devnet) |
| 04:15:34 | curve: trader 2 sold 677224 $HASH | [2TP6EbZW…](https://solscan.io/tx/2TP6EbZWH4BzoBYe2d3pFCixfbmmCe3R4jUQZ9Qnj6LmuZAdNTZNcUYtvG9Ey2RDkw5CHxqmGPoJAW12p9X2Bpt6?cluster=devnet) |
| 04:18:13 | fee claim (curve) | [32grkxj6…](https://solscan.io/tx/32grkxj6UfaeqHtWwP5hhQDLy4BM6uphHBqfGLB83osYuKtu3sQv4SmTaYSkCbbDR7v3j5NbUKPEDZttkxwgKYsT?cluster=devnet) |
| 04:18:26 | loop round 2: market buy (curve) | [55qoWRCU…](https://solscan.io/tx/55qoWRCU4NHBp7xK8Dh1dr4i2f8HkPzZweZh2gG82CGCVYusbFDh3yH9vSmhFSr4u7Bh8tdHYYKHGE78GjMHKi9V?cluster=devnet) |
| 04:18:53 | curve: trader 0 bought 620052 $HASH for 0.002 SOL (pool cost 5.19%) | [2ujRphcz…](https://solscan.io/tx/2ujRphczoptdzCQH4ccnNMbftPSWpb9WJmpndKoNREbjiSw6PpyF9QJrjrNsBNAMKSkFsXRrJQuhN7BLT2i3XNZe?cluster=devnet) |
| 04:18:54 | curve: trader 1 bought 852667 $HASH for 0.003 SOL (pool cost 13.08%) | [3qbtjvFt…](https://solscan.io/tx/3qbtjvFtD3hDrFP7KghkuDub4WpbP5nTBweFWCAFZpshUMH8GCwNbhexB9gayWGHt8xWVrQf5fNYdLbJg86g6HAb?cluster=devnet) |
| 04:19:41 | curve: trader 0 bought 522766 $HASH for 0.002 SOL (pool cost 4.31%) | [2SQVHQxv…](https://solscan.io/tx/2SQVHQxv7JoiA5iB1roWcogFvVAAeYFteGzyc9zXbL2RkPYH8V2Vr8vat8gqfns77tBHpbtQXZnJ3ivWDPFLwnu6?cluster=devnet) |
| 04:19:42 | curve: trader 1 bought 721825 $HASH for 0.003 SOL (pool cost 11.91%) | [2sFYYsH6…](https://solscan.io/tx/2sFYYsH6oYPmYqHztghK6fNcDiGiDurtdbzQoYnHKBVcZrvVAoaRcyscME9hF7rw4Jdj1L1j4H6WQDQAds6mXpZR?cluster=devnet) |
| 04:21:23 | loop round 3: market buy (curve) | [5R4pAyJE…](https://solscan.io/tx/5R4pAyJEcs39fPkwqkKnDFYPFQB5u2j7ER1MyVVdUqxrKA88aoZYtXSh85cnLvCwtxmtyUTyR4bKiXC3vnXbrnwh?cluster=devnet) |
| 04:21:50 | curve: trader 0 bought 444147 $HASH for 0.002 SOL (pool cost 4.05%) | [262mCAd4…](https://solscan.io/tx/262mCAd4c5XAPu4coDr45cXhjRzV7ktuQZe2KoWSdFp82fwXYCwkf8zebYAs1pot9mVjrdX9hg7GdWn16Mu8DpvN?cluster=devnet) |
| 04:21:53 | curve: trader 2 bought 810950 $HASH for 0.004 SOL (pool cost 12.4%) | [4YR4UzfQ…](https://solscan.io/tx/4YR4UzfQdWEHhZA66JaLq7Y2LWReYc9yf5Z97EvPNdTYmxwK6qhxd65mUTnBZdT1MyZDN696FNwW2RnzfegszAct?cluster=devnet) |
| 04:22:04 | curve: trader 2 sold 737465 $HASH | [35cFNrJz…](https://solscan.io/tx/35cFNrJzyoxwwPu7naaptkBvADJXtM7vQdW9twnAJTP774LHSxXxf9oyb4TG8kqAo9G3dFv8Tgt8BKLPv2t7KAJU?cluster=devnet) |
| 04:24:23 | loop round 4: market buy (curve) | [5vhCdyyg…](https://solscan.io/tx/5vhCdyyg2QqKdU7RSKLp9EwWVixcCuy7AsMbA8gdxhW6g11CxDZDLG4AX2C1duk6eSMzDaybVKoXzrzWAcr5kGPK?cluster=devnet) |
| 04:27:28 | curve: trader 0 bought 409074 $HASH for 0.002 SOL (pool cost 3.93%) | [2LZyXGfE…](https://solscan.io/tx/2LZyXGfEuZBuc95Mnd5z8ic1uuZCV35WrwFzVnt6cXvHr1bgxNighjKSG5LvtG5ePDT39D5sFy6Y8DkqD6PiA3Hn?cluster=devnet) |
| 04:27:30 | curve: trader 2 bought 749582 $HASH for 0.004 SOL (pool cost 11.98%) | [5BDoGkTm…](https://solscan.io/tx/5BDoGkTmKhNCUjjWVVL5AbEbsw3roFSswX1nBq4gCudsLgs2zzz6Q8567pqjErdemxoGo39T5FSxYtM8FpWYaaQy?cluster=devnet) |
| 04:27:40 | curve: trader 2 sold 748371 $HASH | [5d7TCZyS…](https://solscan.io/tx/5d7TCZySHifScRKxjTgJLCTg6tyLyZU6MKHysH6BXeVCR3tLmmEdjURgevLw5TV9NCeXtZEvtYFa1dNzGabXpJ7P?cluster=devnet) |
| 04:30:11 | fee claim (curve) | [3BwjD7FC…](https://solscan.io/tx/3BwjD7FCRakjdwNtpPceAxkjR75zxrYcdKiZ5xdVNsV6PauizV1x5ftuckQ4LX2pdSRqWuS4HcEYmD7CHmfNaEEB?cluster=devnet) |
| 04:30:26 | loop round 5: market buy (curve) | [2LuGPDnh…](https://solscan.io/tx/2LuGPDnha8xQgUeif1A6HqR77kBtUfUyXq2tQfxdtuL5c4o3S2hLJqwYmbo2E7HTjqLJ7xXAeBYz6BYP1fHgJ9QL?cluster=devnet) |
| 04:33:14 | loop round 6: market buy (curve) | [3U8wPxze…](https://solscan.io/tx/3U8wPxzePidz3VAvVWZM6i1Q6EhqzU6t26xcqM73CPuxwmJEfmW47qzVShdPUtsxDHNeHxkDZtKok1V5gfK1EH7Z?cluster=devnet) |
| 04:36:14 | loop round 7: market buy (curve) | [5juEvpwx…](https://solscan.io/tx/5juEvpwxgMeRCD5eBGNcEwNqjRSzJh4nonmDzWzC6J2RLKpw1Vtquim8KTUwA87KxZHSNb3U6xJtKDFuDCG5Y84k?cluster=devnet) |
| 04:39:13 | loop round 8: harvest | [2qpDfUVt…](https://solscan.io/tx/2qpDfUVtQ26PKAC9WjKtBkWYfhkZR7vjxMabz8zDur1XbJv1obYazj3GyUqWFn6eqLF8zwgwMxsjZxY5JZeSruHy?cluster=devnet) |
| 04:39:14 | loop round 8: harvest | [5n9uHf5N…](https://solscan.io/tx/5n9uHf5NuGjdukPHniw8Zv8dFXdjfztodKXKKWZsQQ8Tob8VB5b4H6v2gYCnkCPZsAiwLvEhFUo6rivEdp87DmeP?cluster=devnet) |
| 04:39:15 | loop round 8: market buy (curve) | [29jfFHPW…](https://solscan.io/tx/29jfFHPW2MVqL318mFn2W1h52vvjg7S2xrkjChjqAb4P2H88Pdz8vDeqp1GWJLfW8zEU5zzL3pfdRLrxk9EjLJ2q?cluster=devnet) |
| 04:39:58 | loop round 9: market buy (curve) | [s8FzaPkb…](https://solscan.io/tx/s8FzaPkbEuVHJL4x2fGvCEToUmsYboV6p3p4kfsVdgrq1iyfC3wXnPvLAfEXKgfF8gMbUYixomQjMt2hMkWjL1Q?cluster=devnet) |
| 04:43:14 | loop round 10: market buy (curve) | [sBCByoSV…](https://solscan.io/tx/sBCByoSVTJYQekKNGJJ683NK6osKr4WjAUFFz7qeuGVg7Jr4fFwdHhwpgHqrPgbjVDohUwE2UX76toMnEQitHcz?cluster=devnet) |
| 04:43:42 | loop round 11: market buy (curve) | [3Qp69sbu…](https://solscan.io/tx/3Qp69sbuZMPmoDmZnRK5W42xoyYQ6UGrPHmyKtRguwzJc6AN4hvMhESjqarnWefF4NDkADuwiskj5xJ7quxdvVKY?cluster=devnet) |
| 04:46:55 | loop round 12: harvest | [qMxEwcWU…](https://solscan.io/tx/qMxEwcWUs2UukBAYTRmmmAzgm1YRwsQ13xr9f1gqSproTDaoNmKfi1RPe7ZZiFZinspszFCvDceRfWLAU1ke4uZ?cluster=devnet) |
| 04:46:56 | loop round 12: harvest | [4E8o2KJK…](https://solscan.io/tx/4E8o2KJKrw2fPbPR6eSEDxrae8uNYpXUGLyTMJL2Redz5wfwbhjpgS9d1Cw4LFfdXsUj6FF9YWLWZUJQ6SmNX37g?cluster=devnet) |
| 04:46:56 | loop round 12: market buy (curve) | [2rA799bf…](https://solscan.io/tx/2rA799bfRn27MR8eY7WztQ5Hhw7JmFYmjhtuFWftQHgjoZAqMcubqmDx5ukboE4Y3M288SNAXg8XREekfF59uKuS?cluster=devnet) |
| 04:47:54 | loop round 13: market buy (curve) | [5aqQqGjo…](https://solscan.io/tx/5aqQqGjopJCRJjFuyFPKx7guazy5NKVY5eGieqpiKd6g2pobax42AMuvyYNj2oDNpzH33LyxabsAfLh6nyezcBgZ?cluster=devnet) |
| 04:50:58 | loop round 14: harvest | [3bPgsdkw…](https://solscan.io/tx/3bPgsdkwr81WC2az7dx5698dfHyL5SDiHBYfAr2VKTmRoyj172X9kXArHz2q217wdwbakiyCbkkoXj51th6R97SY?cluster=devnet) |
| 04:50:59 | loop round 14: harvest | [59w61R94…](https://solscan.io/tx/59w61R94TPVkhrn5JFYyEf4r6weyri4dAQku2akqJWSkYVanjr2VmpmWPYkHQyL367FxQHJDTVjy6Gi8FU2pHrdp?cluster=devnet) |
| 04:51:00 | loop round 14: market buy (curve) | [1Hvr9YvT…](https://solscan.io/tx/1Hvr9YvTaqYgE1J9VpxtpdUXVYvFkGCkVced9QUfZ1oNe8BiTQ1PfF7MDDDhBX7uPHgYuyMzXzkKiyde5u3nKiE?cluster=devnet) |
| 04:51:27 | loop round 15: market buy (curve) | [M2Hhqx19…](https://solscan.io/tx/M2Hhqx19pEQyXRxXENsnUzLv3bhwdWJ25npY3Y27Lp4rTzUcWF3com7sNiWGuxysqKYYXeVbeUbTm2skdxbokNA?cluster=devnet) |
| 04:52:31 | graduation buy: trader 0 fills the curve (up to 0.055292243 SOL, partial fill) | [MvHcrP4K…](https://solscan.io/tx/MvHcrP4KxwuzZXp4f9vTxtcbDgeczva4HszecrStSaFzHt2DgZoxTd2EmrVvppXqi6DBBsb2bmbgsd2hNgZ2XTc?cluster=devnet) |
| 04:54:32 | fee claim (curve) | [2zSJG2cS…](https://solscan.io/tx/2zSJG2cS5RpuX5dsuFnrqAaFr9QmFTTMKpnKYr8JcEq4w97BD69xkhQQ1Y7Jtns4HrBxwz5jaBUvNXNPi5ZciDhu?cluster=devnet) |
| 04:54:57 | migration to DAMM v2 | [4dejfaK8…](https://solscan.io/tx/4dejfaK8qKeGTG6zv318ZsxXCsCpRTrKwQ1uMRjNVubeJrAaZF2NpFW3fqxpyMj7kziGyAkTxFhBj7pxgxEqKkNF?cluster=devnet) |
| 04:55:10 | damm: trader 0 bought 121188 $HASH for 0.002 SOL (pool cost 2.81%) | [2U67myrA…](https://solscan.io/tx/2U67myrANx5y8BEaAAv5CXMEHiKTabmnUwhiwx9YeGFqXcuQiM53pghtNVhVCcNEFc3VzLxi8WmoRDzZs2Djm5dJ?cluster=devnet) |
| 04:55:12 | damm: trader 2 bought 224650 $HASH for 0.004 SOL (pool cost 9.91%) | [bPWks6nb…](https://solscan.io/tx/bPWks6nbTzSS7FQwWyVYA934t3FcKvPAYqUH5CZSvv3vAy4SRL1tNDzGD7jkhfxpp3K637t5o4S6CNwBj1cUYpQ?cluster=devnet) |
| 04:55:15 | damm: trader 2 sold 581763 $HASH | [dex9yLyP…](https://solscan.io/tx/dex9yLyPwfGNgCNVc6CjDX45q1ipNamBLrZC279S1UseDLD5pC1FKziXMiYSsSoxV7zt43fivxoq3mYeKmaFKHV?cluster=devnet) |
| 04:57:37 | loop: tax rate → 2.25% by the formula | [4nyGKgdF…](https://solscan.io/tx/4nyGKgdFwmhYtjKk8Vng2oWb3H5bSqG3LxQPjn1dLFwbXVan3xqxje9atZnLipP8PSAk73KmXZPNFVBiCHLVn1JA?cluster=devnet) |
| 04:57:46 | loop round 17: market buy (damm) | [3e6fUw7N…](https://solscan.io/tx/3e6fUw7NxcqLD52kd3gwx2k6dAZoAVyZY13Ro46aJLyq8CaMdMx33f5Zra9J7ajEmogT8QZyUctpmzTMhVbka7YH?cluster=devnet) |
| 04:58:09 | payout wallet schedules the tax at 5% (rehearsal reset) | [2Ptwho7M…](https://solscan.io/tx/2Ptwho7MEpbRmSeUZfvFVNZdnc5MdUbNuCcpt3UrLbixQxkTqTiuVgBcZeTZLjyh5aMcYtRHEGStXHmq9cqMjbWX?cluster=devnet) |
| 04:58:20 | ctl handover-rate-authority → multisig stand-in | [2FUWuXvS…](https://solscan.io/tx/2FUWuXvSe9S1bVXDbc9UYKun6w5j7BhmuJJxFpQoKeMcrHwTDaqyN3kaBpM6pLVrE2DQQih8h29hATgCn4EPgtmB?cluster=devnet) |
| 04:59:00 | fee claim (pool) | [2NaoPtTv…](https://solscan.io/tx/2NaoPtTv4cn5cfoDwjZhxuYVF1Cvckg5j36j9dmDUNygNEAeVwDza1g2GFD5fvRcPhki8iXgiu1ta9ogqsCabRbu?cluster=devnet) |
| 04:59:13 | loop round 18: market buy (damm) | [5vm2EjaP…](https://solscan.io/tx/5vm2EjaPH5HTmhLVtpsG5Rfd5f35Pj6aVGk88CELWfeZDxecgLvtiaGK2vVHGoxZ4vuEPj5avwzphswVt5br8yQ7?cluster=devnet) |
| 05:02:28 | loop round 19: market buy (damm) | [XeZs7BCy…](https://solscan.io/tx/XeZs7BCyczTt5L6YWGno5AanUKJ7iX3PWsfbeqYVW1V5ZjHA3n2BefZxwJVrcuukk61i9yjXyjH9wL4XrAetReS?cluster=devnet) |
| 05:02:45 | multisig stand-in executes the proposal: Set the $HASH tax to 2.25% (Token-2022 SetTransferFee on CR81N6TeKVY29bKcETKkQCNQSawbBYALw8BsNPadQHiy; takes effect two epochs after it lands) | [4grj7nVw…](https://solscan.io/tx/4grj7nVwJdp9wsJiwmev4NQkzL9noLuJWpUoas45BA2aUu8jKzmobBCxfThbevWk2Nzu6jHTzX2Fq9DwHb2TRJhG?cluster=devnet) |
| 05:04:20 | damm: trader 2 bought 254086 $HASH for 0.004 SOL (pool cost 5.41%) | [5qPA8KiJ…](https://solscan.io/tx/5qPA8KiJ6tZHYMcUZn2JeBSwZxdoLtYe8vEBPtDvK8PDQ4kr5TjDUKNGSViLpjfys9ocCbhFEDbG7ZnMCknBq9wi?cluster=devnet) |
| 05:04:23 | damm: trader 2 sold 476447 $HASH | [5pho8aYN…](https://solscan.io/tx/5pho8aYNweuD8dN57YPojjbQBK2Xf3HpRDgf42XsfnbzK5MAdMXjVGbRS6sYMa46cRSuwsc3ck43ToCsXXTdv5mz?cluster=devnet) |
| 05:05:16 | fee claim (pool) | [4y1KTkau…](https://solscan.io/tx/4y1KTkau9AXADwncTHNjKAgVBghiE3xzDdC4KMUutdfnH7uYrheQwhn2JzkGpX6yvUdXEkjV8N1XqybGHVHVzpMx?cluster=devnet) |
| 05:05:29 | loop round 20: market buy (damm) | [5b4xaj32…](https://solscan.io/tx/5b4xaj32gNbhfcGRXpwT4fv2MdPatPw5mN7tpW1wfY81oPaA23B9Xo49c3p2Q2Hwj3yEqS4YGzA17s31pvfp6uRP?cluster=devnet) |
| 05:08:20 | loop round 21: market buy (damm) | [8a9NFywQ…](https://solscan.io/tx/8a9NFywQUwCW8Ed9he4WD2YuYhEZLvVPGPQDN7BDAP8NzdEh6frVYYjS1k5xebVMUePw8hAWYfLv1JJ81HTsdgw?cluster=devnet) |
| 05:10:25 | loop round 22: market buy (damm) | [4kp7MbZN…](https://solscan.io/tx/4kp7MbZN2xcYo9GhYiC9TGPuTb8qAQHbQVNKA6Aq8t8wkzLg9EpGDbePGZ361CswC3qNCnUhBeYCWZ2k4ay4Xqxs?cluster=devnet) |
