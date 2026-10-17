#!/usr/bin/env node
// Moves the website and API to another domain in one go, if hashcoin.app isn't the one bought.
//
//   node apps/web/scripts/set_domain.mjs example.com
//
// Reads the current domain from `site` in apps/web/assets/js/config.js and replaces it (and
// api.<domain>, www.<domain>) in every file that names it. Then run build_pages.mjs to check.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FILES = [
  "apps/web/assets/js/config.js",
  "apps/web/index.html", "apps/web/calculator.html", "apps/web/faq.html", "apps/web/antivirus.html",
  "apps/web/robots.txt", "apps/web/sitemap.xml", "apps/web/_headers", "apps/web/token/hash.json",
  "services/api/src/main.ts",
  "infra/pc/config.template.yml", "infra/pc/setup-tunnel.ps1", "infra/pc/check-api.ps1",
  "docs/HOSTING.md",
];

const next = (process.argv[2] ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(next)) {
  console.error("usage: node apps/web/scripts/set_domain.mjs <domain>   e.g. hashcoin.app");
  process.exit(1);
}
const config = readFileSync(join(ROOT, FILES[0]), "utf8");
const current = /site:\s*"https:\/\/([^"/]+)"/.exec(config)?.[1];
if (!current) { console.error("Couldn't read `site` from config.js"); process.exit(1); }
if (current === next) { console.log(`Already ${next}.`); process.exit(0); }

const re = new RegExp(`(?<![\\w-])${current.replace(/\./g, "\\.")}(?![\\w-])`, "g");
for (const f of FILES) {
  const path = join(ROOT, f);
  let text;
  try { text = readFileSync(path, "utf8"); } catch { continue; }
  const n = (text.match(re) ?? []).length;
  if (!n) continue;
  writeFileSync(path, text.replace(re, next));
  console.log(`${f}: ${n} × ${current} → ${next}`);
}
console.log(`Done. Also set the desktop release variables to the new domain (docs/HOSTING.md), then run:\n  node apps/web/scripts/build_pages.mjs`);
