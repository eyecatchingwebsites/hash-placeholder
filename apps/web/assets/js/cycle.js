// Hero loop: $HASH coins travel through the five stations (PC → GPU → buy → wallet → trades → back).
// Each station lights up as a coin passes and the caption follows. Pauses off-screen and on request;
// static with reduced motion.
(function () {
  "use strict";
  const root = document.getElementById("cycle");
  if (!root) return;
  const svg = root.querySelector(".cycle-svg");
  const stations = Array.from(root.querySelectorAll(".st"));
  const caption = document.getElementById("cycle-caption");
  const pauseBtn = document.getElementById("cycle-pause");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const LAP_MS = 16000, COINS = 3;
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
  const coins = Array.from({ length: COINS }, (_, i) => {
    const g = el("g", { class: "cycle-coin" }, svg);
    el("circle", { r: 9 }, g);
    const t = el("text", { "text-anchor": "middle", "dominant-baseline": "central" }, g);
    t.textContent = "#";
    return { g, off: i / COINS, last: -1 };
  });

  // ---------- Path through the station centers, with elbows and rounded corners ----------
  let L = 0;
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
    const c = centers();
    const pts = [];
    const oneColumn = c.every((p) => Math.abs(p.x - c[0].x) < 2);
    for (let i = 0; i < c.length; i++) {
      const p = c[i], q = c[(i + 1) % c.length];
      pts.push(p);
      if (oneColumn && i === c.length - 1) {
        // return lane down the right edge
        const lane = box.width - 8;
        pts.push({ x: lane, y: p.y }, { x: lane, y: q.y });
      } else if (Math.abs(p.x - q.x) > 2 && Math.abs(p.y - q.y) > 2) {
        pts.push({ x: q.x, y: p.y }); // elbow: across, then up or down
      }
    }
    const d = roundedPath(pts, 28);
    track.setAttribute("d", d);
    glow.setAttribute("d", d);
    L = track.getTotalLength();
    draw();
  }

  // ---------- Animation ----------
  let pos = 0, last = 0, raf = 0, visible = true, paused = false, step = -1;
  const lit = new Map();
  function light(i) {
    const s = stations[i];
    s.classList.add("on");
    clearTimeout(lit.get(s));
    lit.set(s, setTimeout(() => s.classList.remove("on"), 1800));
  }
  function setCaption(i) {
    if (i === step) return;
    step = i;
    caption.innerHTML = CAPTIONS[i];
  }
  const rects = () => {
    const box = root.getBoundingClientRect();
    return stations.map((s) => {
      const r = s.getBoundingClientRect();
      return { l: r.left - box.left, t: r.top - box.top, r: r.right - box.left, b: r.bottom - box.top };
    });
  };
  let cached = null;
  function draw() {
    if (!L) return;
    cached = cached || rects();
    coins.forEach((c, ci) => {
      const p = track.getPointAtLength((((pos / LAP_MS + c.off) % 1) * L));
      c.g.setAttribute("transform", `translate(${p.x} ${p.y})`);
      const inside = cached.findIndex((r) => p.x > r.l && p.x < r.r && p.y > r.t && p.y < r.b);
      if (inside >= 0 && inside !== c.last) {
        light(inside);
        if (ci === 0) setCaption(inside);
      }
      if (inside >= 0) c.last = inside;
    });
  }
  function frame(t) {
    raf = 0;
    if (!running()) { last = 0; return; }
    if (last) pos += t - last;
    last = t;
    draw();
    raf = requestAnimationFrame(frame);
  }
  const running = () => visible && !paused && !document.hidden && !reduce;
  function kick() { if (running() && !raf) { last = 0; raf = requestAnimationFrame(frame); } }

  // ---------- Wire up ----------
  const relayout = () => { cached = null; layout(); };
  if ("ResizeObserver" in window) new ResizeObserver(relayout).observe(root);
  else window.addEventListener("resize", relayout);
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
  setCaption(0);
  if (reduce) {
    pauseBtn.hidden = true;
    coins.forEach((c) => (c.g.style.display = "none"));
    caption.innerHTML = "Press Start → your GPU mines → it buys $HASH → paid to your wallet → every trade pays 5% back to miners and holders.";
    return;
  }
  kick();
})();
