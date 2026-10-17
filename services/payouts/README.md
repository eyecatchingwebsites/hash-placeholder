# Payout loop (`services/payouts`)

Runs the money side of $HASH, round after round:

1. **Collector** (every few minutes): pool stats → mining hours and mined USD per wallet, trued up to what the pool actually credited (`services/collector`).
2. **Market**: which phase the token is in (Meteora DBC curve → graduating → DAMM v2 pool), its price (pool price × SOL/USD from Jupiter, CoinGecko as fallback).
3. **Funding**: claims our curve trading fee (SOL, `claimPartnerTradingFee`) into the payout wallet, and after graduation the pool fee our locked DAMM v2 position earns (0.25% at launch settings, SOL). That SOL (the "float") pays for miners' $HASH.
4. **Index** every mint transaction (balances, hold clocks, outside trading volume) and **harvest** the tax.
5. **Rate** by the public 2–5% formula: fixed while on the curve; after graduation set by the payout wallet, or written as a proposal for the multisig once it holds the authority.
6. **Split** the tax (dev / miner bonus / holders) and run the miner epoch: miners get what the float can buy now (the rest is held back as pending until the mined coin is sold).
7. **Buy** the miners' $HASH on the market with SOL: DBC swap before graduation, DAMM v2 swap after, with a slippage floor and a cost limit. The SOL spent is grossed up for the transfer fee, and payouts are grossed up again, so miners receive the full amount (the withheld fees come back to the treasury at the next harvest).
8. **Pay** miners, holders and dev, write the public record (`data/public.json`, served by `services/api`), raise alerts.

Every round is written to the ledger as "owed" before the first transfer and cleared transfer by transfer, so a crash leaves the unpaid part owed (with its tokens) instead of losing it. Each payout transaction is also recorded (signature, last valid block height) before it's sent; after a crash, a stop or a confirmation timeout, the next round looks it up on chain first: landed → recorded as paid, failed or expired → paid again, pending → wait (`src/inflight.ts`). So nothing is paid twice. What a market buy returned is read from the buy transaction itself. Harvested tax is saved straight after the harvest.

## Run

```sh
npx tsx services/payouts/src/main.ts             # run until stopped
npx tsx services/payouts/src/main.ts --once      # one collect + one round
npx tsx services/payouts/src/main.ts --dry-run   # compute a round from live data; sends nothing, saves nothing
npx tsx services/payouts/src/ctl.ts status       # kill switch, ledger, funding, market phase, authorities
npx tsx services/payouts/src/ctl.ts test-alert   # check HASH_ALERT_WEBHOOK
```

On launch day the same with the settings from `%USERPROFILE%\.hashcoin\payouts.env`: `powershell -ExecutionPolicy Bypass -File services\payouts\scripts\payouts.ps1 [--dry-run | ctl ...]` (`docs/LAUNCH-RUNBOOK.md`).

Settings: `config/payouts.json` (devnet rehearsal without a market), `config/payouts.mainnet.example.json` (mainnet), plus the environment:

| Variable | What |
|---|---|
| `HASH_PAYOUTS_CONFIG` | config file to use |
| `HASH_RPC_URL` | RPC endpoint; required on mainnet (Helius), the public one is refused there |
| `HASH_KEYPAIR` | payout wallet keypair file (`solana-keygen` JSON), **outside the repo** on mainnet |
| `HASH_DEV_WALLET` | dev share address |
| `HASH_MULTISIG` | Squads vault address: rate changes become proposals once it holds the rate authority |
| `HASH_ALERT_WEBHOOK` | Discord or Slack incoming-webhook URL for alerts |
| `HASH_DATA_DIR` | ledger, records, alerts, KILL file (default `services/payouts/data`) |
| `HASH_KILL=1` | kill switch from the environment |
| `HASH_MAINNET=yes` | required with `"network": "mainnet"` |
| `HASH_PUBLIC_RECORD` | (for `services/api`) path of `public.json` when `HASH_DATA_DIR` is moved |
| `HASH_COLLECTOR_DATA`, `HASH_WORKER_REGISTRY` | collector state dir, worker → wallet map |
| `HASH_PAYOUT_ADDRESS_PRL` | (for the API and collector) the platform's PRL address on the pool |

