# Launch runbook ($HASH, ~October 24, 2026)

One step at a time, top to bottom. Every command was run in the devnet dress rehearsal on Oct 17 (`docs/LAUNCH-REHEARSAL.md`). Website and API hosting: `docs/HOSTING.md`.

- Commands run in **PowerShell**, from `C:\Users\LukeW\dev\hash-placeholder`.
- Keys and secrets live in **`C:\Users\LukeW\.hashcoin\`**. Never in the repo, never in chat, never in a screenshot.
- `P` below means: `powershell -ExecutionPolicy Bypass -File services\payouts\scripts\payouts.ps1`

---

## T-48h: decide and set up

**1. Get the code on the launch branch.**
- [ ] Merge `claude/launch-rehearsal` and `claude/launch-hosting` into `claude/vibrant-cray-fpbieb` (or ask a Claude session to).
- [ ] In `C:\Users\LukeW\dev\hash-placeholder`: `git checkout claude/vibrant-cray-fpbieb`, `git pull`, `npm install`, `npm test`. All pass.

**2. Accounts.**
- [ ] Helius: create an API key. Your RPC URL is `https://mainnet.helius-rpc.com/?api-key=<key>`.
- [ ] Squads (squads.so): create the multisig. Copy its **vault** address.
- [ ] Discord: Server settings → Integrations → Webhooks → New webhook → Copy URL. This is where alerts go.

**3. Three new wallets** (each prints its address; write the addresses down):
```
npx tsx packages/chain/scripts/keygen.ts C:\Users\LukeW\.hashcoin\launcher.json
npx tsx packages/chain/scripts/keygen.ts C:\Users\LukeW\.hashcoin\dev.json
npx tsx packages/chain/scripts/keygen.ts C:\Users\LukeW\.hashcoin\payout.json
```
- **launcher**: pays rent, creates the pool.
- **dev**: the public dev wallet (buys the 1% bag).
- **payout**: the partner. It collects the tax, claims our fees, buys and pays. The payout loop runs with it.
- [ ] Copy the three files to a USB stick and keep it offline. Whoever has a file controls that wallet.

**4. Pick the graduation target** (by T-24h), from how the X campaign is going. Aim for a curve that fills within the first day.

| X response | Target | Start market cap | At graduation | Dev buy |
|---|---|---|---|---|
| Quiet | **40 SOL** | 17.8 SOL | 160 SOL | 0.19 SOL |
| Decent | **50 SOL** | 22.2 SOL | 200 SOL | 0.24 SOL |
| Strong | **85 SOL** | 37.8 SOL | 340 SOL | 0.41 SOL |

---

## T-24h: fund and check

**5. Fund the wallets** (from your exchange or wallet, to the addresses from step 3):

| Wallet | Send | Why |
|---|---|---|
| launcher | **0.1 SOL** | Rent and fees (about 0.02 is used; the script wants 0.08) |
| dev | **0.25 / 0.30 / 0.47 SOL** (target 40 / 50 / 85) | The 1% bag plus fees and its token account |
| payout | **0.3 SOL** | Fees and about 0.002 SOL per new wallet it pays. It keeps 0.1 back and never spends that on buys. Our curve fee adds SOL from the first minutes |

**6. The loop's config.** Copy `services\payouts\config\payouts.mainnet.example.json` to `C:\Users\LukeW\.hashcoin\payouts.json`. Leave `market` as it is for now (step 15 fills it).

