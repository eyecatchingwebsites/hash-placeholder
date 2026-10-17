#!/usr/bin/env node
// Builds the deployable website into apps/web/dist/ for Cloudflare Pages, and checks it.
// Only the public files are copied (pages, assets, logo files, token metadata, robots, sitemap,
// headers), so scripts, drafts and brand explorations never go online. Node only, no packages.
//
//   node apps/web/scripts/build_pages.mjs            build + check (Cloudflare runs this)
//   node apps/web/scripts/build_pages.mjs --serve    then serve dist/ on http://localhost:8124 the way
//                                                    Cloudflare does (headers, /faq for faq.html, 404 page)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(WEB, "dist");
const PAGES = ["index.html", "calculator.html", "faq.html", "antivirus.html", "404.html"];
const COPY = ["assets", "brand/logo", "token", "robots.txt", "sitemap.xml", "_headers"];
const errors = [];
const fail = (msg) => errors.push(msg);

// ---------- Settings from config.js ----------
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(WEB, "assets/js/config.js"), "utf8"), sandbox);
const cfg = sandbox.window.HASHCOIN;
const site = String(cfg.site ?? "").replace(/\/$/, "");
const api = String(cfg.api ?? "").replace(/\/$/, "");
if (!/^https:\/\/[a-z0-9.-]+$/.test(site)) fail(`config.js site must be https://<domain> (got ${cfg.site})`);
if (api && !/^https:\/\/[a-z0-9.-]+$/.test(api)) fail(`config.js api must be https://<host> (got ${cfg.api})`);
if (cfg.ca != null && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cfg.ca)) fail("config.js ca is not a Solana address");
if (cfg.download != null) {
  const d = cfg.download;
  if (!/^https:\/\//.test(d.url ?? "")) fail("config.js download.url must be an https link");
  if (!/^[0-9a-fA-F]{64}$/.test(d.sha256 ?? "")) fail("config.js download.sha256 must be the installer's 64-character SHA-256");
}
for (const k of ["x", "discord", "github"]) {
  if (cfg[k] != null && !/^https:\/\//.test(cfg[k])) fail(`config.js ${k} must be an https link or null`);
}

// ---------- Copy ----------
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
for (const p of PAGES) cpSync(join(WEB, p), join(DIST, p));
for (const p of COPY) {
  cpSync(join(WEB, p), join(DIST, p), { recursive: true, filter: (src) => !src.endsWith(".md") });
}
// Browsers and crawlers ask for /favicon.ico whatever the page says.
cpSync(join(WEB, "brand/logo/favicon.ico"), join(DIST, "favicon.ico"));

// ---------- Checks ----------
const inDist = (p) => existsSync(join(DIST, p)) && statSync(join(DIST, p)).isFile();
for (const page of PAGES) {
  const html = readFileSync(join(DIST, page), "utf8");
  // Every local file a page uses must be in dist/.
  for (const [, ref] of html.matchAll(/\s(?:src|href)="([^"#?]+)[^"]*"/g)) {
    if (/^(https?:|mailto:|data:)/.test(ref)) continue;
    const path = ref.startsWith("/") ? ref.slice(1) : relative(DIST, resolve(DIST, dirname(page), ref)).replaceAll("\\", "/");
    if (path === "" || /^[a-z0-9-]+$/.test(path)) continue; // "/" or a pretty page URL like "/faq"
    if (!inDist(path)) fail(`${page}: ${ref} is not in the deployed files`);
  }
  if (page === "404.html") continue;
  for (const [, prop, url] of html.matchAll(/<(?:meta property="(og:url|og:image)" content|link rel="(?:canonical)" href)="([^"]+)"/g)) {
    if (!url.startsWith(site + "/")) fail(`${page}: ${prop ?? "canonical"} ${url} is not on ${site}`);
    if (prop === "og:image" && !inDist(url.slice(site.length + 1))) fail(`${page}: og:image ${url} is not in the deployed files`);
  }
  if (!/<link rel="canonical"/.test(html)) fail(`${page}: no canonical link`);
}

const robots = readFileSync(join(DIST, "robots.txt"), "utf8");
if (!robots.includes(`Sitemap: ${site}/sitemap.xml`)) fail(`robots.txt must point to ${site}/sitemap.xml`);
const sitemap = readFileSync(join(DIST, "sitemap.xml"), "utf8");
for (const [, loc] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) if (!loc.startsWith(site + "/")) fail(`sitemap.xml: ${loc} is not on ${site}`);
const headers = readFileSync(join(DIST, "_headers"), "utf8");
if (api && !new RegExp(`connect-src[^;\\n]*${api.replace(/[.]/g, "\\.")}`).test(headers)) fail(`_headers: connect-src must allow ${api}`);

// Token metadata (the --uri for packages/chain/scripts/launch-mainnet.ts).
let token;
try { token = JSON.parse(readFileSync(join(DIST, "token/hash.json"), "utf8")); } catch (e) { fail(`token/hash.json: ${e.message}`); }
if (token) {
  if (token.name !== "Hashcoin" || token.symbol !== "HASH") fail("token/hash.json: name must be Hashcoin and symbol HASH");
  for (const url of [token.image, token.external_url, token.website, token.extensions?.website, ...(token.properties?.files ?? []).map((f) => f.uri)]) {
    if (typeof url !== "string" || !(url === site || url.startsWith(site + "/"))) fail(`token/hash.json: ${url} is not on ${site}`);
  }
  if (!inDist(String(token.image).slice(site.length + 1))) fail(`token/hash.json: image ${token.image} is not in the deployed files`);
  const png = readFileSync(join(DIST, "token/hash.png"));
  if (png.readUInt32BE(16) !== 512 || png.readUInt32BE(20) !== 512) fail("token/hash.png must be 512×512");
  // The X link appears in the metadata only once config.js has it, and must match it.
  for (const tw of [token.twitter, token.extensions?.twitter]) {
    if ((tw ?? null) !== (cfg.x ?? null)) fail(`token/hash.json: the X link (${tw ?? "none"}) must match config.js x (${cfg.x ?? "null"})`);
  }
  if (/\b(guarantee|risk-free|pays for itself|free money)\b/i.test(token.description ?? "")) fail("token/hash.json: the description must not promise returns");
}

if (errors.length) {
  console.error(`build_pages: ${errors.length} problem(s):\n- ` + errors.join("\n- "));
  process.exit(1);
}
const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(d, e.name)) : [e.name]);
console.log(`build_pages: dist/ ready (${files(DIST).length} files) for ${site}, API ${api || "none"}`);

