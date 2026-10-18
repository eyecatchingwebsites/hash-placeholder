// Sets up the Hashcoin Discord server in one run: roles, permissions, channels, AutoMod scam and link
// filters, the alerts webhook for the payout loop, the server icon (and banner/splash if the server's
// boost level allows), and the welcome, rules and official-links posts. Safe to run again: it matches
// roles and channels by name and updates them instead of making duplicates.
//
//   node infra/discord/setup-discord.mjs --print-plan            what it would set up (no Discord needed)
//   node infra/discord/setup-discord.mjs --guild <server id> --dry-run
//   node infra/discord/setup-discord.mjs --guild <server id>
//   ...add --community to also turn on Discord's Community features (announcement channel, onboarding).
//
// The bot token is read from DISCORD_BOT_TOKEN, or from %USERPROFILE%\.hashcoin\discord.env
// (a line DISCORD_BOT_TOKEN=...). Never paste it anywhere else. Guide: docs/DISCORD-SETUP.md.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const printPlan = flag("print-plan"), dryRun = flag("dry-run"), community = flag("community");
const SITE = "https://hashcoin.app", X = "https://x.com/HashcoinSOL";

// ---------- Permissions ----------
const P = {
  CREATE_INVITE: 1n << 0n, KICK: 1n << 1n, BAN: 1n << 2n, MANAGE_CHANNELS: 1n << 4n, ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n, VIEW_CHANNEL: 1n << 10n, SEND: 1n << 11n, MANAGE_MESSAGES: 1n << 13n, EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n, READ_HISTORY: 1n << 16n, MENTION_EVERYONE: 1n << 17n, EXTERNAL_EMOJIS: 1n << 18n,
  CONNECT: 1n << 20n, SPEAK: 1n << 21n, CHANGE_NICKNAME: 1n << 26n, MANAGE_NICKNAMES: 1n << 27n,
  APP_COMMANDS: 1n << 31n, MANAGE_THREADS: 1n << 34n, SEND_IN_THREADS: 1n << 38n, TIMEOUT: 1n << 40n,
};
const sum = (...ps) => ps.reduce((a, b) => a | b, 0n).toString();

// Everyone: read, talk, react, share screenshots. No @everyone pings, no public threads.
const EVERYONE = sum(P.CREATE_INVITE, P.VIEW_CHANNEL, P.SEND, P.READ_HISTORY, P.ADD_REACTIONS, P.EMBED_LINKS, P.ATTACH_FILES,
  P.EXTERNAL_EMOJIS, P.CHANGE_NICKNAME, P.CONNECT, P.SPEAK, P.APP_COMMANDS, P.SEND_IN_THREADS);
const MOD = [P.MANAGE_MESSAGES, P.TIMEOUT, P.KICK, P.MANAGE_THREADS, P.VIEW_AUDIT_LOG, P.MANAGE_NICKNAMES];

// Top to bottom. Nobody but the owner gets Administrator.
const ROLES = [
  { name: "Team", color: 0xEBB447, hoist: true, permissions: sum(...MOD, P.BAN, P.MENTION_EVERYONE, P.MANAGE_CHANNELS) },
  { name: "Moderator", color: 0xF6DFA6, hoist: true, permissions: sum(...MOD) },
  { name: "Miner", color: 0x5ED3A5, hoist: false, permissions: "0" },
  { name: "Holder", color: 0x8FA3FF, hoist: false, permissions: "0" },
  { name: "Updates", color: 0, hoist: false, permissions: "0" }, // opt-in ping for announcements
];

