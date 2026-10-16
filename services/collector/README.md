# Collector (`services/collector`)

Every few minutes, reads the pool's per-worker stats and turns them into **mining hours** (for M2/M3) and **mined value** per wallet: the input for the payout engine (`packages/engine`).

```sh
npx tsx services/collector/src/main.ts --once   # one run
npx tsx services/collector/src/main.ts          # every `everyMinutes` (config/collector.json)
```

How it works:
- Reads every worker under the platform's payout address from Kryptex's public API (`src/kryptex.ts`, no key).
- Maps each worker (`h<10 chars>-<gpu>`) back to a wallet through the API's record of assignments (`services/api/data/workers.json`). Workers it can't map are listed as `unknownWorkers`.
- Corrects Kryptex's averages for new sessions: they count the time before the session as zero, so a worker 8 minutes in shows a quarter of its real rate.
- Credits mining hours per run: full when the GPU runs at 80%+ of its expected rate, judged on its 3-hour average; less in proportion below. Expected = the card's own best 3-hour average this week, or the hashrate.no benchmark for its model if higher. A wallet gets its best GPU's minutes, not the sum. One run credits at most 15 minutes, so an outage doesn't hand out hours.
- Values mining at PPS+ rates: block reward ÷ (network hashrate × block time) × (1 − pool fee), at the pool's latest price.
- Flags a card running more than 1.5× its claimed model's benchmark.
- **Trues estimates up to the pool (Oct 16):** each run reads the pool's running total for the payout address (balance + every payout, `fetchEarned`). Each time it moves, what it credited is set against what the collector estimated for every worker under the address (unregistered ones included) since the last move. The ratio over the last 24 hours (bounded to 0.5–1.5×; outside that it's flagged) scales the mined value credited to wallets (`minedUsd`; the raw estimate stays in `estimatedUsd`). With too little data (under 0.05 coins estimated) the ratio is 1. Settings: `trueUp` in `config/collector.json` (`src/trueup.ts`, defaults there). First live reading Oct 16: 18.62 PRL credited to the test address so far.
- The payout address per coin comes from `HASH_PAYOUT_ADDRESS_<COIN>` (same as the API); `HASH_COLLECTOR_DATA` moves `data/`.

State and the latest report go to `data/` (gitignored). A file for now; Postgres later (`docs/TECHNICAL-PLAN.md`, Phase 3).

Not yet: Quantus (needs a payout address). The payout loop (`services/payouts`) runs the collector in-process and feeds it into `runEpoch`.
