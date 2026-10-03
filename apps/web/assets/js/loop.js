// The Hashcoin loop: GPU → convert → fee → chest → paid, with light travelling around it.
// Usage: HashLoop(rootEl, { caption, controls, onStep }). Root needs class "loop".
window.HASH_STEPS = [
  {
    key: "mine", short: "Mine", title: "Your GPU mines",
    desc: "The best-paying coin for your card: PRL, QUAN or QTC.",
    caption: "<b>Mine.</b> Press Start. Your GPU mines whichever coin pays that card most right now, chosen per card by the server.",
    icon: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="9" cy="12" r="3"/><path d="M15 10h3.5M15 14h3.5M6 18v2.5M18 18v2.5"/>',
  },
  {
    key: "convert", short: "Convert", title: "Converted to $HASH",
    desc: "Mined coins are sold and the proceeds buy $HASH on the market.",
    caption: "<b>Convert.</b> What you mine is sold, and the proceeds buy $HASH on the open market. Every miner payout starts as a market buy.",
    icon: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  },
  {
    key: "fee", short: "3% fee", title: "Every trade pays 3%",
    desc: "A Token-2022 fee on every $HASH transfer, on every exchange.",
    caption: "<b>Fee.</b> Every $HASH transfer pays 3%. The token program enforces it in every pool, aggregator and wallet, so it can't be traded around.",
    icon: '<path d="M18.5 5.5l-13 13"/><circle cx="7" cy="7" r="2.6"/><circle cx="17" cy="17" r="2.6"/>',
  },
  {
    key: "chest", short: "Chest", title: "2.5% fills the chest",
    desc: "Shared among miners every epoch, by GPU earnings and level.",
    caption: "<b>Chest.</b> 2.5% goes into the miner chest and 0.5% funds development. The chest is shared among miners by GPU earnings and level.",
    icon: '<path d="M3 10.5h18V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 10.5V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2.5"/><path d="M10 10.5v3h4v-3"/>',
  },
  {
    key: "paid", short: "Paid", title: "You're paid",
    desc: "Your mining plus your chest share, in $HASH, about every 10 minutes.",
    caption: "<b>Paid.</b> About every 10 minutes you receive your mining value plus your chest share, in $HASH. Then the loop runs again.",
    icon: '<path d="M3.5 7.5a2 2 0 0 1 2-2H18v3"/><rect x="3.5" y="7.5" width="17" height="12" rx="2"/><circle cx="16" cy="13.5" r="1.3"/>',
  },
];
window.HASH_ARC_TAGS = ["PRL · QUAN · QTC", "market buy", "2.5% to chest", "√earnings × level", "every ~10 min"];

