// Browser check for the home page at common screen sizes (Playwright + Chromium).
//
//   cd apps/web && python3 -m http.server 8123      # in one terminal
//   node apps/web/scripts/check_site.mjs             # in another (from the repo root)
//
// Needs Playwright: `npm i -g playwright && npx playwright install chromium` (or set
// PLAYWRIGHT_PATH to a folder that has it). For each size it checks that:
//   - the hero fits the window (desktop hero height == window height - 64px header)
//   - the flywheel caption bar keeps one height on every step of both wheels (no jumping)
//   - there's no horizontal scroll and no page errors
// and saves screenshots of the hero and every topic tab to apps/web/.shots/.
// Options: BASE=http://localhost:8123  SIZES=1440x900,2560x1300  SHOTS=0 (skip screenshots)
import { createRequire } from "module";
import { mkdirSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
// Node doesn't search the global npm folder on its own, so try it explicitly.
let globalPw;
try { globalPw = path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"); } catch { /* npm not on PATH */ }
let pw;
for (const where of [process.env.PLAYWRIGHT_PATH, "playwright", globalPw, "/opt/node-tools/node_modules/playwright"]) {
  if (!where) continue;
  try { pw = require(where); break; } catch { /* try the next one */ }
}
if (!pw) { console.error("Playwright not found. Install it: npm i -g playwright && npx playwright install chromium"); process.exit(1); }

const BASE = process.env.BASE || "http://localhost:8123";
const SIZES = (process.env.SIZES || "390x844,1280x720,1440x900,1920x1080,2048x1050,2560x1300").split(",").map((s) => s.split("x").map(Number));
const SHOTS = process.env.SHOTS !== "0";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".shots");
if (SHOTS) mkdirSync(OUT, { recursive: true });
// Cloud sessions reach Google Fonts through a proxy; locally there's usually none.
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,localhost,127.0.0.1" } : undefined;
const browser = await pw.chromium.launch({ proxy });
let failed = 0;

for (const [w, h] of SIZES) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, ignoreHTTPSErrors: true })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const tag = `${w}x${h}`;
  const notes = [];
  const fonts = await page.evaluate(() => document.fonts.check("800 16px Manrope"));
  if (!fonts) notes.push("Manrope didn't load (system font fallback; sizes may differ)");
  if (SHOTS) await page.screenshot({ path: path.join(OUT, `${tag}-hero.png`) });

  const desktop = w >= 1180;
  if (desktop) {
    const [hero, avail] = await page.evaluate(() => [document.querySelector(".hero").offsetHeight, innerHeight - 64]);
    if (hero > avail) { failed++; notes.push(`FAIL hero is ${hero}px, window has ${avail}px`); }
    const bars = new Set();
    for (const wheel of ["#fw-coin-tab", "#fw-bag-tab"]) {
      await page.click(wheel);
      await page.waitForTimeout(700);
      for (let i = 1; i <= 5; i++) {
        await page.click(`#cycle-steps button:nth-child(${i})`);
        await page.waitForTimeout(450);
        bars.add(await page.evaluate(() => document.querySelector(".cycle-bar").offsetHeight));
      }
    }
    if (bars.size > 1) { failed++; notes.push(`FAIL caption bar changes height: ${[...bars].join("/")}px`); }
  }

  if (SHOTS) {
    for (const t of ["earn", "how", "levels", "token", "pc", "launch", "faq"]) {
      await page.click(`#t-${t}`);
      await page.evaluate(() => window.scrollTo(0, document.getElementById("explore").getBoundingClientRect().top + scrollY - 64));
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `${tag}-${t}.png`) });
    }
  }
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  if (sw > cw) { failed++; notes.push(`FAIL horizontal scroll (${sw} > ${cw})`); }
  if (errors.length) { failed++; notes.push("FAIL page errors: " + errors.join(" | ")); }
  console.log(`${tag}: ${notes.length ? notes.join("; ") : "ok"}`);
  await page.close();
}
await browser.close();
if (SHOTS) console.log("screenshots in apps/web/.shots/");
process.exit(failed ? 1 : 0);
