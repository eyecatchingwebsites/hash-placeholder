// Renders the promo film (index.html) to an MP4, frame by frame, with Playwright and ffmpeg.
//   node apps/promo/render.mjs                  -> apps/promo/out/hashcoin-promo.mp4 (1920x1080, 60 fps, motion blur)
//   node apps/promo/render.mjs --stills 1,8.6   -> PNG stills at those seconds, for checking
//   node apps/promo/render.mjs --fps 30 --sub 1 -> quicker draft, no motion blur
// Motion blur: each output frame blends --sub sub-frames spread over half a frame (a 180° shutter).
// Needs Playwright (global install is fine) and ffmpeg: on PATH, or set FFMPEG to its path
// (for example the binary from the ffmpeg-static npm package).
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
let pw;
try { pw = require("playwright"); } catch { pw = require(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright")); }

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const fps = Number(arg("--fps", 60));
const sub = Math.max(1, Number(arg("--sub", 4)));
const stills = arg("--stills", null);
const out = path.join(here, "out");
mkdirSync(out, { recursive: true });

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(pathToFileURL(path.join(here, "index.html")).href);
await page.evaluate(async () => { await document.fonts.load("700 100px Inter"); await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode())); });
const duration = await page.evaluate(() => window.DURATION);
console.log("duration", duration);

if (stills) {
  for (const s of stills.split(",").map(Number)) {
    await page.evaluate((x) => window.seek(x), s);
    await page.screenshot({ path: path.join(out, `still-${s.toFixed(2)}.png`) });
  }
  console.log(`stills in ${out}`, errors.length ? "ERRORS " + errors.join(" | ") : "");
} else {
  const file = path.join(out, "hashcoin-promo.mp4");
  const blur = sub > 1 ? ["-vf", `tmix=frames=${sub},select='eq(mod(n,${sub}),${sub - 1})'`, "-fps_mode", "cfr", "-r", String(fps)] : [];
  const ff = spawn(process.env.FFMPEG || "ffmpeg", [
    "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps * sub), "-c:v", sub > 1 ? "mjpeg" : "png", "-i", "-",
    ...blur, "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const total = Math.round(duration * fps);
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    for (let k = 0; k < sub; k++) {
      const t = (i + (sub > 1 ? (k / sub) * 0.5 : 0)) / fps;
      await page.evaluate((x) => window.seek(x), t);
      const img = await page.screenshot(sub > 1 ? { type: "jpeg", quality: 95 } : { type: "png" });
      if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    if (i % fps === 0) process.stdout.write(`\r${(i / fps).toFixed(0)}s / ${duration}s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log(`\nwrote ${file} in ${((Date.now() - started) / 1000).toFixed(0)}s`, errors.length ? "ERRORS " + errors.join(" | ") : "");
}
await browser.close();