window.HashLoop = function (root, opts = {}) {
  const STEPS = window.HASH_STEPS, TAGS = window.HASH_ARC_TAGS, N = STEPS.length;
  const NS = "http://www.w3.org/2000/svg";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const compact = root.dataset.variant === "compact";
  const logo = root.dataset.logo || "brand/logo/hashcoin-mark.svg";
  const PERIOD = 13000; // ms per lap

  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.append(e);
    return e;
  };

  // ---------- Build ----------
  const svg = el("svg", { class: "loop-svg", "aria-hidden": "true", focusable: "false" });
  const track = el("path", { class: "loop-track" }, svg);
  const inner = el("path", { class: "loop-track-dash" }, svg);
  const spokes = [0, 1].map(() => {
    const g = el("g", {}, svg);
    return { base: el("line", { class: "loop-spoke" }, g), flow: el("line", { class: "loop-spoke-flow" }, g) };
  });
  const TRAIL = [
    { len: 0.2, w: 2, o: 0.1 },
    { len: 0.1, w: 2.5, o: 0.28 },
    { len: 0.045, w: 3, o: 0.6 },
    { len: 0.015, w: 4, o: 1 },
  ];
  const comets = [0, 0.5].map((off) => {
    const g = el("g", { class: "comet-g" }, svg);
    const parts = TRAIL.map((t) => el("path", { class: "comet", "stroke-width": t.w, opacity: t.o }, g));
    const halo = el("circle", { r: 11, fill: "#EBB447", opacity: 0.18 }, g);
    const head = el("circle", { r: 3.6, fill: "#FFE3A3" }, g);
    return { off, parts, halo, head };
  });
  root.append(svg);

  const core = document.createElement("div");
  core.className = "loop-core";
  core.innerHTML = `<span class="core-ring"></span><img src="${logo}" alt="" width="200" height="200"><span class="core-label">$HASH</span>`;
  root.append(core);

  const nodes = STEPS.map((s, i) => {
    const n = document.createElement("div");
    n.className = "node";
    n.dataset.num = "0" + (i + 1);
    n.innerHTML = `<div class="node-dot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s.icon}</svg></div>
      <div class="node-text"><span class="node-num">0${i + 1}</span><span class="node-title">${s.title}</span><span class="node-short">${s.short}</span>${compact ? "" : `<span class="node-desc">${s.desc}</span>`}</div>`;
    root.append(n);
    return n;
  });
  const tags = compact ? [] : TAGS.map((t) => {
    const e = document.createElement("span");
    e.className = "arc-tag";
    e.textContent = t;
    root.append(e);
    return e;
  });

  // Controls: one button per step plus pause.
  let stepBtns = [], pauseBtn = null;
  if (opts.controls) {
    STEPS.forEach((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = String(i + 1);
      b.setAttribute("aria-label", `Step ${i + 1}: ${s.title}`);
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => jumpTo(i, true));
      opts.controls.append(b);
      stepBtns.push(b);
    });
    pauseBtn = document.createElement("button");
    pauseBtn.type = "button";
    pauseBtn.className = "pause";
    pauseBtn.addEventListener("click", () => { userPaused = !userPaused; syncPause(); kick(); });
    opts.controls.append(pauseBtn);
  }

  // ---------- Layout ----------
  let L = 0, cx = 0, cy = 0, segs = [], coreR = 0;
  function layout() {
    const W = root.clientWidth, H = root.clientHeight;
    if (!W || !H) return;
    const wide = W / H > 1.2 && W >= 900;
    root.classList.toggle("is-wide", wide);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    cx = W / 2;
    cy = wide ? H * 0.52 : H / 2;
    const rx = wide ? W * 0.29 : W * 0.36;
    const ry = wide ? H * 0.33 : H * 0.36;
    const d = (a, b) => `M ${cx} ${cy - b} A ${a} ${b} 0 1 1 ${cx} ${cy + b} A ${a} ${b} 0 1 1 ${cx} ${cy - b}`;
    track.setAttribute("d", d(rx, ry));
    inner.setAttribute("d", d(rx * 0.7, ry * 0.7));
    comets.forEach((c) => c.parts.forEach((p) => p.setAttribute("d", d(rx, ry))));
    L = track.getTotalLength();
    coreR = core.offsetWidth / 2;
    const scale = Math.max(0.7, Math.min(1.2, L / 2400));
    comets.forEach((c) => {
      c.halo.setAttribute("r", 11 * scale);
      c.head.setAttribute("r", 3.6 * scale);
    });

    segs = [];
    nodes.forEach((n, i) => {
      const s = (L * i) / N;
      segs.push(s);
      const p = track.getPointAtLength(s);
      n.style.left = (p.x / W) * 100 + "%";
      n.style.top = (p.y / H) * 100 + "%";
      const a = (Math.atan2((p.y - cy) / ry, (p.x - cx) / rx) * 180) / Math.PI;
      let side = "below";
      if (wide) side = a < -60 && a > -120 ? "top" : a >= -60 && a < 30 ? "right" : a >= 30 && a <= 150 ? "bottom" : "left";
      n.dataset.side = side;
    });
    tags.forEach((t, i) => {
      const p = track.getPointAtLength((L * (i + 0.5)) / N);
      t.style.left = (p.x / W) * 100 + "%";
      t.style.top = (p.y / H) * 100 + "%";
    });

    // Spokes: convert node → core (the market buy), core → fee node (trading).
    const dot = nodes[0].querySelector(".node-dot").offsetWidth / 2 + 6;
    const spokeLine = (sp, from, to, r1, r2) => {
      const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
      const a = { x: from.x + (dx / len) * r1, y: from.y + (dy / len) * r1 };
      const b = { x: to.x - (dx / len) * r2, y: to.y - (dy / len) * r2 };
      [sp.base, sp.flow].forEach((l) => {
        l.setAttribute("x1", a.x); l.setAttribute("y1", a.y); l.setAttribute("x2", b.x); l.setAttribute("y2", b.y);
      });
    };
    const c = { x: cx, y: cy };
    spokeLine(spokes[0], track.getPointAtLength(segs[1]), c, dot, coreR + 10);
    spokeLine(spokes[1], c, track.getPointAtLength(segs[2]), coreR + 10, dot);
    draw();
  }

  // ---------- Animation ----------
  let pos = 0.5, last = 0, raf = 0, visible = true, userPaused = false, step = -1;
  const litTimers = new Map();

  function light(i) {
    const n = nodes[i];
    n.classList.add("lit");
    clearTimeout(litTimers.get(n));
    if (!isStatic()) litTimers.set(n, setTimeout(() => n.classList.remove("lit"), 2200));
  }
  function setStep(i) {
    if (i === step) return;
    step = i;
    if (isStatic()) nodes.forEach((n, k) => n.classList.toggle("lit", k === i));
    else light(i);
    tags.forEach((t, k) => t.classList.toggle("lit", k === i));
    stepBtns.forEach((b, k) => b.setAttribute("aria-pressed", String(k === i)));
    if (opts.caption) opts.caption.innerHTML = STEPS[i].caption;
    if (i === 1 || i === 4) {
      core.classList.remove("pulse");
      void core.offsetWidth;
      core.classList.add("pulse");
    }
    if (opts.onStep) opts.onStep(i);
  }

  function draw() {
    if (!L) return;
    comets.forEach((c, ci) => {
      const head = (((pos + c.off * L) % L) + L) % L;
      TRAIL.forEach((t, k) => {
        const len = t.len * L;
        c.parts[k].setAttribute("stroke-dasharray", `${len} ${L - len}`);
        c.parts[k].setAttribute("stroke-dashoffset", String(-(head - len)));
      });
      const p = track.getPointAtLength(head);
      c.halo.setAttribute("cx", p.x); c.halo.setAttribute("cy", p.y);
      c.head.setAttribute("cx", p.x); c.head.setAttribute("cy", p.y);
      // Nodes light as any comet passes them; the caption follows the first comet.
      const idx = Math.floor(head / (L / N)) % N;
      if (ci === 0) setStep(idx);
      else if (c.lastIdx !== idx && !isStatic()) light(idx);
      c.lastIdx = idx;
    });
  }

  function frame(t) {
    raf = 0;
    if (!running()) { last = 0; return; }
    if (last && L) pos = (pos + ((t - last) / PERIOD) * L) % L;
    last = t;
    draw();
    raf = requestAnimationFrame(frame);
  }
  const isStatic = () => reduce.matches;
  const running = () => visible && !userPaused && !document.hidden && !isStatic();
  function kick() { if (running() && !raf) { last = 0; raf = requestAnimationFrame(frame); } }

  function syncPause() {
    root.classList.toggle("is-static", isStatic());
    if (pauseBtn) {
      pauseBtn.hidden = isStatic();
      pauseBtn.textContent = userPaused ? "Play" : "Pause";
      pauseBtn.setAttribute("aria-label", userPaused ? "Play the animation" : "Pause the animation");
    }
    comets.forEach((c) => (c.parts[0].parentNode.style.display = isStatic() ? "none" : ""));
    if (isStatic()) nodes.forEach((n, i) => n.classList.toggle("lit", i === step));
  }

  function jumpTo(i, fromUser) {
    if (!segs.length) return;
    pos = segs[i] + 1;
    step = -1;
    if (isStatic()) nodes.forEach((n) => n.classList.remove("lit"));
    if (fromUser && !isStatic() && !userPaused) last = 0;
    draw();
    if (isStatic()) setStep(i);
  }

  // ---------- Wire up ----------
  if ("ResizeObserver" in window) new ResizeObserver(layout).observe(root);
  else window.addEventListener("resize", layout);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((en) => { visible = en[0].isIntersecting; kick(); }, { threshold: 0.05 }).observe(root);
  }
  document.addEventListener("visibilitychange", kick);
  (reduce.addEventListener ? reduce.addEventListener("change", () => { syncPause(); kick(); }) : null);

  layout();
  syncPause();
  if (step < 0) setStep(0);
  kick();

  return { jumpTo, get step() { return step; } };
};
