// Hero loop, one step at a time: the active station lights up and plays its animation,
// then a $HASH coin carries the loop to the next station. Repeats forever.
// Pauses off-screen and on request; click a station or a number to jump; static with reduced motion.
(function () {
  "use strict";
  const root = document.getElementById("cycle");
  if (!root) return;
  const svg = root.querySelector(".cycle-svg");
  const stations = Array.from(root.querySelectorAll(".st"));
  const caption = document.getElementById("cycle-caption");
  const pauseBtn = document.getElementById("cycle-pause");
  const stepsBox = document.getElementById("cycle-steps");
  const balance = root.querySelector("[data-bal]");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const DWELL_MS = 3400, TRAVEL_MS = 900;
  const CAPTIONS = [
    "<b>1. Press Start.</b> One click on the gaming PC you already have. No mining experience needed.",
    "<b>2. Your GPU mines.</b> The app picks whichever coin pays your graphics card most right now.",
    "<b>3. It buys $HASH.</b> What you mine is sold and swapped into $HASH on the open market: steady buy inflow.",
    "<b>4. Paid to your wallet.</b> Every 10 minutes. Hold it to reach H1–H3 and M2–M3; selling shrinks your hold clock.",
    "<b>5. Every trade pays 5%.</b> Up to 3.5% tops miners up toward 5× their mining; at least 1% goes to holders. Then it loops.",
  ];

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.append(e);
    return e;
  };
  const glow = el("path", { class: "cycle-track-glow" }, svg);
  const track = el("path", { class: "cycle-track" }, svg);
  // The coin draws above the cards so it stays visible while it travels.
  const fx = el("svg", { class: "cycle-fx", "aria-hidden": "true", focusable: "false" });
  root.append(fx);
  const coin = el("g", { class: "cycle-coin" }, fx);
  el("circle", { r: 10 }, coin);
  const coinText = el("text", { "text-anchor": "middle", "dominant-baseline": "central" }, coin);
  coinText.textContent = "#";

  const stepBtns = stations.map((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = String(i + 1);
    b.setAttribute("aria-label", `Step ${i + 1}`);
    b.addEventListener("click", () => go(i));
    stepsBox.append(b);
    return b;
  });
  stations.forEach((s, i) => s.addEventListener("click", () => go(i)));

  // ---------- Path through the station centers, with elbows and rounded corners ----------
  let L = 0, stops = [];
  function centers() {
    const box = root.getBoundingClientRect();
    return stations.map((s) => {
      const r = s.getBoundingClientRect();
      return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
    });
  }
  function roundedPath(pts, rad) {
    const n = pts.length;
    let d = "";
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y), d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const r = Math.min(rad, d1 / 2, d2 / 2);
      const a = { x: p1.x + ((p0.x - p1.x) / d1) * r, y: p1.y + ((p0.y - p1.y) / d1) * r };
      const b = { x: p1.x + ((p2.x - p1.x) / d2) * r, y: p1.y + ((p2.y - p1.y) / d2) * r };
      d += (i === 0 ? `M ${a.x} ${a.y}` : ` L ${a.x} ${a.y}`) + ` Q ${p1.x} ${p1.y} ${b.x} ${b.y}`;
    }
    return d + " Z";
  }
  function layout() {
    const box = root.getBoundingClientRect();
    if (!box.width) return;
    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    fx.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    const c = centers();
    const pts = [];
    const oneColumn = c.every((p) => Math.abs(p.x - c[0].x) < 2);
    for (let i = 0; i < c.length; i++) {
      const p = c[i], q = c[(i + 1) % c.length];
      pts.push(p);
      if (oneColumn && i === c.length - 1) {
        const lane = box.width - 8; // return lane down the right edge
        pts.push({ x: lane, y: p.y }, { x: lane, y: q.y });
      } else if (Math.abs(p.x - q.x) > 2 && Math.abs(p.y - q.y) > 2) {
        pts.push({ x: q.x, y: p.y });
      }
    }
    const d = roundedPath(pts, 28);
    track.setAttribute("d", d);
    glow.setAttribute("d", d);
    L = track.getTotalLength();
    // Where along the path each station sits (nearest sampled point to its center).
    const samples = 600;
    stops = c.map((p) => {
      let best = 0, bestD = Infinity;
      for (let k = 0; k < samples; k++) {
        const q = track.getPointAtLength((k / samples) * L);
        const dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (dd < bestD) { bestD = dd; best = (k / samples) * L; }
      }
      return best;
    });
    placeCoin();
  }

  // ---------- Step machine ----------
  let step = 0, phase = "dwell", t = 0, last = 0, raf = 0, visible = true, paused = false;

  function activate(i) {
    stations.forEach((s, k) => {
      s.classList.remove("on");
      if (k === i) { void s.offsetWidth; s.classList.add("on"); } // restart its CSS animations
    });
    stepBtns.forEach((b, k) => b.setAttribute("aria-pressed", String(k === i)));
    caption.innerHTML = CAPTIONS[i];
    if (i === 3 && balance) countUp();
  }
  function countUp() {
    const from = 12840, to = 13043, start = performance.now();
    const tick = (now) => {
      const f = Math.min(1, (now - start - 600) / 1200);
      balance.textContent = Math.round(from + (to - from) * Math.max(0, f)).toLocaleString("en-US") + " $HASH";
      if (f < 1 && stations[3].classList.contains("on")) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function placeCoin() {
    if (!L || !stops.length) return;
    let at;
    if (phase === "travel") {
      const a = stops[step], b0 = stops[(step + 1) % stops.length];
      const b = b0 <= a ? b0 + L : b0;
      const f = Math.min(1, t / TRAVEL_MS);
      const ease = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      at = (a + (b - a) * ease) % L;
    } else {
      at = stops[step];
    }
    const p = track.getPointAtLength(at);
    coin.setAttribute("transform", `translate(${p.x} ${p.y})`);
    coin.style.opacity = phase === "travel" ? 1 : 0;
  }
  function go(i) {
    step = i;
    phase = "dwell";
    t = 0;
    activate(i);
    placeCoin();
    if (!reduce) kick();
  }
  function frame(now) {
    raf = 0;
    if (!running()) { last = 0; return; }
    if (last) t += now - last;
    last = now;
    if (phase === "dwell" && t >= DWELL_MS) {
      phase = "travel"; t = 0;
      stations[step].classList.remove("on");
    } else if (phase === "travel" && t >= TRAVEL_MS) {
      step = (step + 1) % stations.length;
      phase = "dwell"; t = 0;
      activate(step);
    }
    placeCoin();
    raf = requestAnimationFrame(frame);
  }
  const running = () => visible && !paused && !document.hidden && !reduce;
  function kick() { if (running() && !raf) { last = 0; raf = requestAnimationFrame(frame); } }

  // ---------- Wire up ----------
  if ("ResizeObserver" in window) new ResizeObserver(layout).observe(root);
  else window.addEventListener("resize", layout);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((en) => { visible = en[0].isIntersecting; kick(); }, { threshold: 0.05 }).observe(root);
  }
  document.addEventListener("visibilitychange", kick);
  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "Play" : "Pause";
    root.classList.toggle("paused", paused);
    kick();
  });

  layout();
  if (reduce) {
    root.classList.add("static");
    pauseBtn.hidden = true;
    coin.style.display = "none";
    stepBtns.forEach((b) => (b.hidden = true));
    caption.innerHTML = "Press Start → your GPU mines → it buys $HASH → paid to your wallet → every trade pays 5% back to miners and holders.";
    return;
  }
  go(0);
})();
