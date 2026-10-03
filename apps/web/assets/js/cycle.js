// Hero flywheels. Two rings of five stations around the Hashcoin coin, switched with tabs:
//   1. The coin flywheel: miners buy in, holders hold, trades pay 5%, the split balances, more join.
//   2. Your bag flywheel: you mine, your bag grows, you level up, bigger share, earn on both
//      (one loop per level, Level 1 to 3).
// One step at a time: the active station plays its animation, then the link to the next station
// draws itself and the next station takes over. Spokes to the coin and their labels stay visible;
// the ones that matter for the current step glow. A finished station keeps its last frame and is
// rewound only while dimmed. Until someone picks a tab, the wheels take turns on their own.
// Narrow screens stack the stations in a column. Pauses off-screen and on request; static with
// reduced motion.
(function () {
  "use strict";
  const hero = document.querySelector(".hero-ring");
  if (!hero) return;
  const caption = document.getElementById("cycle-caption");
  const pauseBtn = document.getElementById("cycle-pause");
  const stepsBox = document.getElementById("cycle-steps");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const DWELL_MS = 3600, LINK_MS = 1300;
  const RING_MIN_WIDTH = 560;
  const BASE_W = 210; // cards are laid out at this width and scaled (CSS --s) to fill the space
  const ease = (f) => (f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2);
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const reflow = (s) => void s.offsetWidth;
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.append(e);
    return e;
  };
  // Count a number up on screen while its station is active.
  function countTo(node, from, to, station, show = fmt, delay = 500, dur = 1500) {
    const start = performance.now();
    const tick = (now) => {
      const f = Math.min(1, Math.max(0, (now - start - delay) / dur));
      node.textContent = show(from + (to - from) * (1 - Math.pow(1 - f, 3)));
      if (f < 1 && station.classList.contains("on")) requestAnimationFrame(tick);
      else if (f < 1) node.textContent = show(to);
    };
    requestAnimationFrame(tick);
  }

  // ---------- One flywheel ----------
  function makeWheel(root, cfg) {
    const svg = root.querySelector(".cycle-svg");
    const stations = Array.from(root.querySelectorAll(".st"));
    const core = root.querySelector(".cycle-core");
    const N = stations.length;
    const spokes = {}, tags = {};
    Object.keys(cfg.spokes).forEach((k) => (spokes[k] = el("path", { class: "cycle-spoke " + cfg.spokes[k] }, svg)));
    root.querySelectorAll(".spoke-tag").forEach((t) => (tags[t.dataset.spoke] = t));
    // links[i] joins station i to station i+1 (the last one closes the loop)
    const links = stations.map(() => ({ base: el("path", { class: "cycle-link" }, svg), lit: el("path", { class: "cycle-link-lit" }, svg), len: 0 }));
    const lit = links.map(() => false);
    let step = 0, phase = "dwell", t = 0, last = 0, raf = 0, running = false, hotTimer = 0;
    const W = { root, N, step: () => step, caption: (i) => (cfg.caption && cfg.caption(i)) || cfg.captions[i] };

    // Layout
    const rel = (elm) => {
      const box = root.getBoundingClientRect(), r = elm.getBoundingClientRect();
      return { l: r.left - box.left, t: r.top - box.top, w: r.width, h: r.height, cx: r.left - box.left + r.width / 2, cy: r.top - box.top + r.height / 2 };
    };
    function layoutRing(Wd) {
      root.classList.add("ring");
      root.classList.remove("stack");
      stations.forEach((s) => (s.style.width = BASE_W + "px"));
      const baseH = Math.max(...stations.map((s) => s.offsetHeight));
      const sinA = Math.sin(Math.PI / N), cosB = Math.cos(Math.PI / 10), tall = 1 + Math.cos(Math.PI / 5);
      // Beside the title (wide screens) the ring also has to fit the window height.
      const extra = [".fly-switch", ".cycle-bar", ".fly-note"].reduce((a, q) => { const n = hero.querySelector(q); return a + (n ? n.offsetHeight + 18 : 0); }, 0);
      const Hav = window.innerWidth >= 1180 ? window.innerHeight - 64 - 64 - extra : Infinity;
      const sMax = window.innerWidth >= 1180 ? 2 : 1.1;
      const fit = (k) => Math.min((Wd - BASE_W * k - 12) / (2 * cosB), (Hav - baseH * k - 20) / tall);
      // Largest scale that still leaves comfortable room between neighbors.
      // Prefer roomy gaps (space for the coin and bubbles); on short screens fall back to tighter ones.
      let sc = 0;
      for (const gap of [190, 150, 110]) {
        for (let k = sMax; k >= 0.72; k -= 0.01) if (fit(k) >= (BASE_W * k + gap * k) / (2 * sinA)) { sc = k; break; }
        if (sc) break;
      }
      sc = sc || 0.72;
      const cardW = BASE_W * sc, cardH = baseH * sc;
      root.style.setProperty("--s", sc.toFixed(3));
      const R = Math.max((cardW + 26) / (2 * sinA), fit(sc));
      const cx = Wd / 2, cy = cardH / 2 + R + 10;
      const angle = (i) => (-90 + i * (360 / N)) * (Math.PI / 180);
      stations.forEach((s, i) => { s.style.left = cx + R * Math.cos(angle(i)) + "px"; s.style.top = cy + R * Math.sin(angle(i)) + "px"; });
      // Distance from the center to where the ray toward station i enters its card.
      const edge = (i) => {
        const a = angle(i), c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
        return R - Math.min(c > 1e-6 ? cardW / 2 / c : Infinity, s > 1e-6 ? cardH / 2 / s : Infinity);
      };
      // Each label sits on its spoke just outside the card; the coin takes the room that's left.
      const ext = (k) => {
        const a = angle(+k), c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), tg = tags[k];
        return Math.min(c > 1e-6 ? tg.offsetWidth * sc / 2 / c : Infinity, s > 1e-6 ? tg.offsetHeight * sc / 2 / s : Infinity);
      };
      const tagAt = {};
      Object.keys(spokes).forEach((k) => (tagAt[k] = edge(+k) - ext(k) * 1.1 - 12 * sc));
      const room = Math.min(...stations.map((_, i) => edge(i) - 26 * sc), ...Object.keys(spokes).map((k) => tagAt[k] - ext(k) * 1.1 - 12 * sc));
      const coinD = Math.round(Math.min(230 * sc, Math.max(84, 2 * room)));
      core.style.left = cx + "px";
      core.style.top = cy + "px";
      core.style.width = core.style.height = coinD + "px";
      Object.keys(spokes).forEach((k) => {
        const a = angle(+k), r0 = coinD / 2 + 4;
        spokes[k].setAttribute("d", `M ${cx + r0 * Math.cos(a)} ${cy + r0 * Math.sin(a)} L ${cx + R * Math.cos(a)} ${cy + R * Math.sin(a)}`);
        tags[k].style.left = cx + tagAt[k] * Math.cos(a) + "px";
        tags[k].style.top = cy + tagAt[k] * Math.sin(a) + "px";
      });
      const H = cy + R * Math.sin(angle(2)) + cardH / 2 + 10 * sc;
      root.style.height = H + "px";
      svg.setAttribute("viewBox", `0 0 ${Wd} ${H}`);
      links.forEach((lk, i) => {
        const a1 = angle(i), a2 = angle(i + 1);
        const d = `M ${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)} A ${R} ${R} 0 0 1 ${cx + R * Math.cos(a2)} ${cy + R * Math.sin(a2)}`;
        lk.base.setAttribute("d", d);
        lk.lit.setAttribute("d", d);
      });
    }
    function layoutStack(Wd) {
      root.classList.add("stack");
      root.classList.remove("ring");
      root.style.removeProperty("--s");
      root.style.height = "";
      stations.forEach((s) => { s.style.width = s.style.left = s.style.top = ""; });
      core.style.left = core.style.top = core.style.width = core.style.height = "";
      Object.values(spokes).forEach((sp) => sp.setAttribute("d", ""));
      svg.setAttribute("viewBox", `0 0 ${Wd} ${root.offsetHeight}`);
      const r = stations.map(rel), lane = Wd - 8;
      // Each step's bubble sits on its card's top edge.
      Object.keys(tags).forEach((k) => {
        const c = r[+k];
        if (!c) return;
        tags[k].style.left = c.l + c.w - tags[k].offsetWidth / 2 - 12 + "px";
        tags[k].style.top = c.t + "px";
      });
      links.forEach((lk, i) => {
        const a = r[i], b = r[(i + 1) % N];
        let d;
        if (i < N - 1) d = `M ${a.cx} ${a.t + a.h} L ${b.cx} ${b.t}`;
        else {
          // back to the top along the right edge
          const y1 = a.cy, y2 = b.cy, x0 = a.l + a.w, rr = 12;
          d = `M ${x0} ${y1} L ${lane - rr} ${y1} Q ${lane} ${y1} ${lane} ${y1 - rr} L ${lane} ${y2 + rr} Q ${lane} ${y2} ${lane - rr} ${y2} L ${b.l + b.w} ${y2}`;
        }
        lk.base.setAttribute("d", d);
        lk.lit.setAttribute("d", d);
      });
    }
    W.layout = function () {
      const Wd = root.clientWidth;
      if (!Wd) return;
      if (Wd >= RING_MIN_WIDTH) layoutRing(Wd); else layoutStack(Wd);
      links.forEach((lk) => { lk.len = lk.lit.getTotalLength(); lk.lit.setAttribute("stroke-dasharray", `${lk.len} ${lk.len}`); });
      paintLinks();
    };

    // Step machine
    function reset(s) { s.classList.remove("seen", "on", "prep"); reflow(s); }
    function hot(keys) {
      Object.keys(spokes).forEach((k) => {
        const on = keys.includes(k);
        spokes[k].classList.toggle("hot", on);
        if (tags[k]) tags[k].classList.toggle("hot", on);
      });
    }
    function activate(i, jumped) {
      stations.forEach((s, k) => {
        if (k === i) { if (jumped || s.classList.contains("seen")) reset(s); s.classList.add("on"); }
        else if (s.classList.contains("on")) { s.classList.remove("on"); s.classList.add("seen"); }
      });
      clearTimeout(hotTimer);
      const h = cfg.hot[i] || [[], 0];
      hot([]);
      if (h[0].length) hotTimer = setTimeout(() => hot(h[0]), h[1]);
      core.classList.toggle("pulse", !!cfg.pulse && cfg.pulse.includes(i));
      if (cfg.onStep) cfg.onStep(i, stations[i]);
      W.onStep(i);
    }
    function paintLinks() {
      links.forEach((lk, i) => {
        let fill = -1;
        if (phase === "link" && i === step) fill = ease(Math.min(1, t / LINK_MS));
        else if (phase === "dwell" && i === (step - 1 + N) % N && lit[i]) fill = 1;
        if (fill >= 0) { lk.lit.setAttribute("stroke-dashoffset", String(lk.len * (1 - fill))); lk.lit.classList.add("on"); }
        else lk.lit.classList.remove("on");
      });
    }
    function frame(now) {
      raf = 0;
      if (!running || !W.canRun()) { last = 0; return; }
      if (last) t += Math.min(64, now - last);
      last = now;
      if (phase === "dwell" && t >= DWELL_MS) {
        phase = "link"; t = 0;
        lit.fill(false);
        // Rewind the next station while it's still dim; fade its picture out first.
        const nx = stations[(step + 1) % N];
        if (nx.classList.contains("seen")) {
          nx.classList.add("prep");
          setTimeout(() => { if (!nx.classList.contains("on")) reset(nx); nx.classList.remove("prep"); }, 320);
        }
      } else if (phase === "link" && t >= LINK_MS) {
        lit[step] = true;
        step = (step + 1) % N;
        phase = "dwell"; t = 0;
        if (step === 0 && W.onLoop() === false) return; // the controller switched wheels
        activate(step, false);
      }
      paintLinks();
      raf = requestAnimationFrame(frame);
    }
    W.go = function (i) {
      step = i; phase = "dwell"; t = 0;
      lit.fill(false);
      activate(i, true);
      paintLinks();
      W.kick();
    };
    W.kick = function () { if (running && W.canRun() && !raf) { last = 0; raf = requestAnimationFrame(frame); } };
    W.start = function () { running = true; W.go(0); };
    W.stop = function () {
      running = false;
      cancelAnimationFrame(raf); raf = 0;
      clearTimeout(hotTimer);
      stations.forEach((s) => s.classList.remove("on", "seen", "prep"));
    };
    W.static = function () {
      root.classList.add("static");
      stations.forEach((s) => s.classList.add("seen"));
      links.forEach((lk) => { lk.lit.classList.add("on"); lk.lit.setAttribute("stroke-dashoffset", "0"); });
      hot(Object.keys(spokes));
      if (cfg.onStatic) cfg.onStatic(stations);
    };
    stations.forEach((s, i) => s.addEventListener("click", () => { W.onPick(); W.go(i); }));
    return W;
  }

  // ---------- Flywheel 1: the coin ----------
  const every = (n, ms) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, [[String(i)], ms]]));
  const coin = makeWheel(document.getElementById("fw-coin"), {
    captions: [
      "<b>Miners buy in.</b> Every miner's earnings are swapped into $HASH on the market, around the clock.",
      "<b>Holders hold.</b> Holding longer unlocks bigger rewards, so less gets sold.",
      "<b>Trades fill the reward pot.</b> 5% of every buy and sell goes to miners and holders. More trading, bigger rewards.",
      "<b>Both get paid, every 10 minutes.</b> Miners are topped up to 5× what they mine. Holders share the rest.",
      "<b>More people join.</b> Bigger rewards draw more GPUs and holders, and more buying. Around it goes.",
    ],
    spokes: { 0: "in", 1: "in", 2: "in", 3: "out", 4: "in" },
    hot: Object.assign(every(5, 600), { 3: [["2", "3"], 500] }),
    pulse: [0, 2],
    onStep(i, st) {
      if (i === 4) st.querySelectorAll("[data-count]").forEach((b) => { const [a, z] = b.dataset.count.split(",").map(Number); countTo(b, a, z, st, fmt, 400, 1800); });
    },
    onStatic(sts) { sts[4].querySelectorAll("[data-count]").forEach((b) => (b.textContent = fmt(+b.dataset.count.split(",")[1]))); },
  });

  // ---------- Flywheel 2: your bag, one loop per level ----------
  // Example in dollars from the site's own estimate (assets/js/model.js): an RTX 5090 and a
  // sample bag at each level. Each loop: mining, miner bonus, holder rewards, a week of growth,
  // then the next level (a new color scheme for the whole wheel).
  const bagRoot = document.getElementById("fw-bag");
  const bagCore = bagRoot.querySelector("[data-core-lvl]").parentElement;
  const HM = window.HashModel;
  const gpu = (window.GPUS || []).find((g) => g.name === "RTX 5090") || { rev: 10.71 };
  const usd = (v) => "$" + (v >= 100 ? fmt(v) : v.toFixed(2));
  const EXAMPLE_BAG = [450, 2200, 6000];
  const B = (key) => bagRoot.querySelector(`[data-b="${key}"]`);
  const bagNums = (L) => {
    const r = HM ? HM.miner({ myRev: gpu.rev, level: L }) : { mining: 10.71, chestShare: 9.86 * L, mult: 1.9 };
    const bag = EXAMPLE_BAG[L - 1];
    const h = HM ? HM.holder(bag, L) : { perDay: bag * 0.0088 * L, yieldPct: 0.88 * L };
    return { r, bag, h, week: 7 * (r.total || r.mining + r.chestShare) + 7 * h.perDay };
  };
  let bagLevel = 1, bagTop = false;
  function setBagLevel(l) {
    bagLevel = l;
    bagRoot.dataset.level = l;
    hero.dataset.bagLevel = l;
    bagCore.querySelector("[data-core-lvl]").textContent = "Level " + l;
  }
  function fillBag(L) {
    const n = bagNums(L);
    B("bonus").textContent = "+" + usd(n.r.chestShare);
    B("bonus-sub").textContent = `a day on top (${n.r.mult.toFixed(1)}× mining)`;
    B("hold").textContent = "+" + usd(n.h.perDay);
    B("hold-sub").textContent = `a day on a ${usd(n.bag)} bag (${n.h.yieldPct.toFixed(2)}%)`;
    B("bal").textContent = usd(n.bag);
    B("week").textContent = "+" + usd(n.week);
    B("lvnote").textContent = L < 3 ? `Next: Level ${L + 1}, ${["", "", "2×", "4×"][L + 1]} share` : "Top level: 4× share";
    return n;
  }
  const bag = makeWheel(bagRoot, {
    captions: [
      "<b>You mine.</b> Press Start and your GPU mines on spare power. What it earns becomes $HASH.",
      "<b>Miner bonus.</b> On top of what you mine, you get a bonus from the reward pot. Bigger at higher levels.",
      "<b>Holder rewards.</b> Your whole bag earns holder rewards, including the $HASH you mined.",
      "<b>Your bag grows.</b> Mining, bonus and rewards all land in the same bag, every 10 minutes.",
      "<b>Level up.</b> A bigger bag, held longer, unlocks the next level and a bigger share. Then around again.",
    ],
    caption: (i) => (i === 4 && bagTop ? "<b>Top level.</b> Keep holding to keep Level 3 and its 4× share." : null),
    spokes: { 0: "in", 1: "in", 2: "in", 3: "in", 4: "out" },
    hot: every(5, 700),
    pulse: [3],
    onStep(i, st) {
      if (i === 0) fillBag(bagLevel);
      if (i === 3) {
        const n = bagNums(bagLevel);
        B("bal").textContent = usd(n.bag);
        countTo(B("bal"), n.bag, n.bag + n.week, st, (v) => "$" + fmt(v), 500, 1600);
      }
      if (i === 4) {
        const prev = bagLevel, next = Math.min(3, prev + 1);
        const art = st.querySelector(".art-level");
        art.style.setProperty("--from", ((prev - 1) / 2) * 100 + "%");
        art.style.setProperty("--to", ((next - 1) / 2) * 100 + "%");
        art.dataset.level = next;
        bagTop = prev === 3;
        if (next !== prev) setTimeout(() => {
          setBagLevel(next);
          B("lvnote").textContent = `Level ${next} unlocked: ${next === 2 ? "2×" : "4×"} share`;
        }, 1300);
      }
    },
    onStatic(sts) {
      setBagLevel(3);
      fillBag(3);
      sts[4].querySelector(".art-level").dataset.level = 3;
    },
  });
  // ---------- Controller: tabs, shared caption, steps and pause ----------
  const wheels = [coin, bag];
  const tabs = Array.from(hero.querySelectorAll(".fly-switch [role=tab]"));
  let active = 0, auto = !reduce, paused = false, visible = true, capTimer = 0;
  let stepBtns = [];
  function buildSteps(w) {
    stepsBox.textContent = "";
    stepBtns = Array.from({ length: w.N }, (_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = String(i + 1);
      b.setAttribute("aria-label", `Step ${i + 1}`);
      b.addEventListener("click", () => { pick(); w.go(i); });
      stepsBox.append(b);
      return b;
    });
  }
  function setCaption(html) {
    clearTimeout(capTimer);
    caption.classList.add("swap");
    capTimer = setTimeout(() => { caption.innerHTML = html; caption.classList.remove("swap"); }, 220);
  }
  const pick = () => { auto = false; hero.classList.remove("auto"); };
  wheels.forEach((w, wi) => {
    w.canRun = () => visible && !paused && !document.hidden && !reduce && active === wi;
    w.onPick = pick;
    w.onStep = (i) => {
      stepBtns.forEach((b, k) => b.setAttribute("aria-pressed", String(k === i)));
      setCaption(w.caption(i));
    };
  });
  // The coin wheel plays three times, the bag wheel once per level; then they swap (until someone picks).
  const COIN_TURNS = 3;
  let bagLoop = 0, coinLoop = 0;
  coin.onLoop = () => {
    coinLoop++;
    if (!auto || coinLoop < COIN_TURNS) return true;
    show(1, true);
    return false;
  };
  bag.onLoop = () => {
    bagLoop++;
    if (bagLoop < 3) return true;
    // Level 3 done: back to the coin wheel, and the two take turns again.
    bagLoop = 0;
    auto = !reduce;
    if (auto) hero.classList.add("auto");
    show(0, true);
    return false;
  };
  const note = document.getElementById("fly-note");
  let swapTimer = 0;
  // Crossfade: the old wheel fades and shrinks a touch, the new one fades in.
  function show(i, fade) {
    clearTimeout(swapTimer);
    tabs.forEach((tb, k) => { tb.setAttribute("aria-selected", String(k === i)); tb.tabIndex = k === i ? 0 : -1; });
    const from = wheels[active];
    if (i === 1) hero.dataset.bagLevel = 1;
    if (fade && !reduce && i !== active) {
      from.root.classList.add("leaving");
      caption.classList.add("swap");
      swapTimer = setTimeout(() => { from.root.classList.remove("leaving"); enter(i, true); }, 480);
    } else enter(i, false);
  }
  function enter(i, fade) {
    wheels[active].stop();
    active = i;
    const w = wheels[i];
    wheels.forEach((x, k) => (x.root.hidden = k !== i));
    note.hidden = i !== 1;
    hero.dataset.active = i === 1 ? "bag" : "coin";
    if (i === 1) { bagLoop = 0; setBagLevel(1); fillBag(1); }
    if (i === 0) coinLoop = 0;
    buildSteps(w);
    if (fade) w.root.classList.add("entering");
    w.layout();
    if (reduce) {
      w.static();
      stepBtns.forEach((b) => (b.hidden = true));
      caption.innerHTML = i === 0
        ? "Miners buy in → holders hold → trades fill the reward pot → miners and holders get paid → more people join."
        : "You mine → miner bonus → holder rewards on your whole bag → your bag grows → level up, then around again.";
    } else w.start();
    if (fade) requestAnimationFrame(() => requestAnimationFrame(() => w.root.classList.remove("entering")));
  }
  tabs.forEach((tb, i) => {
    tb.addEventListener("click", () => { pick(); if (i !== active) show(i, true); });
    tb.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = (active + 1) % 2;
      pick(); show(n, true); tabs[n].focus();
    });
  });

  // ---------- Wire up ----------
  const relayout = () => wheels[active].layout();
  if ("ResizeObserver" in window) {
    let lastW = 0;
    new ResizeObserver(() => { if (hero.clientWidth !== lastW) { lastW = hero.clientWidth; relayout(); } }).observe(hero);
    let lastH = window.innerHeight, rq = 0;
    window.addEventListener("resize", () => {
      if (window.innerHeight === lastH) return;
      lastH = window.innerHeight;
      cancelAnimationFrame(rq);
      rq = requestAnimationFrame(relayout);
    });
  } else window.addEventListener("resize", relayout);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((en) => { visible = en[0].isIntersecting; wheels[active].kick(); }, { threshold: 0.05 }).observe(hero);
  }
  document.addEventListener("visibilitychange", () => wheels[active].kick());
  if (reduce) pauseBtn.hidden = true;
  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "Play" : "Pause";
    wheels.forEach((w) => w.root.classList.toggle("paused", paused));
    wheels[active].kick();
  });
  if (auto) hero.classList.add("auto");
  show(0);
})();
