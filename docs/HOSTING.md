# Hosting: putting the site and the API live

Written October 17, 2026 for the launch (~October 24). Domain: **hashcoin.app** (if you buy a different one, run `node apps/web/scripts/set_domain.mjs <domain>` first, commit and push; it updates every file below).

- **Website** → Cloudflare Pages (free). Static files from `apps/web`, rebuilt on every push.
- **API** (`services/api`) → runs on your PC, reached at **https://api.hashcoin.app** through a Cloudflare Tunnel (free). The tunnel is an outbound connection from your PC, so **no router ports are opened** and your home IP isn't published.
- Both live in one free Cloudflare account. Everything on the code side is ready; the steps below are the clicks only you can do.

## The checklist (about an hour)

### 0. Domain on Cloudflare (5 min, or up to a few hours if bought elsewhere)
- [ ] Easiest: buy it at Cloudflare: [dash.cloudflare.com](https://dash.cloudflare.com) → **Domain Registration** → **Register Domains** → `hashcoin.app`. It's then on Cloudflare already; skip to step 1.
- [ ] Bought elsewhere: Cloudflare → **Add a domain** → `hashcoin.app` → **Free** plan → continue. Cloudflare shows two nameservers. At your registrar, replace the domain's nameservers with those two. Wait until Cloudflare shows the domain as **Active** (usually minutes, sometimes hours).

### 1. Website on Cloudflare Pages (15 min)
- [ ] Make sure the branch you'll deploy has this work. The site work lives on `claude/vibrant-cray-fpbieb`; merge `claude/launch-hosting` into it first (or ask a Claude session to).
- [ ] Cloudflare → **Workers & Pages** → **Create** → **Pages** tab → **Import an existing Git repository** (Connect to Git) → **GitHub** → install Cloudflare's GitHub app for **only** `eyecatchingwebsites/hash-placeholder` → pick the repo → **Begin setup**.
- [ ] Fill in exactly:
  - Project name: `hashcoin`
  - Production branch: `claude/vibrant-cray-fpbieb`
  - Framework preset: **None**
  - Build command: `node scripts/build_pages.mjs`
  - Build output directory: `dist`
  - Root directory (under *Advanced*): `apps/web`
- [ ] **Save and Deploy**. Wait for **Success** (about a minute), then open `https://hashcoin.pages.dev`. You should see the site.
- [ ] Stop preview builds of every other branch: project → **Settings** → **Builds** (Builds & deployments) → **Branch control** → Preview branches: **None** → Save. (The free plan allows 500 builds a month.)
- [ ] Project → **Custom domains** → **Set up a custom domain** → `hashcoin.app` → **Activate domain**. Repeat for `www.hashcoin.app`. Wait for both to show **Active** (a few minutes; HTTPS is automatic).
- [ ] Open **https://hashcoin.app**, **https://hashcoin.app/token/hash.json** and **https://hashcoin.app/token/hash.png**.

### 2. API from your PC (25 min)
- [ ] (Launch settings; skip while testing.) Make the folder `C:\Users\<you>\.hashcoin` and in it a text file `api.env`:
  ```
  HASH_NETWORK=mainnet
  HASH_SIGNING_KEY_FILE=C:\Users\<you>\.hashcoin\assignment-signing-key.pem
  HASH_PAYOUT_ADDRESS_PRL=<the platform's PRL address on Kryptex>
  ```
  The signing key is the production assignment key whose public half goes in the app's `TRUSTED_KEYS` (`apps/desktop/README.md`, "Before release"). Keep it in that folder, never in the repo. Without `api.env` the API runs with its dev key, which only test builds of the app trust; with `HASH_NETWORK=mainnet` and no key file it refuses to start.
- [ ] Close any PowerShell window that's running the API (two copies can't share the port).
- [ ] Start → type **PowerShell** → right-click → **Run as administrator**. Then:
  ```
  cd C:\Users\LukeW\dev\hash-placeholder
  powershell -ExecutionPolicy Bypass -File infra\pc\api-autostart.ps1
  powershell -ExecutionPolicy Bypass -File infra\pc\setup-tunnel.ps1
  ```
  The first makes the API start with Windows (task "Hashcoin API") and starts it. The second installs `cloudflared` (it asks first), opens a browser to sign in to Cloudflare (click **hashcoin.app**, then **Authorize**), creates the tunnel, adds the `api` DNS record, installs the **Cloudflared** service and runs the health check.
- [ ] The check should end with five **PASS** lines and "All good". Run it again any time (no admin needed):
  ```
  powershell -ExecutionPolicy Bypass -File infra\pc\check-api.ps1
  ```
