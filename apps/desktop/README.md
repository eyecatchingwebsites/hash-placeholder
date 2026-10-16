# Hashcoin Miner (desktop)

Windows-first desktop app: paste a Solana wallet address, click **Start mining**. The app finds the GPUs,
asks the Hashcoin server which coin each card should mine, verifies the signed answer, downloads the right
miner (checked against a signed SHA-256), and keeps it running. Switching between coins is decided by the
server (`packages/switcher`) per card, with hysteresis.

```
core/        platform-independent logic, fully unit tested (cargo test -p hashcoin-core)
src-tauri/   Tauri 2 shell: window, tray, settings, updater, background loop (src/runtime.rs),
             Windows probes for the safety pauses (src/system.rs)
ui/          the single-page UI
scripts/     build-local-test.ps1 (test installer), update-feed.mjs, signing-config.mjs (release workflow)
```

## Miner and pool
- **ForgeMiner 1.8.8** (NVIDIA; PRL, Quantus, QubitCoin) on **Kryptex PRL** (`stratum+ssl://prl-us.kryptex.network:8048`,
  EU fallback), SHA-256 pinned in `services/api/config/miners.json`. 1.8.4 mined live on the user's RTX 4070 SUPER on
  Oct 4; 1.8.8 (Oct 14) adds fixes for 8 GB cards, RTX 30 crashes and dead pool connections, and still needs one live run.
- BzMiner for Quantus on AMD/Intel (not yet run on an AMD PC).

## Safety
- **Temperature:** each card pauses at the limit (default 83 °C, choices 70–83) and resumes 8 °C cooler. ForgeMiner
  and BzMiner get the limit as flags (`{tempLimit}`/`{tempResume}` in the manifest) and pause the card themselves; the
  app also reads NVIDIA temperatures (nvidia-smi) and stops a card's miner 4 °C above the limit as a backstop
  (at the limit itself for a miner without its own).
- **Power cap (optional, off):** passed as the miner's power flag (`powerArgs`, ForgeMiner `--plimit <watts>`).
  NVIDIA only allows this to an administrator, and the app never asks for admin rights, so it applies only if the user
  runs the app elevated.
- **Mine only when I'm away (off):** pauses while the keyboard or mouse was used in the last 2–30 minutes.
- **Pause while a game is fullscreen (off):** Windows' fullscreen/busy state, or a foreground window covering its
  monitor; resumes 20 s after the game leaves fullscreen.
- Pauses stop the miner process but keep the assignment, so mining picks up by itself. Card rows show why.

## Settings
Gear button in the header. Saved to `%APPDATA%\com.hashcoin.miner\settings.json`; every field has a default, so a
partial file still loads (a file without `rigId` used to fall back to all defaults, the Oct 4 "placeholder server" bug).
The server is the one built into the app (`HASHCOIN_API_BASE` at build time). The app never saves it; only an
`apiOverride` typed into the file by hand replaces it, and never a `*.invalid` placeholder. Builds before Oct 17 saved
their built-in server as `apiBase`, which pinned every later build to it; that key is now ignored.
- **Start mining when Windows starts** (off): adds a login entry (`HKCU\...\Run`) that starts the app in the tray with
  `--autostart` and starts mining. A second launch just opens the running app (single instance).
- Balance / Paid / Still coming come from the API's `/v1/wallet/<address>` (the payout loop's public record).

