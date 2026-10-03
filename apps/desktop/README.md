# Hashcoin Miner (desktop)

Windows-first desktop app: paste a Solana wallet address, click **Start mining**. The app finds the GPUs,
asks the Hashcoin server which coin each card should mine, verifies the signed answer, downloads the right
miner (checked against a signed SHA-256), and keeps it running. Switching between coins is decided by the
server (`packages/switcher`) per card, with hysteresis.

```
core/        platform-independent logic, fully unit tested (cargo test -p hashcoin-core)
src-tauri/   Tauri 2 shell: window, tray, settings, background loop (src/runtime.rs)
ui/          the single-page UI
```

## Run locally
1. Start the API with a dev key: `cd services/api && npx tsx src/main.ts`. It prints a throwaway public key.
2. Run the app trusting that key (debug builds only):
   `HASHCOIN_DEV_PUBKEY=<key> cargo run -p hashcoin-miner --features dev-key`, and set `apiBase` to
   `http://127.0.0.1:8787` in the settings file (app config dir `settings.json`).

End-to-end test (API + app runtime + stand-in miner): see the `e2e` module in `src-tauri/src/runtime.rs`.

## Safety and trust rules built in
- Only the public wallet address is ever requested. Never a seed phrase or private key.
- Assignments and the miner list must carry a valid Ed25519 signature from a key compiled into the app.
  Each assignment is checked for this wallet, rig and GPU. It must expire, and the pool worker must belong
  to the user's wallet.
- Miner downloads must be https, match the signed SHA-256, and unzip without path traversal.
- Miner arguments are passed without a shell, and values that look like extra flags are rejected.
- Mining starts only when the user clicks Start. Closing the window hides to the tray, and the tray shows
  the app is running. Quit stops all miners. The app never touches antivirus or Defender settings.

## Before release
- [ ] Replace `TRUSTED_KEYS` in `src-tauri/src/main.rs` with the production public key. The release workflow blocks until this is done.
- [ ] Real miner builds, URLs and SHA-256 in `services/api/config/miners.json`, after checking licenses and dev fees.
- [ ] Real pools with per-worker stats in `services/api/config/coins.json`.
- [ ] Code signing in `.github/workflows/desktop-release.yml`.
- [ ] Submit each release to Microsoft's false-positive portal and VirusTotal vendors.
- [ ] Temperature and power limits, and pausing while a game runs (not built yet).
- [ ] Optional auto-start (off by default) and auto-update (Tauri updater with a signed feed).
- [ ] Benchmarks per card, reported in check-ins (the API already accepts `benchmarks`).
- [ ] Linux .tar.gz extraction (only .zip is supported now).