// ---------- Channels ----------
// access: "public" | "readonly" (everyone reads, Team posts) | "team" (Team only) | "staff" (Team + Moderator)
const CATEGORIES = [
  { name: "Start here", channels: [
    { name: "welcome", access: "readonly", topic: "What Hashcoin is, and where to start." },
    { name: "rules", access: "readonly", topic: "Read before posting." },
    { name: "announcements", access: "readonly", announcement: true, topic: "News from the team. Get pinged: pick the Updates role." },
    { name: "official-links", access: "readonly", topic: "The only links to trust. The contract address is posted on hashcoin.app first." },
  ] },
  { name: "Community", channels: [
    { name: "general", access: "public", slowmode: 3, topic: "Talk about anything Hashcoin." },
    { name: "mining", access: "public", topic: "GPUs, hashrate, the Windows app. Share your setup." },
    { name: "trading", access: "public", slowmode: 10, topic: "Price talk. Not financial advice." },
    { name: "memes", access: "public", topic: "Keep it fun." },
    { name: "ideas", access: "public", topic: "Ideas and feedback for Hashcoin." },
  ] },
  { name: "Support", channels: [
    { name: "app-help", access: "public", topic: `Windows app questions. Antivirus warnings: ${SITE}/antivirus.html. The team never DMs first.` },
    { name: "payouts-help", access: "public", topic: "Questions about payouts, levels and the tax. Never post your seed phrase." },
  ] },
  { name: "Team", channels: [
    { name: "team", access: "team", topic: "Private." },
    { name: "mod-log", access: "staff", topic: "AutoMod alerts and moderation notes." },
    { name: "alerts", access: "team", topic: "Payout loop alerts (webhook)." },
  ] },
];

// ---------- Posts ----------
const POSTS = {
  welcome: [
    "**Welcome to Hashcoin.**",
    "",
    "Hashcoin ($HASH) is a Solana token with an optional Windows app. GPUs mine with spare power, what they mine buys $HASH for them, and a 2–5% tax on trades pays miners and holders by a public formula.",
    "",
    `• Website: <${SITE}>`,
    `• X: <${X}>`,
    "• The contract address is posted on hashcoin.app first. Anywhere else, check it against the site.",
    "",
    "Start with #rules, then say hi in #general. Pick the **Updates** role in Channels & Roles to get pinged for announcements.",
  ].join("\n"),
  rules: [
    "**Rules**",
    "",
    "1. Be decent. No harassment, hate or spam.",
    "2. No shilling other tokens and no referral links.",
    "3. **Never share your seed phrase or private key.** The team will never ask for it and never DMs first.",
    "4. Anyone who DMs you about \"support\", an airdrop or \"validating\" your wallet is a scammer. Report them.",
    "5. Only trust links in #official-links and on hashcoin.app.",
    "6. Nothing here is financial advice. $HASH is a new token and can lose most or all of its value.",
    "7. English in the main channels, please.",
    "",
    "Breaking these gets you a timeout or a ban.",
  ].join("\n"),
  "official-links": [
    "**Official links**",
    "",
    `Website: <${SITE}>`,
    `X: <${X}>`,
    `Antivirus help: <${SITE}/antivirus.html>`,
    "Windows app: download it only from hashcoin.app.",
    "Contract address: published on hashcoin.app at launch. Not before, and never in DMs.",
  ].join("\n"),
};

// ---------- AutoMod ----------
const SCAM_WORDS = ["*seed phrase*", "*secret phrase*", "*recovery phrase*", "*private key*", "*validate your wallet*",
  "*verify your wallet*", "*connect your wallet*", "*wallet connect*", "*walletconnect*", "*claim your airdrop*",
  "*airdrop claim*", "*dm me*", "*dm for*", "*support ticket*", "*open a ticket*", "*whatsapp*", "*t.me/*", "*telegram.me*"];
const LINK_ALLOW = ["hashcoin.app", "x.com/HashcoinSOL", "twitter.com/HashcoinSOL", "solscan.io", "github.com", "dexscreener.com",
  "birdeye.so", "jup.ag", "meteora.ag", "solana.com", "tenor.com", "giphy.com"];