- [ ] On your phone with Wi-Fi off, open `https://api.hashcoin.app/v1/health`. It shows `{"ok":true}`.

### 3. Keep the PC awake (5 min)
- [ ] **Settings → System → Power** (Power & battery) → **Screen, sleep & hibernate timeouts**: "Make my device sleep after" (plugged in) → **Never**. Hibernate → **Never** if listed. Turning the screen off is fine.
- [ ] **Settings → Windows Update**: **Pause updates** for the launch week. Then **Advanced options → Active hours** → Manually → e.g. 8:00 AM to 2:00 AM, so any restart happens at night.
- [ ] Use a wired connection if you can, and leave the PC on (don't shut down or sign out; locking is fine).
- [ ] After a restart (update or power cut) both come back by themselves: the tunnel is a Windows service and the API is a startup task. Run `check-api.ps1` to confirm.

### 4. Desktop release variables (5 min)
GitHub → the repo → **Settings** → **Secrets and variables** → **Actions** → **Variables** tab → **New repository variable**, three times:

| Name | Value |
|---|---|
| `HASHCOIN_API_BASE` | `https://api.hashcoin.app` |
| `HASHCOIN_SAFETY_URL` | `https://hashcoin.app/antivirus.html#check` |
| `HASHCOIN_AV_HELP_URL` | `https://hashcoin.app/antivirus.html` |

They're built into the app by `.github/workflows/desktop-release.yml` (the release refuses to build without an https `HASHCOIN_API_BASE`). Cloudflare serves `antivirus.html` at `/antivirus` and redirects; the browser keeps the `#check` or `#avast` part.

### 5. Switch features on (each one: edit, commit, push; the site redeploys in about a minute)
All in `apps/web/assets/js/config.js`:
- [ ] `waitlist: true` once `check-api.ps1` passes. The form then posts to the API.
- [ ] `download: { url, version, sha256 }` when the GitHub release is published: the installer's link and its SHA-256 from the release's `SHA256SUMS.txt`. The button, the version and the checksum then show on the home page and on `antivirus.html#check`.
- [ ] `x`, `discord`, `github` links. **When you set `x`, also add it to `apps/web/token/hash.json`** as `"twitter": "<the same link>"`, at the top level and inside `extensions`; the build refuses a mismatch. Do this before the launch: wallets and explorers cache the metadata.
- [ ] `launchAt` when the time is fixed.
- [ ] `ca` at launch, from the launch script's output. Never before.

### 6. Launch day
- Token metadata URL for `packages/chain/scripts/launch-mainnet.ts`: `--uri https://hashcoin.app/token/hash.json` (name `Hashcoin`, symbol `HASH`, image `https://hashcoin.app/token/hash.png`, 512×512).
- Before you run it, open the JSON in a browser and check the X link is there.

## What visitors see if your PC is off

| Where | What happens |
|---|---|
| Website | Stays up (Cloudflare hosts it). The waitlist form says "The waitlist server isn't answering. Try again later." |
| The app | Each GPU keeps mining its current assignment for up to 15 minutes, then stops with "assignment expired; waiting for the server" and the card shows the server error. It retries every 5 minutes and starts again by itself when your PC is back. No reinstall, nothing for users to do. |
| `api.hashcoin.app` | Cloudflare's error page: **530 / error 1033** when the tunnel is down (PC off or asleep), **502** when the tunnel is up but the API isn't running. |
| Payouts | No rounds while the PC is off; they resume with the next round. The tax keeps collecting on-chain in the meantime. Wallet pages (`/v1/wallet/...`) don't answer. |
| App updates | The update check fails quietly and tries again later. |

Plan: if $HASH takes off, move the API and payout loop to a small server (PROJECT.md §2, Oct 5 decision). Only the tunnel's machine changes; the domain and the app stay the same.

## What the API exposes

The tunnel only forwards `https://api.hashcoin.app/v1/...`; any other path gets a 404 from Cloudflare before reaching your PC. The API listens on `127.0.0.1` only (`HOST` unset), so nothing on your network or the internet reaches it except through the tunnel. `check-api.ps1` checks both.

| Route | Returns | Notes |
|---|---|---|
| `GET /v1/health` | `{"ok":true}` | |
| `GET /v1/keys` | The assignment public key | Public by design: the app checks signatures with it |
| `GET /v1/miners` | Signed miner list: download URLs, SHA-256, arguments | Public |
| `POST /v1/assignments` | Signed coin, pool and miner per GPU. The pool login is the platform's PRL address plus a worker id | The PRL address is in every miner's command line anyway. Records wallet ↔ worker in `services/api/data/workers.json` (never served) |
| `GET /v1/stats` | The payout loop's public record without the per-wallet list: rounds, totals, market, funding (payout wallet's SOL float, buys with Solscan links), tax rate | All of it is on-chain public data |
| `GET /v1/wallet/<address>` | One wallet's balance, levels, hold clock, hours mined, paid, pending | Anyone can look up any address, like a block explorer |
| `GET /v1/prices` | PRL price history from Kryptex | |
| `GET /v1/app/update/<target>/<arch>/<version>` | 204, or the update feed (`latest.json`) the release workflow signed | |
| `GET /v1/waitlist` | `{"count": n}` | |
| `POST /v1/waitlist` | `{"ok": true, "already": false, "count": n}` | Stores the X handle or email and the GPU in `services/api/data/waitlist.jsonl`. No IP, no wallet. Never served. Browsers may only post from `https://hashcoin.app` / `www` (`HASH_SITE_ORIGINS`) |
| anything else | 404 | Errors never include details ("internal error") |