## Updates
Tauri updater. The app asks `<apiBase>/v1/app/update/{target}/{arch}/{version}` at start and every 6 hours and shows
"Update ready" with an Install button; nothing installs without the click. The installer must carry a signature from
the update key whose public half is `plugins.updater.pubkey` in `tauri.conf.json` (placeholder until the user makes
the key; the app then doesn't look for updates). The API serves `latest.json` from the release workflow
(`HASH_APP_UPDATE`, default `services/api/config/app-update.json`; no file = 204, nothing offered). If mining was on,
the new version resumes it.

## Run locally (debug)
1. Start the API with a dev key: `cd services/api && npx tsx src/main.ts`. It prints a throwaway public key.
2. Run the app trusting that key (debug builds only):
   `HASHCOIN_DEV_PUBKEY=<key> HASHCOIN_API=http://127.0.0.1:8787 cargo run -p hashcoin-miner --features dev-key`.
   In PowerShell: `$env:HASHCOIN_DEV_PUBKEY = "<key>"; $env:HASHCOIN_API = "http://127.0.0.1:8787"` first.

End-to-end test (API + app runtime + stand-in miner, `src-tauri/examples/stand_in_miner.rs`): with the API running,
`HASHCOIN_E2E_API=http://127.0.0.1:8787 HASHCOIN_E2E_PUBKEY=<key> cargo test -p hashcoin-miner --features dev-key -- --ignored`.

## Test installer on this PC
`powershell -ExecutionPolicy Bypass -File apps\desktop\scripts\build-local-test.ps1` (API running) builds an
**unsigned test installer** that trusts the local API's key and address (title bar says "test build") and signs updates
with a throwaway key in `%LOCALAPPDATA%\hashcoin-dev`. It prints the installer path and SHA-256 and writes `latest.json`.
Install silently with `"<installer>" /S` (goes to `%LOCALAPPDATA%\Hashcoin Miner`). Never give these out.

To test an update: build again with `-Version 0.1.1`, serve `target\release\bundle\nsis` with
`python -m http.server 8790`, start the API with `HASH_APP_UPDATE=<that folder>\latest.json`, open the installed
0.1.0 and click Install on the "Update ready" banner.

## Release (`.github/workflows/desktop-release.yml`)
- A push that touches the app builds an **unsigned test installer** (throwaway update key, `-TEST` artifact).
- A tag `desktop-vX.Y.Z` (matching `tauri.conf.json`) is a real release: it stops unless the production assignment
  key is in `TRUSTED_KEYS`, the update key's public half is in `tauri.conf.json`, the `TAURI_SIGNING_PRIVATE_KEY`
  secret exists and `HASHCOIN_API_BASE` is an https URL. It uploads `HashcoinMiner-X.Y.Z-setup.exe`, its `.sig`,
  `latest.json` and `SHA256SUMS.txt`, and opens a **draft** GitHub release. The SHA-256 is in the run summary for the
  website's download page.
- **Code signing** is off until the repository variable `WINDOWS_SIGNING` is `azure`. Then it installs
  `artifact-signing-cli` (Azure Artifact Signing, formerly Trusted Signing) and signs the app and installer during the
  build (before the update signature is made), using variables `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`,
  `AZURE_SIGNING_PROFILE` and secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`; it fails if the
  installer's signature isn't valid.

## Safety and trust rules built in
- Only the public wallet address is ever requested. Never a seed phrase or private key.
- Assignments and the miner list must carry a valid Ed25519 signature from a key compiled into the app.
  Each assignment is checked for this wallet, rig and GPU. It must expire, and the pool worker must belong
  to the user's wallet.
- Miner downloads must be https, match the signed SHA-256, and unzip without path traversal.
- Miner arguments are passed without a shell, and values that look like extra flags are rejected.
- Mining starts only when the user clicks Start (or turned on "Start mining when Windows starts"). Closing the window
  hides to the tray, and the tray shows the app is running. Quit stops all miners. The app never asks for admin rights
  and never touches antivirus or Defender settings.
- App updates install only with the user's click and only if signed with our update key.

## Before release
- [ ] Production assignment key in `TRUSTED_KEYS` (`src-tauri/src/main.rs`).
- [ ] Update key: `npx @tauri-apps/cli@2 signer generate -w hashcoin-updater.key`; public half in `tauri.conf.json`,
      private half and password as GitHub secrets, backed up offline (losing it means installed apps can't update).
- [ ] `HASHCOIN_API_BASE` variable; the production API serving `/v1/app/update/...`.
- [ ] Azure Artifact Signing account approved, then the signing variables/secrets and `WINDOWS_SIGNING=azure`.
- [ ] PRL platform payout address in `services/api/config/coins.json` (now the user's own test address).
- [ ] One live run of ForgeMiner 1.8.8 (Defender, shares), the safety pauses and the power cap on the user's PC.
- [ ] Submit each release to Microsoft's false-positive portal and VirusTotal vendors.
- [ ] Benchmarks per card, reported in check-ins (the API already accepts `benchmarks`).
- [ ] Linux .tar.gz extraction (only .zip is supported now).