## Launch settings that matter here (`packages/chain/src/launch.ts`)

- **Launch with `--partner <payout wallet address>`** (the public key of `HASH_KEYPAIR`). The partner is the curve's fee claimer, the tax withdraw authority and, after graduation, the rate authority. If it's the multisig instead, the loop can't harvest the tax or claim fees: every round stops with a `wrong-authority` alert. Move only the rate authority to the multisig after graduation (`ctl handover-rate-authority`).
- **The curve fee starts at 20% and falls to 1% over the first 5 minutes.** Miners' buys in those minutes cost more than `buy.maxCostBps` (4%), so they wait (owed, a `buy-cost` alert) and go through once the fee is down. The 20% fee itself flows to us and funds the float.

## Safety

- **Kill switch**: `npx tsx services/payouts/src/ctl.ts kill "why"` (or `HASH_KILL=1`) blocks every transaction the loop sends: payouts, buys, harvests, fee claims, rate changes. It is enforced on the RPC connection itself, so it also stops a round already running. `ctl resume` releases it. (`data/PAUSE` is the softer pause: rounds skip.)
- **Dry run**: `--dry-run` reads everything live, quotes the buy, and writes the round it would have run to `data/dry-run/`; the same connection guard refuses any send.
- **Limits**: `maxPayoutUsdPerRound` (over it, the round pauses), `buy.maxUsdPerRound`, `buy.maxCostBps` (pool fee + price impact), `buy.slippageBps`, `funding.reserveSol` (never spent on buys).
- **Alerts** (console, `data/alerts.log`, webhook; each repeats at most every `alerts.repeatMinutes`): round failed, RPC errors (`rpcErrorsPer10Min`), no tax from trading for `emptyHarvestRounds` rounds, float low (`floatLowUsd`, or the wallet below `minTreasurySol`), buy failed or refused, payout transaction failed, payout wallet short of $HASH, kill switch on, market phase change (graduation), curve fee claim failed, collector failing, true-up out of bounds, rate proposal waiting for the multisig.

## Held-back mining and coin sales

Mining the float can't buy now is held back (pending). On mainnet it is paid from coin sales: sell the mined PRL, put the SOL in the payout wallet, then

```sh
npx tsx services/payouts/src/ctl.ts sold PRL <coins sold> --sol <SOL received> [note]
```

The loop pays held-back mining oldest first from those proceeds, at the price the coin actually sold for versus the collector's estimate.

## Devnet rehearsal on a real Meteora market

```sh
npx tsx services/payouts/scripts/devnet-meteora.ts setup        # throwaway keys + devnet SOL (faucet, or FUNDER_KEYPAIR)
npx tsx services/payouts/scripts/devnet-meteora.ts launch       # DBC config + pool like meteora-devnet.ts; writes data/devnet-meteora/payouts.json
npx tsx services/payouts/scripts/devnet-meteora.ts trade 2      # traders buy and sell on the current pool
# run the loop with: HASH_PAYOUTS_CONFIG=services/payouts/data/devnet-meteora/payouts.json HASH_DATA_DIR=services/payouts/data/devnet-meteora/loop
#                    HASH_KEYPAIR=services/payouts/data/devnet-meteora/payout.json HASH_DEV_WALLET=<printed by launch>
npx tsx services/payouts/scripts/devnet-meteora.ts graduate buyout   # fill the curve (the loop sees "graduating")
npx tsx services/payouts/scripts/devnet-meteora.ts graduate          # migrate to DAMM v2
```

## Launch dress rehearsal (everything together)

`scripts/launch-rehearsal.ts` drives the outside world for a launch-day rehearsal on devnet: keys and data in `packages/chain/data/rehearsal/`, the real `packages/chain/scripts/launch-mainnet.ts --cluster devnet`, traders, graduation, a local webhook, the miner's check-in on a local API. Commands: `keys | fund <keypair>... | config | webhook | register <api> | trade [n] | graduate [buyout] | reset-rate <bps> | execute <proposal> | balances`. Oct 17 run and results: `docs/LAUNCH-REHEARSAL.md`.
