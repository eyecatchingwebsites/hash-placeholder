// Hero loop: five stations in a ring around the Hashcoin coin, joined by chain links.
// One step at a time: the active station plays its animation, then the link to the next
// station lights up from end to end and the next station takes over. Repeats forever.
// Narrow screens stack the stations in a column with the same links. Pauses off-screen
// and on request; click a station or a number to jump; static with reduced motion.
(function () {
  "use strict";
  const root = document.getElementById("cycle");
  if (!root) return;
  const svg = root.querySelector(".cycle-svg");
  const stations = Array.from(root.querySelectorAll(".st"));
  const core = root.querySelector(".cycle-core");
  const caption = document.getElementById("cycle-caption");
  const pauseBtn = document.getElementById("cycle-pause");
  const stepsBox = document.getElementById("cycle-steps");
  const balance = root.querySelector("[data-bal]");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const N = stations.length;
  const DWELL_MS = 3400, LINK_MS = 1000;
  const RING_MIN_WIDTH = 900;
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
  // links[i] joins station i to station i+1 (the last one closes the loop)
  const links = stations.map(() => ({
    base: el("path", { class: "cycle-link" }, svg),
    lit: el("path", { class: "cycle-link-lit" }, svg),
    len: 0,
  }));

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

  // ---------- Layout ----------
  function rel(elm) {
    const box = root.getBoundingClientRect(), r = elm.getBoundingClientRect();
    return { l: r.left - box.left, t: r.top - box.top, w: r.width, h: r.height, cx: r.left - box.left + r.width / 2, cy: r.top - box.top + r.height / 2 };
  }
  function layoutRing(W) {
    root.classList.add("ring");
    root.classList.remove("stack");
    const cardW = Math.min(290, Math.max(240, W * 0.25));
    stations.forEach((s) => (s.style.width = cardW + "px"));
    const cardH = Math.max(...stations.map((s) => s.offsetHeight));
    const R = Math.min(W / 2 - cardW / 2 - 4, Math.max(300, cardW * 1.18));
    const cx = W / 2;
    const cy = cardH / 2 + R + 8;
    const angle = (i) => (-90 + i * (360 / N)) * (Math.PI / 180);
    stations.forEach((s, i) => {
      s.style.left = cx + R * Math.cos(angle(i)) + "px";
      s.style.top = cy + R * Math.sin(angle(i)) + "px";
    });
    core.style.left = cx + "px";
    core.style.top = cy + "px";
    const H = cy + R * Math.sin(angle(2)) + cardH / 2 + 8;
    root.style.height = H + "px";
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    links.forEach((lk, i) => {
      const a1 = angle(i), a2 = angle(i + 1);
      const p1 = { x: cx + R * Math.cos(a1), y: cy + R * Math.sin(a1) };
      const p2 = { x: cx + R * Math.cos(a2), y: cy + R * Math.sin(a2) };
      const d = `M ${p1.x} ${p1.y} A ${R} ${R} 0 0 1 ${p2.x} ${p2.y}`;
      lk.base.setAttribute("d", d);
      lk.lit.setAttribute("d", d);
    });
  }
  function layoutStack(W) {
    root.classList.add("stack");
    root.classList.remove("ring");
    root.style.height = "";
    stations.forEach((s) => { s.style.width = s.style.left = s.style.top = ""; });
    core.style.left = core.style.top = "";
    const H = root.offsetHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const r = stations.map(rel);
    const lane = W - 8;
    links.forEach((lk, i) => {
      const a = r[i], b = r[(i + 1) % N];
      let d;
      if (i < N - 1) {
        d = `M ${a.cx} ${a.t + a.h} L ${b.cx} ${b.t}`;
      } else {
        // back to the top along the right edge
        const y1 = a.cy, y2 = b.cy, x0 = a.l + a.w, rr = 12;
        d = `M ${x0} ${y1} L ${lane - rr} ${y1} Q ${lane} ${y1} ${lane} ${y1 - rr} L ${lane} ${y2 + rr} Q ${lane} ${y2} ${lane - rr} ${y2} L ${b.l + b.w} ${y2}`;
      }
      lk.base.setAttribute("d", d);
      lk.lit.setAttribute("d", d);
    });
  }
  function layout() {
    const W = root.clientWidth;
    if (!W) return;
    if (W >= RING_MIN_WIDTH) layoutRing(W);
    else layoutStack(W);
    links.forEach((lk) => {
      lk.len = lk.lit.getTotalLength();
      lk.lit.setAttribute("stroke-dasharray", `${lk.len} ${lk.len}`);
    });
    paintLinks();
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
  // The link into the active station stays lit while it plays; the outgoing link fills during the transition.
  function paintLinks() {
    links.forEach((lk, i) => {
      let fill = 0;
      if (phase === "link" && i === step) {
        const f = Math.min(1, t / LINK_MS);
        fill = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      } else if (phase === "dwell" && i === (step - 1 + N) % N && t < DWELL_MS) {
        fill = 1;
      }
      lk.lit.setAttribute("stroke-dashoffset", String(lk.len * (1 - fill)));
      lk.lit.style.opacity = fill > 0 ? 1 : 0;
    });
  }
  function go(i) {
    step = i;
    phase = "dwell";
    t = 0;
    activate(i);
    paintLinks();
    if (!reduce) kick();
  }
  function frame(now) {
    raf = 0;
    if (!running()) { last = 0; return; }
    if (last) t += now - last;
    last = now;
    if (phase === "dwell" && t >= DWELL_MS) {
      phase = "link"; t = 0;
    } else if (phase === "link" && t >= LINK_MS) {
      step = (step + 1) % N;
      phase = "dwell"; t = 0;
      activate(step);
    }
    paintLinks();
    raf = requestAnimationFrame(frame);
  }
  const running = () => visible && !paused && !document.hidden && !reduce;
  function kick() { if (running() && !raf) { last = 0; raf = requestAnimationFrame(frame); } }

  // ---------- Wire up ----------
  if ("ResizeObserver" in window) {
    let lastW = 0;
    new ResizeObserver(() => { if (root.clientWidth !== lastW) { lastW = root.clientWidth; layout(); } }).observe(root);
  } else {
    window.addEventListener("resize", layout);
  }
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
    stepBtns.forEach((b) => (b.hidden = true));
    links.forEach((lk) => { lk.lit.style.opacity = 1; lk.lit.setAttribute("stroke-dashoffset", "0"); });
    caption.innerHTML = "Press Start → your GPU mines → it buys $HASH → paid to your wallet → every trade pays 5% back to miners and holders.";
    return;
  }
  go(0);
})();
