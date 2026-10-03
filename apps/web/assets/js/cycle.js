// Hero loop: five stations in a ring around the Hashcoin coin, joined by chain links.
// One step at a time: the active station plays its animation, then the link to the next
// station draws itself and the next station takes over. Repeats forever.
// Spokes to the coin (buy inflow, 5% tax, pays miners, pays holders) and their labels stay
// visible the whole time; the ones that matter for the current step glow.
// Smoothness: a station that finished keeps its last frame (class "seen") instead of snapping
// back; it's reset only while dimmed, just before its turn. Links fade out instead of vanishing.
// Narrow screens stack the stations in a column. Pauses off-screen and on request; click a
// station or a number to jump; static with reduced motion.
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
  const DWELL_MS = 3600, LINK_MS = 1300, OUT_DELAY_MS = 900;
  const RING_MIN_WIDTH = 560;
  const CAPTIONS = [
    "<b>Press Start.</b> One click on any PC with a graphics card.",
    "<b>Your GPU mines.</b> Only on spare power, on whichever coin pays most.",
    "<b>It buys $HASH.</b> Every miner's earnings are market buys: steady buy inflow.",
    "<b>Paid to your wallet.</b> Every 10 minutes. Mined $HASH is also your bag, so it earns holder rewards at the same time.",
    "<b>Trades pay you extra.</b> 5% of every trade is paid out on top: a miner bonus and holder rewards.",
  ];

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.append(e);
    return e;
  };
  // Spokes between the coin and a station. "in" flows to the coin, "out" flows to the station.
  const SPOKES = { 2: "in", 4: "in", 0: "out", 3: "out" };
  const spokes = {};
  Object.keys(SPOKES).forEach((k) => (spokes[k] = el("path", { class: "cycle-spoke " + SPOKES[k] }, svg)));
  const tags = {};
  root.querySelectorAll(".spoke-tag").forEach((t) => (tags[t.dataset.spoke] = t));
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
  // Cards are laid out at a base width and scaled (CSS --s) so the ring fills big screens.
  const BASE_W = 210;
  function layoutRing(W) {
    root.classList.add("ring");
    root.classList.remove("stack");
    stations.forEach((s) => (s.style.width = BASE_W + "px"));
    const baseH = Math.max(...stations.map((s) => s.offsetHeight));
    const sinA = Math.sin(Math.PI / N), cosB = Math.cos(Math.PI / 10), tall = 1 + Math.cos(Math.PI / 5);
    // Beside the title (wide screens) the ring also has to fit the window height.
    const bar = root.parentElement.querySelector(".cycle-bar");
    const Hav = window.innerWidth >= 1180 ? window.innerHeight - 64 - 48 - (bar ? bar.offsetHeight + 18 : 70) : Infinity;
    const sMax = window.innerWidth >= 1180 ? 2 : 1.1;
    const fit = (k) => {
      const cw = BASE_W * k, ch = baseH * k;
      return Math.min((W - cw - 12) / (2 * cosB), (Hav - ch - 20) / tall);
    };
    // Largest scale that still leaves comfortable room between neighbors.
    let sc = 0.9;
    for (let k = sMax; k >= 0.9; k -= 0.01) {
      if (fit(k) >= (BASE_W * k + 110 * k) / (2 * sinA)) { sc = k; break; }
    }
    const cardW = BASE_W * sc, cardH = baseH * sc;
    root.style.setProperty("--s", sc.toFixed(3));
    const R = Math.max((cardW + 26) / (2 * sinA), fit(sc));
    const cx = W / 2;
    const cy = cardH / 2 + R + 10;
    const angle = (i) => (-90 + i * (360 / N)) * (Math.PI / 180);
    stations.forEach((s, i) => {
      s.style.left = cx + R * Math.cos(angle(i)) + "px";
      s.style.top = cy + R * Math.sin(angle(i)) + "px";
    });
    // Distance from the center to where the ray toward station i enters its card.
    const edge = (i) => {
      const a = angle(i), c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
      return R - Math.min(c > 1e-6 ? cardW / 2 / c : Infinity, s > 1e-6 ? cardH / 2 / s : Infinity);
    };
    // Each label sits on its spoke just outside the card; the coin takes the room that's left.
    const ext = (k) => {
      const a = angle(+k), c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), t = tags[k];
      return Math.min(c > 1e-6 ? t.offsetWidth * sc / 2 / c : Infinity, s > 1e-6 ? t.offsetHeight * sc / 2 / s : Infinity);
    };
    const tagAt = {};
    Object.keys(spokes).forEach((k) => (tagAt[k] = edge(+k) - ext(k) - 3 * sc));
    const room = Math.min(...stations.map((_, i) => edge(i) - 26 * sc), ...Object.keys(spokes).map((k) => tagAt[k] - ext(k) - 6 * sc));
    const coinD = Math.round(Math.min(230 * sc, Math.max(120, 2 * room)));
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
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    links.forEach((lk, i) => {
      const a1 = angle(i), a2 = angle(i + 1);
      const d = `M ${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)} A ${R} ${R} 0 0 1 ${cx + R * Math.cos(a2)} ${cy + R * Math.sin(a2)}`;
      lk.base.setAttribute("d", d);
      lk.lit.setAttribute("d", d);
    });
  }
  function layoutStack(W) {
    root.classList.add("stack");
    root.classList.remove("ring");
    root.style.removeProperty("--s");
    root.style.height = "";
    stations.forEach((s) => { s.style.width = s.style.left = s.style.top = ""; });
    core.style.left = core.style.top = core.style.width = core.style.height = "";
    Object.values(spokes).forEach((sp) => sp.setAttribute("d", ""));
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
  let outTimer = 0, capTimer = 0;
  const reflow = (s) => void s.offsetWidth;

  // Put a station back to its first frame. Only done while it's dimmed.
  function reset(s) {
    s.classList.remove("seen", "on", "prep");
    reflow(s);
  }
  function activate(i, jumped) {
    stations.forEach((s, k) => {
      if (k === i) {
        if (jumped || s.classList.contains("seen")) reset(s);
        s.classList.add("on");
      } else if (s.classList.contains("on")) {
        s.classList.remove("on");
        s.classList.add("seen");
      }
    });
    stepBtns.forEach((b, k) => b.setAttribute("aria-pressed", String(k === i)));
    setCaption(CAPTIONS[i]);
    if (i === 3 && balance) countUp();
    paintSpokes(i);
  }
  function setCaption(html) {
    clearTimeout(capTimer);
    caption.classList.add("swap");
    capTimer = setTimeout(() => { caption.innerHTML = html; caption.classList.remove("swap"); }, 220);
  }
  // Glow the spokes that matter now: inflow on step 3; on step 5 the tax flows in, then out to both sides.
  function paintSpokes(i) {
    clearTimeout(outTimer);
    const hot = (keys) => Object.keys(spokes).forEach((k) => {
      const on = keys.includes(k);
      spokes[k].classList.toggle("hot", on);
      if (tags[k]) tags[k].classList.toggle("hot", on);
    });
    if (i === 2) hot(["2"]);
    else if (i === 3) { hot([]); outTimer = setTimeout(() => hot(["3"]), 1500); }
    else if (i === 4) { hot(["4"]); outTimer = setTimeout(() => hot(["4", "0", "3"]), OUT_DELAY_MS); }
    else if (i !== 3) hot([]);
    core.classList.toggle("pulse", i === 2 || i === 4);
  }
  function countUp() {
    const from = 12840, to = 13057, start = performance.now();
    const tick = (now) => {
      const f = Math.min(1, Math.max(0, (now - start - 500) / 1600));
      const e = 1 - Math.pow(1 - f, 3);
      balance.textContent = Math.round(from + (to - from) * e).toLocaleString("en-US") + " $HASH";
      if (f < 1 && stations[3].classList.contains("on")) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  // The link into the active station stays lit while it plays; the outgoing link draws during the
  // transition. Links that are done fade out through CSS instead of disappearing.
  const ease = (f) => (f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2);
  function paintLinks() {
    links.forEach((lk, i) => {
      let fill = -1;
      if (phase === "link" && i === step) fill = ease(Math.min(1, t / LINK_MS));
      else if (phase === "dwell" && i === (step - 1 + N) % N && lit[i]) fill = 1;
      if (fill >= 0) {
        lk.lit.setAttribute("stroke-dashoffset", String(lk.len * (1 - fill)));
        lk.lit.classList.add("on");
      } else {
        lk.lit.classList.remove("on");
      }
    });
  }
  // lit[i]: link i finished drawing on the way into the current station (not set after a jump).
  const lit = links.map(() => false);
  function go(i) {
    step = i;
    phase = "dwell";
    t = 0;
    lit.fill(false);
    activate(i, true);
    paintLinks();
    if (!reduce) kick();
  }
  function frame(now) {
    raf = 0;
    if (!running()) { last = 0; return; }
    if (last) t += Math.min(64, now - last);
    last = now;
    if (phase === "dwell" && t >= DWELL_MS) {
      phase = "link"; t = 0;
      lit.fill(false);
      // Rewind the next station while it's still dim, so it starts clean when the link arrives.
      // Fade its picture out first so the rewind isn't visible.
      const nx = stations[(step + 1) % N];
      if (nx.classList.contains("seen")) {
        nx.classList.add("prep");
        setTimeout(() => { if (!nx.classList.contains("on")) reset(nx); nx.classList.remove("prep"); }, 320);
      }
    } else if (phase === "link" && t >= LINK_MS) {
      lit[step] = true;
      step = (step + 1) % N;
      phase = "dwell"; t = 0;
      activate(step, false);
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
    let lastH = window.innerHeight, rq = 0;
    window.addEventListener("resize", () => {
      if (window.innerHeight === lastH) return;
      lastH = window.innerHeight;
      cancelAnimationFrame(rq);
      rq = requestAnimationFrame(layout);
    });
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
    stations.forEach((s) => s.classList.add("seen"));
    pauseBtn.hidden = true;
    stepBtns.forEach((b) => (b.hidden = true));
    links.forEach((lk) => { lk.lit.classList.add("on"); lk.lit.setAttribute("stroke-dashoffset", "0"); });
    Object.keys(spokes).forEach((k) => { spokes[k].classList.add("hot"); if (tags[k]) tags[k].classList.add("hot"); });
    caption.innerHTML = "Press Start → your GPU mines → it buys $HASH → paid to your wallet, where it earns holder rewards → 5% of every trade pays miners and holders extra.";
    return;
  }
  go(0);
})();