// ---------- Plan only ----------
if (printPlan) {
  console.log("Roles (top to bottom):");
  for (const r of ROLES) console.log(`  ${r.name.padEnd(10)} color #${r.color.toString(16).padStart(6, "0")}${r.hoist ? ", shown separately" : ""}, permissions ${r.permissions === "0" ? "none beyond @everyone" : r.permissions}`);
  console.log(`  @everyone  permissions ${EVERYONE} (read, talk, react, embeds, files; no @everyone pings)`);
  console.log("Channels:");
  for (const c of CATEGORIES) { console.log(`  ${c.name}`); for (const ch of c.channels) console.log(`    #${ch.name.padEnd(15)} ${ch.access}${ch.announcement ? ", announcement" : ""}${ch.slowmode ? `, slowmode ${ch.slowmode}s` : ""}`); }
  console.log("AutoMod: scam phrases (block + alert to #mod-log + 10 min timeout), links outside an allow list (block + alert), mention spam (5+), spam, slurs. Team and Moderator exempt.");
  console.log("Webhook: \"Hashcoin payouts\" in #alerts, written into %USERPROFILE%\\.hashcoin\\payouts.env as HASH_ALERT_WEBHOOK.");
  console.log("Server: verification Medium, explicit-media filter for everyone, notifications @mentions only, icon = hashcoin avatar.");
  console.log("Posts: #welcome, #rules, #official-links (only if the channel is empty).");
  process.exit(0);
}

// ---------- Discord API ----------
const guild = opt("guild") ?? (console.error("--guild <server id> is required (Server Settings → Widget shows it, or right-click the server with Developer Mode on)."), process.exit(1));
function token() {
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN.trim();
  const f = path.join(homedir(), ".hashcoin", "discord.env");
  if (existsSync(f)) { const m = readFileSync(f, "utf8").match(/^DISCORD_BOT_TOKEN=(.+)$/m); if (m) return m[1].trim(); }
  console.error(`No bot token: set DISCORD_BOT_TOKEN or put DISCORD_BOT_TOKEN=... in ${f}`); process.exit(1);
}
const TOKEN = token();
async function api(method, route, body) {
  if (dryRun && method !== "GET") { console.log(`   [dry run] ${method} ${route}`); return {}; }
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://discord.com/api/v10${route}`, {
      method, headers: { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "HashcoinSetup (hashcoin.app, 1)" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) { const j = await res.json(); await new Promise((r) => setTimeout(r, (j.retry_after ?? 1) * 1000 + 100)); continue; }
    if (res.status === 204) return {};
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`${method} ${route}: ${res.status} ${JSON.stringify(j).slice(0, 300)}`), { status: res.status, body: j });
    return j;
  }
  throw new Error(`${method} ${route}: rate-limited too many times`);
}
const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

