# Hashcoin Architecture

Status: draft. Chain assumed to be **Solana** (Solscan links, ~13s finality, cheap batch transfers).

## Components

```
 GPU (open-source miner) ──shares──▶ Mining pool (existing, per-worker stats; worker = user wallet)
                                          │ pool API (hashrate, accepted shares per worker)
                                          ▼
 ┌──────────────────────────── Hashcoin backend ────────────────────────────┐
 │ collector   polls pool API every minute → earnings estimates per wallet  │
 │ chain-watch indexes $HASH transfers → balances, first-$HASH time, sold   │
 │ fee-watch   tracks creator-fee inflows → chest / burn / creator buckets  │
 │ engine      every 10 min: tax split → levels → weights → epoch payout      │
 │ treasury    buys $HASH (Jupiter), keeps the float, sends batch transfers │
 │ settler     when mined coin confirms + sells → true-up pending balances  │
 │ switcher    per-card coin choice on each app check-in (signed, 5 min)    │
 │ api         public read API for website + dashboard                      │
 └──────────────────────────────────────────────────────────────────────────┘
          │ Postgres (ledger: epochs, lines, pending, settlements, transfers)
          ▼
 Website (hashcoin.com): landing, calculator, live dashboard, "my wallet" page
```

## Payout cycle (every 10 minutes)
1. **Collector:** sums each wallet's accepted shares × revenue per share = `earnings` (USD).
2. **Chain-watch:** gives the current `WalletState` per wallet (balance and hold clock `clockStartAt`, which starts at the H1 bag and which selling shrinks in proportion) and the level price (`levelPriceUsd`: the higher of the 1h and 7-day averages).
3. **Engine:** `splitTax` divides the epoch's 5% tax into dev (0.5%), miner chest (what reaches 5× mining, max 3.5%) and holder pot (the rest, min 1%). `runEpoch` computes holder and miner levels, √ × miner-level weights, the 5% cap and water-filling, then the immediate 75% of mining (scaled to the float), the pending 25%, the chest split and the carry. `runHolderPayout` splits the holder pot by bag × holder level (hourly or daily).
4. **Treasury:** buys $HASH on the market only for the mining part (`totals.buyUsd`); the chest and holder pot are paid from the harvested tax, which is already $HASH. Then `splitTokens` produces the transfers. Dust is deferred. Transfers are sent in batches of about 20 per transaction.
5. **Ledger:** writes everything. The dashboard shows Paid / Pending.
6. **Settler** (hours later): when the epoch's mined coin is confirmed and sold, `settle` trues up the pending balances to actual proceeds. The platform absorbs any overpayment.

## Trust rules
- Credit by shares (validated by the pool). Never by user claims.
- Count deposits and stake balances only at Solana `finalized`.
- Top up the float only from confirmed sales.
- Any outflow from a wallet is a sale (`applyBalanceChange`).
- Keys: treasury and payout keys live only in the deploy environment's secrets, never in the repo or in chat. Payout wallets hold only the float, and the treasury sits in a multisig.
- Watch for block withholding: compare expected vs actual blocks per pool, and flag wallets with many shares but zero blocks.

## Repo layout (planned)
| Path | What | Status |
|---|---|---|
| `packages/engine` | Pure payout logic: tax split, holder and miner levels, weights, epoch, holder payout, settlement, token split | **done, tested** |
| `packages/switcher` | Per-card coin scoring, hysteresis, signed assignments | **done, tested** |
| `services/api` | Assignment API + signed miner list | **done, tested** (placeholder pools/miners) |
| `apps/desktop` | Windows miner app (Rust core + Tauri 2) | **core tested, e2e passing**, not yet run on Windows |
| `packages/chain` | Solana helpers: transfer indexer, batch sender, Jupiter swap | next |
| `services/backend` | Collector, scheduler, treasury, settler, API (Node + Postgres) | next |
| `apps/web` | hashcoin.com: landing, calculator, dashboard, wallet page | next |
| `sim/` | Python economic simulation | done |
| `calculator/` | Standalone calculator prototype (moves into `apps/web`) | done |

## Build order
1. Engine (done).
2. A mock pool feed and devnet token, so the full cycle runs end to end on devnet with fake miners.
3. The website: landing, dashboard and wallet page reading the API.
4. Real pool integration and one real GPU (you), for the unedited install → payout video.
5. Fee implementation on the chosen launchpad, mainnet keys, audit/review, then launch.

## Open questions
- Launchpad and how the 5% fee is collected (custom Token-2022 transfer fee vs launchpad creator fee).
- Which pool(s) support the target coins with per-worker APIs.
- Hosting: Vercel for the web and a small always-on server for the backend loop.