**7. The loop's settings file**, `C:\Users\LukeW\.hashcoin\payouts.env` (Notepad, one per line):
```
HASH_MAINNET=yes
HASH_NETWORK=mainnet
HASH_PAYOUTS_CONFIG=C:\Users\LukeW\.hashcoin\payouts.json
HASH_KEYPAIR=C:\Users\LukeW\.hashcoin\payout.json
HASH_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<key>
HASH_DEV_WALLET=<dev address>
HASH_MULTISIG=<Squads vault address>
HASH_ALERT_WEBHOOK=<Discord webhook URL>
HASH_PAYOUT_ADDRESS_PRL=<the platform's PRL address on Kryptex>
HASH_DATA_DIR=C:\Users\LukeW\.hashcoin\payouts-data
HASH_COLLECTOR_DATA=C:\Users\LukeW\.hashcoin\collector-data
```
The two data folders must be new: the old ones in the repo hold devnet tests (the loop would refuse their ledger, and the collector's old baseline would skew mining credit).
- [ ] Add one line to the API's `C:\Users\LukeW\.hashcoin\api.env` (HOSTING.md step 2) so the app shows payouts: `HASH_PUBLIC_RECORD=C:\Users\LukeW\.hashcoin\payouts-data\public.json`

**8. Test the alerts.** `P ctl test-alert` → the message shows up in Discord within seconds.

**9. Launch dry run** (sends nothing):
```
$env:SOLANA_RPC = "https://mainnet.helius-rpc.com/?api-key=<key>"
npx tsx packages/chain/scripts/launch-mainnet.ts --cluster mainnet --graduation-sol 50 --launcher C:\Users\LukeW\.hashcoin\launcher.json --dev C:\Users\LukeW\.hashcoin\dev.json --partner <payout address> --name Hashcoin --symbol HASH --uri https://hashcoin.app/token/hash.json --dry-run
```
- [ ] Use your target from step 4 in `--graduation-sol`.
- [ ] Check the printout: the partner is the **payout** address, the launcher and dev show the SOL you sent, and it ends with `create config: ok`. ("pool + dev buy can't be simulated" is expected.)

**10. The rest of the setup.**
- [ ] `https://hashcoin.app/token/hash.json` opens and has the X link.
- [ ] `infra\pc\check-api.ps1` ends with "All good" (HOSTING.md).
- [ ] The PC won't sleep or restart for updates (HOSTING.md step 3).

---

## T-2h

**11.** Balances still right (Solscan, the three addresses). Discord open on your phone.
**12.** Open three PowerShell windows in `C:\Users\LukeW\dev\hash-placeholder`: **Launch**, **Loop**, **Control**.
**13.** Close anything left from devnet tests (an old payout loop or API window).

---

## T-0: launch

**14. Launch** (Launch window). The same command as step 9, with `--confirm-mainnet` instead of `--dry-run`:
```
npx tsx packages/chain/scripts/launch-mainnet.ts --cluster mainnet --graduation-sol 50 --launcher C:\Users\LukeW\.hashcoin\launcher.json --dev C:\Users\LukeW\.hashcoin\dev.json --partner <payout address> --name Hashcoin --symbol HASH --uri https://hashcoin.app/token/hash.json --confirm-mainnet
```
- [ ] Wait for `3. checks PASSED` and `CONTRACT ADDRESS: <address>`. It takes about 5 seconds.
- [ ] Copy the contract address. Also note the `1. config <address>` line.
- [ ] Anything else (an error, `checks FAILED`, no output): **stop**, go to "If the launch fails halfway" below. Post nothing.

**15. Contract address on the site, first.**
- [ ] In `apps\web\assets\js\config.js` set `ca: "<contract address>"`.
- [ ] `git add apps/web/assets/js/config.js`, `git commit -m "Contract address"`, `git push`.
- [ ] After about a minute, open `https://hashcoin.app`. The address shown matches (check the first and last 4 characters).
- [ ] **Then** post it on X and Discord, linking the site.

**16. Payout loop** (Loop window).
- [ ] In `C:\Users\LukeW\.hashcoin\payouts.json` set `"market": { "mint": "<contract address>", "dbcConfig": "<config address from step 14>" }`. Both are also in `packages\chain\data\launch-mainnet.json`.
- [ ] Dry run: `P --dry-run`. Check: `phase curve`, a price, `would claim ... SOL of curve trading fee`, no `wrong-authority`.
- [ ] Live: `P`. Leave this window open. A round runs every 10 minutes.

---

## The first hour

- **Minutes 0–5: `buy-cost` alerts are normal.** The curve fee starts at 20% against snipers, so miners' buys wait (owed) until it's below the 4% limit. They go through by themselves once the fee is down (minute ~5).
- After that each round: claims our curve fee, harvests the tax, buys miners' $HASH, pays miners, holders (hourly) and dev. Each round ends with a `round N:` line.
- [ ] Every 15 minutes: `P ctl status` (Control window). Look for: kill switch off, `0 owed` or a small number, the payout wallet's SOL, `market: curve`.
- [ ] `https://api.hashcoin.app/v1/stats` shows the rounds.
- [ ] Solscan → the payout address: payouts and buys appear.

## Graduation (when the curve fills)

1. Alert `phase-graduating`: buys wait while the pool migrates (owed, nothing lost). The migration is permissionless and Meteora's keeper normally runs it. If it still says graduating after 30 minutes, ask a Claude session to run it (on devnet: `launch-rehearsal.ts graduate`).
2. Alert `phase-damm`: trading is on the DAMM v2 pool. The loop buys there and claims our 0.25% pool fee.
3. On the first round after graduation the loop may schedule a new tax rate by the formula (it said 2.25% in the rehearsal). It takes effect about 4 days later.
4. **Hand the rate authority to the multisig** (Control window):
   ```
   P ctl handover-rate-authority <Squads vault address> --yes
   ```
   `P ctl status` then shows `tax rate multisig, tax withdraw payout wallet`. That's right: the payout wallet keeps collecting the tax.
5. From now on, rate changes arrive as a `rate-proposal` alert with a file in `C:\Users\LukeW\.hashcoin\payouts-data\proposals\`. In Squads: new transaction with that one instruction (the vault signs), check the rate against the formula, approve, execute.

## The first day

- [ ] Every hour: `P ctl status`, Discord, a look at the Loop window.
- [ ] Back up `packages\chain\data\launch-mainnet.json` and `C:\Users\LukeW\.hashcoin\payouts-data\ledger.json` to the USB stick.
- [ ] Mined PRL that the float couldn't pay yet is "held back". Once Kryptex has paid out PRL and you've sold it for SOL into the payout wallet: `P ctl sold PRL <coins sold> --sol <SOL received>`. The loop pays held-back mining from it (it waits 10 hours after the mining first).

---

## Alerts: what they mean

| Alert | Means | Do |
|---|---|---|
| `buy-cost` | Pool fee + price impact over 4%; miners' buy waits | Nothing in the first 5 minutes. Later, if it keeps coming: the pool is thin, it retries each round |
| `phase-graduating`, `graduating` | The curve is full and migrating | Nothing; buys resume after migration |
| `phase-damm` | Trading is on DAMM v2 | Hand over the rate authority (Graduation step 4) |
| `rate-proposal-<bps>` | The formula wants a new rate; the multisig decides | Squads (Graduation step 5) |
| `float-low` (warning) | The SOL for buying miners' $HASH is low; new mining is held back | Fine while curve fees come in. If it stays: send SOL to the payout wallet |
| `float-low` (critical) | The payout wallet is under 0.05 SOL; **rounds stop** | Send SOL to the payout wallet now |
| `tokens-low` | The payout wallet holds less $HASH than the payouts need | `P ctl status`; if it repeats, kill switch and ask for help |
| `payout-failed` | A payout transaction failed; it's retried next round | Nothing, unless it repeats every round |
| `buy-failed` | A market buy failed; mining stays owed, retried next round | Same |
| `round-failed` | A whole round failed; the next one tries again | If it repeats: read the Loop window, then kill switch if unsure |
| `round-too-big` | A round wanted to pay more than $2,500; **paused** | Check the round in `payouts-data\rounds\`. If it's right, delete `payouts-data\PAUSE` |
| `wrong-authority` | The payout wallet isn't the tax withdraw authority; **nothing runs** | The launch used another `--partner`, or the loop has the wrong key. Check `HASH_KEYPAIR` |
| `harvest-empty` | No tax for 6 rounds | Normal if nobody trades; otherwise check the loop |
| `rpc-errors` | Helius is failing or rate-limiting | Check Helius' dashboard; the loop keeps retrying |
| `claim-failed` | Claiming our curve or pool fee failed | Retried next round |
| `collector`, `trueup-PRL` | Kryptex stats failing, or the pool paid very differently from our estimate | Check the Kryptex dashboard; payouts continue |
| `kill-switch` | The kill switch is on; nothing is sent | `P ctl resume` when you're ready |

## The kill switch

- **Stop every transaction now** (payouts, buys, harvests, fee claims, rate changes; it also stops a round already running):
  ```
  P ctl kill "why"
  ```
- Check: `P ctl status` says `kill switch engaged`. Rounds skip and alert.
- **Resume:** `P ctl resume`. Anything a stopped round didn't pay is owed and paid next round, once.
- Softer pause (rounds skip; a running round finishes): create the file `C:\Users\LukeW\.hashcoin\payouts-data\PAUSE`; delete it to resume.
- Closing the Loop window or Ctrl+C is safe too: on restart the loop checks on chain which payouts landed and never pays one twice.
- The kill switch also blocks `ctl handover-rate-authority`. Resume first.

## If the launch fails halfway

The script saves each step to `packages\chain\data\launch-mainnet.json`. **Never delete that file. Re-run the exact same command** (same `--graduation-sol`): it continues where it stopped.

| What you saw | What happened | Do |
|---|---|---|
| An error before any `create config:` link | Nothing on chain | Fix it (often SOL or the RPC), re-run |
| A `create config:` link, then an error | The config exists, no pool yet | Fund the dev wallet if it says so, re-run. It prints `config ... (already created)` and makes the pool |
| `2. launch <address>`, then an error or silence | Unknown: the pool may have landed | Re-run. If it landed: `a pool already exists on config ...` and the checks run. If not, it makes the pool. **Never post the address from a `2. launch` line before `checks PASSED`** |
| `already launched: mint ...` on a re-run | The launch happened | The contract address is in `launch-mainnet.json`. Check it on Solscan: supply 21,000,000, no mint or freeze authority, 5% transfer fee |
| `checks FAILED` | Something is off | Post nothing. Read which check failed and ask for help |

## If the PC goes offline

What keeps working: the website, trading, the tax (it collects on chain), mining (the app keeps going 15 minutes, then waits and restarts by itself).
What stops: payouts, new assignments, wallet pages in the app.

When it's back:
1. [ ] `infra\pc\check-api.ps1`: the API and tunnel come back by themselves; this confirms.
2. [ ] Loop window: `P`. Watch the first round. A line `unconfirmed payouts from last time: ...` is normal: it checked the chain and won't pay anything twice.
3. [ ] `P ctl status`.

Mining while the PC was off is only credited for 15 minutes; the true-up to Kryptex's balance makes up part of it over the next day. Keep outages short.
If it went off **during** the launch: "If the launch fails halfway" above.
