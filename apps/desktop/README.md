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
  app also reads NVIDIA temperatures (NVML) and stops a card's miner 4 °C above the limit as a backstop
  (at the limit itself for a miner without its own).
- **Power cap (optional, off):** passed as the miner's power flag (`powerArgs`, ForgeMiner `--plimit <watts>`).
  NVIDIA only allows this to an administrator, and the app never asks for admin rights, so it applies only if the user
  runs the app elevated.
- **Mine only when I'm away (off):** pauses while the keyboard or mouse was used in the last 2–30 minutes.
- **Pause while a game is fullscreen (off):** Windows' fullscreen/busy state, or a foreground window covering its
  monitor; resumes 20 s after the game leaves fullscreen.
- Pauses stop the miner process but keep the assignment, so mining picks up by itself. Card rows show why.

## Antivirus (Microsoft Defender)
- **Oct 16, 6:19 PM: Defender quarantined the unsigned test build** (commit 182e964) when the user clicked Start:
  `Trojan:Script/Conteban.A!ml` (ThreatID 2147735508, severity 5, a machine-learning detection by real-time
  protection). It hit the app itself (`%LOCALAPPDATA%\Hashcoin Miner\hashcoin-miner.exe`, its Start menu shortcut and
  uninstall entry), not ForgeMiner: the app was stopped before ForgeMiner 1.8.8 was even saved to disk.
- **The app ships unsigned at launch** (user, Oct 16: individual signing shows the signer's legal name as the
  publisher, rejected for privacy; launch is next week). Azure Artifact Signing stays wired in the release workflow
  but off, for **later, with an organization (a company) as the publisher**. Not part of launch.
- **What we do about it instead:** submit every installer to Microsoft's false-positive portal
  (https://www.microsoft.com/wdsi/filesubmission) and VirusTotal; publish each installer's SHA-256 on the website;
  keep the code public on GitHub; explain it in the app when Defender blocks Hashcoin (below). Never ask users to add
  exclusions or change Defender, and never pack or obfuscate.
- **Changed after it (Oct 17) so the app looks less like a dropper, verification unchanged:**
  - No helper programs: GPU names, memory and temperatures come from NVIDIA's own library (`nvml.dll`, loaded from
    System32 only) and from DirectX, read in-process. The app used to start a hidden PowerShell
    (`Get-CimInstance Win32_VideoController`) at launch and a hidden `nvidia-smi` every 5 seconds while mining.
    Now the only program it ever starts is the verified miner.
  - An explicit Windows manifest (`src-tauri/app.manifest`): runs as the signed-in user (`asInvoker`), never asks
    for admin; plus a copyright line next to the existing company, product and version in the exe's version info.
  - Unchanged on purpose: miners still live in the app's own data folder
    (`%LOCALAPPDATA%\com.hashcoin.miner\miners\<id>\<version>`), with an ordinary command line; the miner still runs
    without a console window (its output goes to `gpu-N.log`).
- **Retest of that build (52145e3, Oct 16): no change.** Defender quarantined the app again
  (`Trojan:Script/Conteban.A!ml`) and this time also ForgeMiner's `forge.exe` right after it started
  (`Trojan:Script/Wacatac.H!ml`, `...\miners\forgeminer\1.8.8\ForgeMiner-1.8.8-windows\forge.exe`). Both are ML
  guesses. Microsoft's review of submitted files can clear them; the app explains what happened in the meantime.
- **When Defender blocks Hashcoin, the app says so** (approved by the user, Oct 17). It notices, without any helper
  programs (`core/src/blocked.rs`, tested):
  - the miner file vanished or can't be read after download and verification (quarantined or locked);
  - the miner died within 20 s with an access-denied / virus exit code, or without printing anything;
  - Windows refused to start the miner (access denied, "contains a virus", blocked by policy);
  - the app itself was killed while starting a miner: a `miner-starting` marker in the app's data folder is set just
    before each start and cleared once the miner has run 30 s (or on Stop). Found at the next launch = killed mid-start.
  Then mining stops, the window opens (also from the tray), and a short message says Defender flagged Hashcoin or the
  miner, that mining software is often flagged because it uses the GPU the way some malware does and Defender's AI
  guesses, that Hashcoin isn't code-signed so Windows has less to go on, that the installer's SHA-256 is published on
  the website and the code is public on GitHub, and that miner files only run if they match their published SHA-256
  (links: "Code on GitHub", and "Installer SHA-256" on the website once `HASHCOIN_SAFETY_URL` is set at build time;
  it never promises signing or claims Microsoft verified anything), and that allowing it is the user's
  choice, with the steps: Windows Security → Virus & threat protection → Protection history → the Hashcoin item →
  Actions → Allow on device (both items if there are two), then reopen Hashcoin. "Not now" closes it and leaves mining
  off; after a block the app never starts mining by itself (login start and update resume are skipped).
- **To review the message without Defender** (test and debug builds only; release builds ignore it, tested): start
  the app with `--show-defender-help` (the "Defender stopped mining" version) or `--show-defender-help=app` (the
  "closed while starting" version). Works on a running app too (it opens the window and shows the message).
- **The app never changes Defender itself**, never offers to, adds no exclusions and never asks for admin. Verification
  is unchanged.

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
  `latest.json` and `SHA256SUMS.txt`, and opens a **draft** GitHub release (publish it by hand after a look). The
  release notes carry the SHA-256 and say the installer is unsigned (SmartScreen's "Run anyway", Defender may flag it).
  The SHA-256 is also in the run summary, for the website's download page. Releases are **unsigned** (the run says so
  as a notice, not a warning).
- **Code signing (later, not for launch):** off while the repository variable `WINDOWS_SIGNING` is unset. With
  `azure`, for an organization publisher, it installs
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
- [ ] `HASHCOIN_SAFETY_URL` variable: the website page with each installer's SHA-256 and "Why does Windows warn me?".
- [ ] Later, not for launch: code signing with an organization as the publisher (Azure Artifact Signing is wired;
      set its variables/secrets and `WINDOWS_SIGNING=azure`). Leave `WINDOWS_SIGNING` unset until then.
- [ ] PRL platform payout address in `services/api/config/coins.json` (now the user's own test address).
- [ ] One live run of ForgeMiner 1.8.8 (Defender, shares), the safety pauses and the power cap on the user's PC.
- [ ] Submit each release to Microsoft's false-positive portal and VirusTotal vendors.
- [ ] Benchmarks per card, reported in check-ins (the API already accepts `benchmarks`).
- [ ] Linux .tar.gz extraction (only .zip is supported now).