Never exposed: the signing key, the worker registry, waitlist entries, logs, the payout loop (it has no web server), RPC keys, the payout keypair.

**Limits** (`services/api/src/guard.ts`, tested): 300 requests a minute per IP; check-ins 60 a minute per IP and 20 a minute per wallet (the app checks in every 5 minutes); the waitlist 5 per 10 minutes per IP and 100,000 entries, one per contact. Bodies up to 64 KB, headers up to 16 KB, 10 s to send headers, 20 s per request, 16 GPUs per check-in. The visitor's IP is Cloudflare's `CF-Connecting-IP`, trusted only on connections from this PC (cloudflared). Optional extra: Cloudflare → hashcoin.app → **Security → WAF → Rate limiting rules** has one free rule (e.g. 100 requests per 10 s per IP on `api.hashcoin.app`).

## Files

| Path | What |
|---|---|
| `apps/web/wrangler.toml` | Cloudflare Pages project settings (output `dist`) |
| `apps/web/scripts/build_pages.mjs` | Copies only the public files to `apps/web/dist/` and checks them: every link resolves, og/canonical URLs are on the domain, token metadata is valid and matches `config.js`, `_headers` allows the API. `--serve` previews `dist/` on :8124 with Cloudflare's headers, `/faq` URLs and the 404 page |
| `apps/web/_headers` | Security headers (CSP, no framing, HSTS) and CORS for `/token/*` |
| `apps/web/robots.txt`, `sitemap.xml`, `404.html` | Crawlers and unknown URLs (without a 404 page Cloudflare would serve the home page for every bad link) |
| `apps/web/token/hash.json`, `hash.png` | Token metadata and 512×512 logo for `--uri` |
| `apps/web/scripts/set_domain.mjs` | Moves everything to another domain |
| `infra/pc/config.template.yml` | Tunnel config: `api.hashcoin.app` + `/v1/` → `http://127.0.0.1:8787`, everything else 404 |
| `infra/pc/setup-tunnel.ps1` | Installs and starts the tunnel as the **Cloudflared** Windows service. Safe to re-run. `-DryRun` prints the config |
| `infra/pc/run-api.ps1`, `api-autostart.ps1` | Runs the API with settings from `%USERPROFILE%\.hashcoin\api.env`, restarts it if it stops; the startup task |
| `infra/pc/check-api.ps1` | Health check: local, localhost-only, service, public, 404 outside `/v1/` |

## Troubleshooting
- **Pages build fails**: open the deployment's log. `build_pages: N problem(s)` lists exactly what's wrong (usually a `config.js` value). Run `node apps/web/scripts/build_pages.mjs` locally to see the same.
- **530 / 1033 on api.hashcoin.app**: `Get-Service Cloudflared` (should be Running); `Start-Service Cloudflared` as administrator. Its log: `C:\ProgramData\Hashcoin\cloudflared\cloudflared.log` (administrator only).
- **502**: the API isn't running. Log: `services\api\data\api.log`. Start it: `Start-ScheduledTask "Hashcoin API"`, or run `infra\pc\run-api.ps1` in a window.
- **The startup task doesn't run on a Microsoft account**: open Task Scheduler → "Hashcoin API" → Properties → choose "Run only when user is logged on", and turn on automatic sign-in; or just start `run-api.ps1` after each restart.
- **Update cloudflared** now and then: `winget upgrade Cloudflare.cloudflared`, then `Restart-Service Cloudflared` (administrator).
- **Remove everything**: `Stop-Service Cloudflared; sc.exe delete Cloudflared; Unregister-ScheduledTask "Hashcoin API" -Confirm:$false`, and delete the tunnel in Cloudflare → Zero Trust → Networks → Tunnels.
