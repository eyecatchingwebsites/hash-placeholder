// Renders the promo film (index.html) to an MP4, frame by frame, with Playwright and ffmpeg.
//   node apps/promo/render.mjs                  -> apps/promo/out/hashcoin-promo.mp4 (1920x1080, 60 fps, motion blur)
//   node apps/promo/render.mjs --stills 1,8.6   -> PNG stills at those seconds, for checking
//   node apps/promo/render.mjs --fps 30 --sub 1 -> quicker draft, no motion blur
//   add --no-music for a silent render (the music file and its offset are window.MUSIC in index.html)
//   node apps/promo/render.mjs --mix-only        -> redo just the sound over the last rendered picture
// The picture renders to out/video.mp4; the music and sound effects (window.SFX) are then mixed onto it.
// Motion blur: each output frame blends --sub sub-frames spread over half a frame (a 180° shutter).
// Needs Playwright (global install is fine) and ffmpeg: on PATH, or set FFMPEG to its path
// (for example the binary from the ffmpeg-static npm package).
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { mkdirSync, existsSync } from "fs";
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
const music = process.argv.includes("--no-music") ? null : await page.evaluate(() => window.MUSIC || null);
const sfx = process.argv.includes("--no-sfx") ? null : await page.evaluate(() => window.SFX || null);
console.log("duration", duration, music ? `music ${music.file} from ${music.start}s` : "no music");

const ffmpeg = (args, opts = {}) => spawn(process.env.FFMPEG || "ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: ["pipe", "inherit", "inherit"], ...opts });
const done = (p) => new Promise((r, j) => p.on("close", (c) => (c ? j(new Error("ffmpeg exited " + c)) : r())));
const video = path.join(out, "video.mp4"), file = path.join(out, "hashcoin-promo.mp4");

// The sound: music from music.start (faded in and out) plus every effect at its frame, under the music.
async function mix() {
  if (!music && !sfx) return done(ffmpeg(["-i", video, "-c", "copy", "-movflags", "+faststart", file]));
  const inputs = ["-i", video], chains = [], mixIn = [];
  if (music) {
    inputs.push("-ss", String(music.start), "-i", path.join(here, music.file));
    chains.push(`[1:a]aformat=sample_rates=48000:channel_layouts=stereo[mus]`);
    mixIn.push("[mus]");
  }
  if (sfx) {
    // One input per cue: simpler for ffmpeg than splitting a shared input into many delayed branches.
    sfx.cues.forEach((c, i) => {
      const f = sfx.files[c.id], idx = inputs.filter((x) => x === "-i").length;
      inputs.push("-i", path.join(here, sfx.dir, f.file));
      const ms = Math.max(0, Math.round((c.t - f.hit) * 1000));
      const chain = [
        "aformat=sample_rates=48000:channel_layouts=stereo",
        f.len ? `atrim=0:${f.len},afade=t=out:st=${(f.len * 0.6).toFixed(2)}:d=${(f.len * 0.4).toFixed(2)}` : null,
        f.reverse ? "areverse" : null,
        c.lowpass ? `lowpass=f=${c.lowpass}` : null,
        `volume=${c.gain}dB`, `adelay=${ms}|${ms}`,
      ].filter(Boolean).join(",");
      chains.push(`[${idx}:a]${chain}[c${i}]`);
      mixIn.push(`[c${i}]`);
    });
  }
  const fadeOut = music ? music.fadeOut : 1.5, fadeIn = music ? music.fadeIn : 0;
  if (process.env.MIXDEBUG) console.log(inputs.join(" "), "\n", chains.join(";\n"));
  chains.push(`${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=longest,atrim=0:${duration},afade=t=in:d=${fadeIn},afade=t=out:st=${(duration - fadeOut).toFixed(2)}:d=${fadeOut},alimiter=limit=0.95[aout]`);
  await done(ffmpeg([...inputs, "-filter_complex", chains.join(";"), "-map", "0:v", "-map", "[aout]", "-dn", "-map_chapters", "-1", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-t", String(duration), "-movflags", "+faststart", file]));
  console.log(`wrote ${file}${music ? " with music" : ""}${sfx ? ` and ${sfx.cues.length} sound effects` : ""}`);
}

if (stills) {
  for (const s of stills.split(",").map(Number)) {
    await page.evaluate((x) => window.seek(x), s);
    await page.screenshot({ path: path.join(out, `still-${s.toFixed(2)}.png`) });
  }
  console.log(`stills in ${out}`, errors.length ? "ERRORS " + errors.join(" | ") : "");
} else if (process.argv.includes("--mix-only")) {
  if (!existsSync(video)) throw new Error(`no ${video}: render the picture first`);
  await mix();
} else {
  const blur = sub > 1 ? ["-vf", `tmix=frames=${sub},select='eq(mod(n,${sub}),${sub - 1})'`, "-fps_mode", "cfr", "-r", String(fps)] : [];
  const ff = ffmpeg(["-f", "image2pipe", "-framerate", String(fps * sub), "-c:v", sub > 1 ? "mjpeg" : "png", "-i", "-",
    ...blur, "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video]);
  const total = Math.round(duration * fps);
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    for (let k = 0; k < sub; k++) {
      const t = (i + (sub > 1 ? (k / sub) * 0.5 : 0)) / fps;
      await page.evaluate((x) => window.seek(x), t);
      const img = await page.screenshot(sub > 1 ? { type: "jpeg", quality: 95 } : { type: "png" });
      if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    if (i % fps === 0) process.stdout.write(`
${(i / fps).toFixed(0)}s / ${duration}s`);
  }
  ff.stdin.end();
  await done(ff);
  console.log(`
wrote ${video} in ${((Date.now() - started) / 1000).toFixed(0)}s`, errors.length ? "ERRORS " + errors.join(" | ") : "");
  await mix();
}
await browser.close();