async function main() {
  const g = await api("GET", `/guilds/${guild}`);
  const me = await api("GET", "/users/@me");
  console.log(`Server: ${g.name} (${guild}), boost tier ${g.premium_tier}${dryRun ? " (DRY RUN: nothing is changed)" : ""}`);
  console.log(`Bot: ${me.username}`);

  // Server settings
  console.log("Server settings");
  await api("PATCH", `/guilds/${guild}`, {
    verification_level: 2, explicit_content_filter: 2, default_message_notifications: 1,
    icon: dataUri(path.join(repo, "apps/web/brand/social/hashcoin-avatar-white-hash.png")),
  });
  const banner = path.join(repo, "apps/web/brand/social/discord-banner.png"), splash = path.join(repo, "apps/web/brand/social/discord-invite-splash.png");
  if (g.features?.includes("BANNER") && existsSync(banner)) await api("PATCH", `/guilds/${guild}`, { banner: dataUri(banner) });
  else console.log("   banner: needs boost level 2 (upload apps/web/brand/social/discord-banner.png later)");
  if (g.features?.includes("INVITE_SPLASH") && existsSync(splash)) await api("PATCH", `/guilds/${guild}`, { splash: dataUri(splash) });
  else console.log("   invite background: needs boost level 1");

  // Roles
  console.log("Roles");
  let roles = await api("GET", `/guilds/${guild}/roles`);
  await api("PATCH", `/guilds/${guild}/roles/${guild}`, { permissions: EVERYONE }); // @everyone
  const role = {};
  for (const r of ROLES) {
    const found = roles.find((x) => x.name.toLowerCase() === r.name.toLowerCase() && !x.managed);
    const body = { name: r.name, color: r.color, hoist: r.hoist, permissions: r.permissions, mentionable: false };
    role[r.name] = found ? (await api("PATCH", `/guilds/${guild}/roles/${found.id}`, body), found.id) : (await api("POST", `/guilds/${guild}/roles`, body)).id ?? `new-${r.name}`;
    console.log(`   ${found ? "updated" : "created"} ${r.name}`);
  }
  // Order our roles just under the bot's own role (a bot can only arrange roles below its highest one).
  roles = await api("GET", `/guilds/${guild}/roles`);
  const botRole = roles.filter((x) => x.managed && x.tags?.bot_id === me.id).sort((a, b) => b.position - a.position)[0];
  if (botRole && !dryRun) {
    const top = botRole.position - 1;
    await api("PATCH", `/guilds/${guild}/roles`, ROLES.map((r, i) => ({ id: role[r.name], position: Math.max(1, top - i) })));
  }

  // Channels
  console.log("Channels");
  let chans = await api("GET", `/guilds/${guild}/channels`);
  const deny = (id, bits) => ({ id, type: 0, allow: "0", deny: bits });
  const allow = (id, bits) => ({ id, type: 0, allow: bits, deny: "0" });
  const overwrites = (access) => {
    if (access === "readonly") return [deny(guild, sum(P.SEND, P.SEND_IN_THREADS)), allow(role.Team, sum(P.SEND))];
    if (access === "team") return [deny(guild, sum(P.VIEW_CHANNEL)), allow(role.Team, sum(P.VIEW_CHANNEL, P.SEND, P.READ_HISTORY))];
    if (access === "staff") return [deny(guild, sum(P.VIEW_CHANNEL)), allow(role.Team, sum(P.VIEW_CHANNEL, P.SEND, P.READ_HISTORY)), allow(role.Moderator, sum(P.VIEW_CHANNEL, P.SEND, P.READ_HISTORY))];
    return [];
  };
  const byName = {};
  for (const [ci, cat] of CATEGORIES.entries()) {
    const catAccess = cat.channels.every((c) => c.access === "team" || c.access === "staff") ? "team" : "public";
    const foundCat = chans.find((x) => x.type === 4 && x.name.toLowerCase() === cat.name.toLowerCase());
    const catBody = { name: cat.name, type: 4, position: ci, permission_overwrites: catAccess === "team" ? [deny(guild, sum(P.VIEW_CHANNEL)), allow(role.Team, sum(P.VIEW_CHANNEL)), allow(role.Moderator, sum(P.VIEW_CHANNEL))] : [] };
    const catId = foundCat ? (await api("PATCH", `/channels/${foundCat.id}`, catBody), foundCat.id) : (await api("POST", `/guilds/${guild}/channels`, catBody)).id;
    console.log(`   ${foundCat ? "updated" : "created"} ${cat.name}`);
    for (const [i, ch] of cat.channels.entries()) {
      const found = chans.find((x) => (x.type === 0 || x.type === 5) && x.name === ch.name);
      const body = { name: ch.name, type: 0, topic: ch.topic, parent_id: catId, position: i, rate_limit_per_user: ch.slowmode ?? 0, permission_overwrites: overwrites(ch.access) };
      if (found) delete body.type;
      const id = found ? (await api("PATCH", `/channels/${found.id}`, body), found.id) : (await api("POST", `/guilds/${guild}/channels`, body)).id;
      byName[ch.name] = id;
      console.log(`      ${found ? "updated" : "created"} #${ch.name}`);
    }
  }

  // Community (optional): announcement channel, rules screen, onboarding.
  if (community) {
    console.log("Community features");
    try {
      await api("PATCH", `/guilds/${guild}`, { features: [...new Set([...(g.features ?? []), "COMMUNITY"])], rules_channel_id: byName.rules, public_updates_channel_id: byName["mod-log"] });
      await api("PATCH", `/channels/${byName.announcements}`, { type: 5 });
      console.log("   on; #announcements is an announcement channel (people can follow it into their own servers)");
    } catch (e) { console.log(`   couldn't turn on Community (${e.status}); do it in Server Settings → Enable Community`); }
  }

  // AutoMod
  console.log("AutoMod");
  const exempt = [role.Team, role.Moderator].filter(Boolean);
  const alertTo = byName["mod-log"];
  const rules = [
    { name: "Hashcoin: scam phrases", trigger_type: 1, trigger_metadata: { keyword_filter: SCAM_WORDS },
      actions: [{ type: 1, metadata: { custom_message: "Blocked: this looks like a scam message. The team never asks for seed phrases and never DMs first." } }, { type: 2, metadata: { channel_id: alertTo } }, { type: 3, metadata: { duration_seconds: 600 } }] },
    { name: "Hashcoin: links", trigger_type: 1, trigger_metadata: { regex_patterns: ["https?://", "discord\\.gg/", "discord\\.com/invite"], allow_list: LINK_ALLOW },
      actions: [{ type: 1, metadata: { custom_message: "Links are limited to official sites. See #official-links." } }, { type: 2, metadata: { channel_id: alertTo } }] },
    { name: "Hashcoin: mention spam", trigger_type: 5, trigger_metadata: { mention_total_limit: 5, mention_raid_protection_enabled: true },
      actions: [{ type: 1, metadata: {} }, { type: 2, metadata: { channel_id: alertTo } }, { type: 3, metadata: { duration_seconds: 3600 } }] },
    { name: "Hashcoin: spam", trigger_type: 3, trigger_metadata: {}, actions: [{ type: 1, metadata: {} }, { type: 2, metadata: { channel_id: alertTo } }] },
    { name: "Hashcoin: slurs", trigger_type: 4, trigger_metadata: { presets: [3] }, actions: [{ type: 1, metadata: {} }] },
  ];
  const existing = await api("GET", `/guilds/${guild}/auto-moderation/rules`);
  for (const r of rules) {
    const body = { ...r, event_type: 1, enabled: true, exempt_roles: exempt };
    const found = Array.isArray(existing) ? existing.find((x) => x.name === r.name || (r.trigger_type !== 1 && x.trigger_type === r.trigger_type)) : null;
    try {
      if (found) await api("PATCH", `/guilds/${guild}/auto-moderation/rules/${found.id}`, body); else await api("POST", `/guilds/${guild}/auto-moderation/rules`, body);
      console.log(`   ${found ? "updated" : "created"} ${r.name}`);
    } catch (e) { console.log(`   skipped ${r.name}: ${e.message}`); }
  }

  // Webhook for payout alerts, written straight into payouts.env (never printed).
  console.log("Webhook");
  const hooks = dryRun ? [] : await api("GET", `/channels/${byName.alerts}/webhooks`);
  let hook = hooks.find?.((h) => h.name === "Hashcoin payouts");
  if (!hook) hook = await api("POST", `/channels/${byName.alerts}/webhooks`, { name: "Hashcoin payouts" });
  if (hook?.token) {
    const url = `https://discord.com/api/webhooks/${hook.id}/${hook.token}`;
    const env = path.join(homedir(), ".hashcoin", "payouts.env");
    if (existsSync(env)) {
      const s = readFileSync(env, "utf8");
      const next = /^HASH_ALERT_WEBHOOK=.*$/m.test(s) ? s.replace(/^HASH_ALERT_WEBHOOK=.*$/m, `HASH_ALERT_WEBHOOK=${url}`) : `${s.trimEnd()}\nHASH_ALERT_WEBHOOK=${url}\n`;
      writeFileSync(env, next);
      console.log(`   "Hashcoin payouts" in #alerts; its URL is saved in ${env} (HASH_ALERT_WEBHOOK)`);
    } else console.log(`   "Hashcoin payouts" in #alerts; copy its URL from Server Settings → Integrations → Webhooks into payouts.env`);
  } else if (!dryRun) console.log("   created; copy its URL from Server Settings → Integrations → Webhooks");

  // Posts
  console.log("Posts");
  for (const [name, content] of Object.entries(POSTS)) {
    const id = byName[name];
    const last = dryRun ? [] : await api("GET", `/channels/${id}/messages?limit=1`);
    if (Array.isArray(last) && last.length) { console.log(`   #${name} already has messages; left as is`); continue; }
    await api("POST", `/channels/${id}/messages`, { content, allowed_mentions: { parse: [] } });
    console.log(`   posted in #${name}`);
  }
  console.log(`\nDone${dryRun ? " (dry run)" : ""}. Next: docs/DISCORD-SETUP.md, "After the script".`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
