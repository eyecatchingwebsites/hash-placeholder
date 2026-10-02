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
 │ engine      every 10 min: levels → weights → epoch payout (packages/engine)│
 │ treasury    buys $HASH (Jupiter), keeps the float, sends batch transfers │
 │ settler     when mined coin confirms + sells → true-up pending balances  │
 │ switcher    scores coins every few hours, flips the pool target          │
 │ api         public read API for website + dashboard                      │
 └──────────────────────────────────────────────────────────────────────────┘
          │ Postgres (ledger: epochs, lines, pending, settlements, transfers)
          ▼
 Website (hashcoin.com): landing, calculator, live dashboard, "my wallet" page
```

## Payout cycle (every 10 minutes)
1. **Collector:** sums each wallet's accepted shares × revenue per share = `earnings` (USD).
2. **Chain-watch:** gives the current `WalletState` per wallet (balance, `firstHashAt`, `everSold`) and the 1h average price.
3. **Engine** (`runEpoch`): computes levels, sqrt × level weights, the 5% cap and water-filling, then the immediate 75% of mining (scaled to the float), the pending 25%, the chest split, and the carry.
4. **Treasury:** buys $HASH for `payNowUsd`, then `splitTokens` produces the transfers. Dust is deferred. Transfers are sent in batches of about 20 per transaction.
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
| `packages/engine` | Pure payout logic: levels, weights, epoch, settlement, token split | **done, tested** |
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