// ---------- Local preview, Cloudflare-style ----------
if (process.argv.includes("--serve")) {
  const port = Number(process.argv[process.argv.indexOf("--serve") + 1]) || 8124;
  // _headers: "<path pattern>" lines followed by indented "Name: value" lines.
  const rules = [];
  for (const line of headers.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) rules.push({ re: new RegExp("^" + line.trim().replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$"), set: {} });
    else { const i = line.indexOf(":"); rules.at(-1).set[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml" };
  createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    for (const r of rules) if (r.re.test(path)) for (const [k, v] of Object.entries(r.set)) res.setHeader(k, v);
    if (path.endsWith(".html")) { res.writeHead(308, { location: path === "/index.html" ? "/" : path.slice(0, -5) }); return res.end(); }
    let file = path === "/" ? "index.html" : path.slice(1);
    if (!extname(file) && inDist(file + ".html")) file += ".html";
    const ok = !file.includes("..") && inDist(file);
    const body = readFileSync(join(DIST, ok ? file : "404.html"));
    res.writeHead(ok ? 200 : 404, { "content-type": types[extname(ok ? file : "x.html")] ?? "application/octet-stream" });
    res.end(body);
  }).listen(port, "127.0.0.1", () => console.log(`serving dist/ on http://localhost:${port}`));
}
