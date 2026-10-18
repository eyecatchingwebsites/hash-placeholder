# Discord setup

A script builds the server: roles, permissions, channels, scam and link filters, the payout alerts webhook, the server icon and the first posts. You do the few steps that need your Discord login. About 20 minutes.

To see exactly what it sets up: `node infra/discord/setup-discord.mjs --print-plan`.

## What you get

- **Roles**, top to bottom:
  - **Team** (gold): moderation and pinging everyone.
  - **Moderator** (light gold): delete messages, time out and kick.
  - **Miner** and **Holder**: people pick them, colored like the site's levels.
  - **Updates**: an opt-in ping for announcements.

  Nobody but you gets Administrator.
- **Channels:**
  - **Start here:** #welcome, #rules, #announcements, #official-links. Everyone reads; only Team posts.
  - **Community:** #general, #mining, #trading, #memes, #ideas. There's slowmode on #general (3 s) and #trading (10 s).
  - **Support:** #app-help, #payouts-help.
  - **Team:** private. #team, #mod-log (Team and Moderator), and #alerts (Team).
- **AutoMod.** Team and Moderator are exempt from all of these.
  - **Scam phrases** ("seed phrase", "private key", "validate your wallet", "dm me", "support ticket", Telegram links…): blocked, reported in #mod-log, and a 10-minute timeout.
  - **Links:** blocked unless they're to hashcoin.app, x.com/HashcoinSOL, Solscan, GitHub, DexScreener, Birdeye, Jupiter, Meteora or Solana. Discord invites are blocked too.
  - **Mention spam** (5 or more pings): blocked, with a 1-hour timeout.
  - **Spam and slurs:** blocked.
- **Server settings:**
  - Verification Medium (a verified email and an account older than 5 minutes).
  - Explicit-media filter for everyone.
  - Notifications set to @mentions only.
  - The Hashcoin coin as the server icon.
- **Webhook:** "Hashcoin payouts" in #alerts. Its address is written straight into `%USERPROFILE%\.hashcoin\payouts.env` (`HASH_ALERT_WEBHOOK`), so payout alerts land there. It's never printed on screen.
- **Posts:** welcome, rules and official links. A post is skipped if its channel already has messages.

## Before the script (you)

1. **Create the server:** in Discord, click **+** → Create My Own → For a club or community. Name it **Hashcoin**.
2. **Copy the server ID:**
   - User Settings → Advanced → turn on **Developer Mode**.
   - Right-click the server icon → **Copy Server ID**.
3. **Make a setup bot.** It's temporary; you remove it afterwards.
   - Go to https://discord.com/developers/applications → **New Application** → name it "Hashcoin Setup".
   - **Bot** → **Reset Token** → copy the token.
   - Open Notepad with `notepad %USERPROFILE%\.hashcoin\discord.env` (Win+R), and type one line: `DISCORD_BOT_TOKEN=` followed by the token. Save.
   - Never paste the token into chat, Discord or the repo.
   - **OAuth2** → **URL Generator**: tick **bot**, then under permissions tick **Administrator**. Open the URL at the bottom and add the bot to your Hashcoin server.

## Run it

From the repo folder, in PowerShell:

```
node infra/discord/setup-discord.mjs --guild <server id> --dry-run
node infra/discord/setup-discord.mjs --guild <server id> --community
```

The dry run reads the server and lists the changes without making any. The second line sets everything up and turns on Discord's Community features (an announcement channel people can follow, the rules screen and onboarding). Leave out `--community` if you'd rather not. Running it again is safe: it updates rather than duplicates.

## After the script (you)

1. **Remove the setup bot:** Server Settings → Integrations → Hashcoin Setup → Remove. Then delete the application in the developer portal, or reset its token.
2. **Turn on 2FA for moderators:** Server Settings → Safety Setup → **Require 2FA for moderator actions**. Your own account needs 2FA first.
3. **Safety Setup:** turn on **DM spam filter** and **Raid protection**.
4. **Onboarding** (with Community on): Server Settings → Onboarding.
   - **Default channels:** #welcome, #rules, #announcements, #general.
   - **One question, "What brings you here?":**
     - **Mining** gives the Miner role.
     - **Holding** gives the Holder role.
     - **Announcement pings** gives the Updates role.
5. **Invite link:** Invite people → Edit invite link → **Expire after: Never**. Send the link to Claude; it goes on the site (Discord button) and in your X bio.
6. **Banner** (needs Server Boost level 2): upload `apps/web/brand/social/discord-banner.png` in Server Settings → Server Profile. The **invite background** (level 1) is `discord-invite-splash.png`. If you boost later, running the script again uploads both.
7. **Team:** give **Team** or **Moderator** only to people you trust. Never give anyone Administrator.

## Bots: keep it minimal

- **You don't need a verification bot.** Discord's own onboarding, Medium verification and the AutoMod rules above cover it. Fake "verify your wallet" bots are a common scam, and the rules tell people that.
- **Later, for holder roles:** Collab.Land can give the Holder role to wallets that hold $HASH. It checks a signed message, never a seed phrase. Add it after launch, with only the permissions it asks for.
- **If you get raided:** Wick (anti-raid, anti-nuke).
- **Never leave a bot with Administrator.**
- **X posts in #announcements:** post by hand for now. Automatic X feeds need a paid service.

## Images

All in `apps/web/brand/social/`:

| File | Use |
|---|---|
| `hashcoin-avatar-white-hash.png` | Server icon and X profile picture (the script sets the server icon) |
| `discord-banner.png` (960×540) | Server banner (boost level 2) |
| `discord-invite-splash.png` (1920×1080) | Invite background (boost level 1) |
| `x-header.png` (1500×500) | X header: "Most coins need buyers. $HASH makes its own." |
