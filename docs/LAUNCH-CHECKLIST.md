# Launch checklist

Launch: about **October 24, 2026**. One list for you, one for Claude. The how-to for each step is in two guides that arrive when their branches are merged (Claude's first item):
- `docs/HOSTING.md`: putting the website and the API live (about an hour).
- `docs/LAUNCH-RUNBOOK.md`: T-48h to the first day, with every command.

Last updated Oct 17 (domain bought: hashcoin.app).

---

## You

### Decide
- [x] **Domain: hashcoin.app** (bought Oct 17).
- [x] **X handle: @HashcoinSOL** (Oct 17). It's in the token metadata and on the site.
- [ ] **How the dev bag is locked in public**, e.g. a token lock on Streamflow or Jupiter Lock.
- [ ] **Graduation target**, around Oct 22, from how the X posts do: 40 SOL if it's quiet, 50 SOL in the base case, 85 SOL if it's strong.

### Accounts (start now; some take days)
- [x] Buy the domain (hashcoin.app, Oct 17). If it was bought outside Cloudflare, point its nameservers to Cloudflare (HOSTING.md step 0).
- [ ] Cloudflare: put the site and the API live (HOSTING.md steps 0–3, about an hour).
- [ ] Helius: create an API key (the free tier is enough to start).
- [ ] Discord: create the server and run the setup script (`docs/DISCORD-SETUP.md`, about 20 minutes). It also creates the alerts webhook.
- [ ] Squads (squads.so): create the multisig and copy its vault address.
- [ ] GitHub: add the three repo variables (HOSTING.md step 4).
- [ ] Legal check, even a short consult, before the X campaign gets loud.

### Wallets and money
- [ ] Create the launcher, dev and payout wallets (runbook, T-48h). Back them up to a USB stick kept offline, never in the repo.
- [ ] Fund them (runbook, T-24h): the launcher with about 0.08 SOL; the dev wallet with about 0.26 SOL at a 50 SOL target (the launch script prints the exact figure); the payout wallet with SOL for fees.
- [ ] A Pearl (PRL) payout address on Kryptex that belongs to the project, not your personal test address.

### Marketing and trust
- [ ] Post the promo and open the waitlist.
- [ ] Report the app installer and `forge.exe` to Microsoft as false positives (microsoft.com/wdsi/filesubmission). This needs your sign-in.
- [ ] On a real PC if you can, check the antivirus help page's steps for Defender, Norton and McAfee.

### Test the Windows app
- [ ] The update from 0.1.0 to 0.1.1 installs and mining resumes.
- [ ] "Mine only when I'm away" and "Pause while a game is fullscreen" both pause and resume.
- [ ] "Start mining when Windows starts" works; then turn it off again.
- [ ] Then archive the Windows app session; it's running the local test server.

### Launch day
- [ ] Follow `docs/LAUNCH-RUNBOOK.md` step by step. Post the contract address on the site **first**, then on X.

---

## Claude

### When you say go
- [x] Merge `claude/launch-hosting` and `claude/launch-rehearsal` into `claude/vibrant-cray-fpbieb` (Oct 17), with every test run.
- [x] Domain: hashcoin.app is already what the hosting work uses; nothing to switch.
- [ ] Follow-ups the sessions turned up: start the payout loop when Windows starts, and make market buys and harvests crash-safe (a crash in the second after a buy could buy twice; nobody is paid twice).

### Once the domain is live
- [ ] With you at the keyboard: generate the production keys (the server signing key and the app update key), stored outside the repo, with backups.
- [ ] Build the first real Windows release (unsigned) pointed at the live API, and put its SHA-256 on the site.
- [x] Add the X link to the token metadata and the site (@HashcoinSOL, Oct 17).
- [ ] Mainnet dry runs with your real wallets and Helius: the launch script with `--dry-run`, then the payout loop with `--dry-run`.

### Launch day and after
- [ ] Stand by on the runbook: a half-finished launch, a stuck migration, alerts.
- [ ] After graduation: hand the rate authority to the multisig (runbook step).
- [ ] Live numbers on the site (payouts, wallets we control) once rounds are running.

---

## Domain options (decided: hashcoin.app)

Checked Oct 17 through the registries' public records. A domain listed as free can still be taken before you buy, so confirm at checkout.

| Domain | Status | Notes |
|---|---|---|
| **gethashcoin.com** | free | A `.com` reads as a real product to people outside crypto. About $10 a year. **Recommended.** |
| hashcoin.gg | looks free | Gamer audience, which fits "your gaming PC". Pricier (around $60–90 a year), and not sold on Cloudflare Registrar. |
| hashcoin.app | free | Fine, but reads as "the app" when the app is only one part. |
| usehashcoin.com | free | Like gethashcoin.com. |
| hashcoin.network, .world, .tech | free | Longer; nothing special. |
| hashcoin.money, .finance, .fun | free | Avoid: they read as promising money, or as a joke memecoin. |
| hashcoin.com, .io, .org, .net, .cash | taken | |
| hashcoin.co, .xyz | resale only | $1,488 and $5,888. |

Whatever you pick, Claude switches every reference with one script.
