// Home page: topic tabs, earnings (levels auto-cycle until you pick one), level tables,
// the math, the tax-pot simulation and the "Your PC" GPU meter.
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const M = window.HashModel, F = window.hcFmt, GPUS = window.GPUS || [];
  const E = M.ESTIMATE;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const money = (v) => (v > 0 && v < 0.01 ? "<$0.01" : F.usd(v));
  const n2 = (v) => v.toFixed(2);
  const whole = (v) => "$" + Math.round(v).toLocaleString("en-US");
  // Run fn while el is on screen and the tab is visible; stop otherwise.
  function whileVisible(el, onChange) {
    let seen = false;
    const fire = () => onChange(seen && !document.hidden);
    if ("IntersectionObserver" in window) new IntersectionObserver((en) => { seen = en[0].isIntersecting; fire(); }).observe(el);
    else seen = true;
    document.addEventListener("visibilitychange", fire);
    fire();
  }

  // ---------- Topic tabs ----------
  const explore = $("#explore");
  const xtabs = $$(".xtabs [role=tab]");
  const ids = xtabs.map((t) => t.getAttribute("aria-controls"));
  const setHash = (h) => { try { history.replaceState(null, "", h); } catch (e) { /* sandboxed preview */ } };
  const ALIAS = { waitlist: "launch", trust: "launch", status: "launch", mining: "pc", math: "how", main: null };
  function openTab(id) {
    xtabs.forEach((t) => {
      const on = t.getAttribute("aria-controls") === id;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $("#" + t.getAttribute("aria-controls")).hidden = !on;
    });
  }
  // Big screens: the explorer matches the hero's width and scales up as a whole, so a topic
  // fills the screen instead of sitting in a narrow column (see .explore in site.css).
  function fitExplore() {
    const W = window.innerWidth, H = window.innerHeight;
    if (W < 1180) { explore.style.removeProperty("--xz"); explore.style.minHeight = ""; return; }
    const pad = Math.min(72, Math.max(32, W * 0.03));
    const outer = Math.min(W, 2240);
    const z = Math.max(1, Math.min((outer - 2 * pad) / 1240, (H - 64) / 800, 1.45));
    explore.style.setProperty("--xz", z.toFixed(3));
    explore.style.setProperty("--xmax", (outer / z).toFixed(1) + "px");
    explore.style.setProperty("--xpad", (pad / z).toFixed(1) + "px");
    explore.style.minHeight = ((H - 64) / z).toFixed(1) + "px";
  }
  fitExplore();
  let fitT = 0;
  window.addEventListener("resize", () => { clearTimeout(fitT); fitT = setTimeout(fitExplore, 120); });
  function scrollToEl(el) {
    const offset = 64 + 12;
    // getBoundingClientRect, not offsetTop: the explorer is zoomed on big screens.
    const top = el.getBoundingClientRect().top + window.scrollY - (el === explore ? 40 : offset);
    window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  }
  // Returns true when the hash names a topic (or something inside one).
  function route(hash, scroll) {
    const raw = (hash || "").replace(/^#/, "");
    const id = raw in ALIAS ? ALIAS[raw] : raw;
    if (!id || !ids.includes(id)) return false;
    openTab(id);
    if (raw === "math") $("#math").open = true;
    if (scroll) requestAnimationFrame(() => scrollToEl(raw === "math" ? $("#math") : explore));
    return true;
  }
  xtabs.forEach((t, i) => {
    t.addEventListener("click", () => { openTab(t.getAttribute("aria-controls")); setHash("#" + t.getAttribute("aria-controls")); });
    t.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const n = xtabs[(i + d + xtabs.length) % xtabs.length];
      n.click(); n.focus();
    });
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.hasAttribute("data-soon")) return;
    const h = a.getAttribute("href");
    if (route(h, true)) { e.preventDefault(); setHash(h); }
  });
  window.addEventListener("hashchange", () => route(location.hash, true));
  if (location.hash) route(location.hash, true);

  const pct2 = (x) => `${(100 * x).toFixed(2).replace(/\.?0+$/, "")}%`;

  // ---------- Earnings ----------
  const scope = $("#earn-scope");
  const cardsBox = $("#lv-cards");
  const cards = $$(".lv-card", cardsBox);
  const sel = $("#earn-gpu");
  const AUTO_MS = 3400;
  const S = { gpu: hcTopGpu().name, level: reduce ? 2 : 1, bag: 2500, auto: !reduce };
  hcFillGpuSelect(sel, S.gpu);
  sel.addEventListener("change", () => { S.gpu = sel.value; render(); });
  $("#bag").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v >= 0) { S.bag = v; render(); }
  });
  $$("#bag-quick button").forEach((b) => b.addEventListener("click", () => { S.bag = +b.dataset.bag; $("#bag").value = S.bag; render(); }));
  cards.forEach((c, i) => {
    c.addEventListener("click", () => setLevel(+c.dataset.lv, true));
    c.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const n = cards[(i + d + 3) % 3];
      setLevel(+n.dataset.lv, true); n.focus();
    });
  });
  $$("#lvm tbody tr").forEach((tr) => tr.addEventListener("click", () => setLevel(+tr.dataset.l, true)));

  function setLevel(l, byUser) {
    if (byUser) stopAuto();
    S.level = l;
    render();
  }

  // Levels play through on their own until someone picks one, so nobody only sees Level 1.
  let autoTimer = 0, autoOn = false;
  function stopAuto() {
    S.auto = false;
    clearTimeout(autoTimer);
    cardsBox.classList.remove("auto");
    $("#lv-auto").hidden = true;
  }
  function autoTick() { setLevel((S.level % 3) + 1, false); autoTimer = setTimeout(autoTick, AUTO_MS); }
  if (S.auto) {
    cardsBox.style.setProperty("--auto-ms", AUTO_MS + "ms");
    whileVisible(cardsBox, (on) => {
      if (!S.auto || on === autoOn) return;
      autoOn = on;
      clearTimeout(autoTimer);
      cardsBox.classList.toggle("auto", on);
      if (on) autoTimer = setTimeout(autoTick, AUTO_MS);
    });
  } else {
    $("#lv-auto").hidden = true;
  }

  // Numbers glide to their new value instead of jumping.
  function tween(el, to, fmt) {
    const from = el._v == null ? to : el._v;
    el._v = to;
    if (reduce || from === to) { el.textContent = fmt(to); return; }
    const start = performance.now(), dur = 550;
    cancelAnimationFrame(el._raf);
    const step = (now) => {
      const f = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - f, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (f < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  function render() {
    const g = GPUS.find((x) => x.name === S.gpu) || GPUS[0];
    const L = S.level;
    scope.dataset.level = L;
    cards.forEach((c) => c.setAttribute("aria-checked", String(+c.dataset.lv === L)));
    cards.forEach((c) => (c.tabIndex = +c.dataset.lv === L ? 0 : -1));

    // If you mine (M2 and M3 also need a small bag: H1 and H2)
    $("#mine-needs").textContent = ["No buying needed", "Needs $50 held", "Needs $500 held a day"][L - 1];
    const r = M.miner({ myRev: g.rev, level: L });
    const top = M.miner({ myRev: g.rev, level: 3 }).total || 1;
    tween($("#earn-day"), r.total, money);
    tween($("#earn-mine"), r.mining, money);
    tween($("#earn-cut"), r.chestShare, (v) => "+" + money(v));
    $("#sb-mined").style.width = (100 * r.mining) / top + "%";
    $("#sb-tax").style.width = (100 * r.chestShare) / top + "%";

    // If you hold
    const maxH = M.holderLevelFor(S.bag);
    const hl = Math.min(L, maxH);
    const h = M.holder(S.bag, hl);
    tween($("#hold-day"), h.perDay, money);
    $("#hold-sub").innerHTML = hl ? `<b>${h.yieldPct.toFixed(2)}%</b> of your bag a day` : "Hold $50+ to earn";
    $("#hold-flag").innerHTML = maxH && L > maxH
      ? `<p class="flag">Level ${L} needs ${whole(M.HOLDER.usd[L - 1])}+. Shown at Level ${maxH}.</p>` : "";

    // Mine and hold: mined $HASH is part of the bag, so both payouts add up.
    tween($("#both-day"), r.total + h.perDay, money);

    // Level tables
    [1, 2, 3].forEach((l) => {
      const bag = M.HOLDER.usd[l - 1];
      $(`[data-lvh="${l}"]`).innerHTML = `${money(M.holder(bag, l).perDay)}/day<small>on ${whole(bag)}</small>`;
      const x = M.miner({ myRev: g.rev, level: l });
      const mc = $(`[data-lvm="${l}"]`);
      mc.innerHTML = `${money(x.total)}/day<small>${F.mult(x.mult)} its mining</small>`;
      mc.parentElement.classList.toggle("on", l === L);
    });
    $("#lvm-note").textContent = g.name;

    // The math, plugged in
    const mk = r.mk;
    const pl = Math.max(1, hl);
    const hb = M.holder(S.bag, pl);
    $("#plug-gpu").textContent = `${g.name} · M${L} · ${whole(S.bag)} H${pl}`;
    $("#plug-eq").innerHTML =
      `tax rate    = ${pct2(mk.rate)} (lowest that lifts miners to 5× and keeps holders at 1%+)\n` +
      `tax ÷ N     = ${pct2(mk.rate)} × ($${E.volPerGpu} + $${n2(E.avgRev)}) = $${n2(mk.tax)}\n` +
      `dev ÷ N     = ${pct2(mk.devShare)} of it = $${n2(mk.devPerGpu)}\n` +
      `chest ÷ N   = 4 × $${n2(E.avgRev)}, kept within 45–75% of the tax = $${n2(mk.chestPerGpu)}\n` +
      `holders ÷ N = $${n2(mk.tax)} − $${n2(mk.devPerGpu)} − $${n2(mk.chestPerGpu)} = $${n2(mk.holderPerGpu)}\n\n` +
      `your cut    = $${n2(mk.chestPerGpu)} × √${n2(g.rev)} × ${M.MULT[L - 1]} ÷ (√${n2(E.avgRev)} × ${mk.avgMult.toFixed(1)})\n` +
      `            = <b>${money(r.chestShare)}/day</b> + mining ${money(r.mining)} = <b>${money(r.total)}/day</b>\n\n` +
      `your bag    = ${whole(S.bag)} × ${(100 * mk.yieldPerDay[pl - 1]).toFixed(2)}% a day (H${pl})\n` +
      `            = <b>${money(hb.perDay)}/day</b>`;
    $("#plug-note").textContent =
      `Below $${Math.round(mk.targetVolPerGpu)} per GPU even a 5% tax can't lift miners to 5×; above it the tax falls as trading gets busier, never leaving holders under 1% of volume. ` +
      `$${E.volPerGpu} is launch-week trading; later it's usually lower. After launch this is replaced by what each level was actually paid.`;
  }
  render();

  // ---------- How it works: the split balances itself ----------
  const bal = $("#bal-vol");
  if (bal) {
    const LO = 40, HI = 3000; // daily volume per GPU mining, log scale
    const toV = (p) => LO * Math.pow(HI / LO, p / 1000);
    const toP = (v) => Math.round((1000 * Math.log(v / LO)) / Math.log(HI / LO));
    const paintBal = () => {
      const v = toV(+bal.value);
      const mk = M.market({ volPerGpu: v });
      const m = mk.shares.miners, ho = mk.shares.holders, pool = m + ho;
      $("#bal-vol-o").textContent = `${whole(v)} traded per GPU a day`;
      $("#bal-m").style.width = (100 * m) / pool + "%";
      $("#bal-h").style.width = (100 * ho) / pool + "%";
      $("#bal-m-t").textContent = `Miners ${(100 * m).toFixed(0)}%`;
      $("#bal-h-t").textContent = `Holders ${(100 * ho).toFixed(0)}%`;
      const mult = F.mult(1 + mk.chestPerGpu / mk.avgRev);
      $("#bal-note").innerHTML = mk.targetMet
        ? `Tax <b>${pct2(mk.rate)}</b>. Miners are at <b>${mk.chestPerGpu / mk.avgRev > 4.05 ? mult : "5×"}</b> their mining; holders get <b>${pct2(mk.holderRate)}</b> of every trade.`
        : `Tax <b>5%</b>, the most it goes. Miners are at <b>${mult}</b>, under 5×, so they get the max.`;
    };
    bal.value = toP(E.volPerGpu);
    paintBal();
    // Sweeps between quiet and busy on its own until someone drags it.
    let bAuto = !reduce, bOn = false, bRaf = 0, bT0 = 0;
    const sweep = (now) => {
      if (!bT0) bT0 = now;
      bal.value = Math.round(500 - 470 * Math.cos(((now - bT0) / 9000) * 2 * Math.PI + Math.acos((500 - toP(E.volPerGpu)) / 470)));
      paintBal();
      bRaf = requestAnimationFrame(sweep);
    };
    bal.addEventListener("input", () => { bAuto = false; cancelAnimationFrame(bRaf); paintBal(); });
    if (bAuto) whileVisible(bal, (on) => {
      if (!bAuto || on === bOn) return;
      bOn = on;
      cancelAnimationFrame(bRaf);
      if (on) { bT0 = 0; bRaf = requestAnimationFrame(sweep); }
    });
  }

  // ---------- Your PC: GPU meter ----------
  const meter = $("#gpu-meter");
  if (meter) {
    const MODES = [
      { you: 3, hash: 100 },  // idle
      { you: 12, hash: 88 },  // browsing
      { you: 80, hash: 20 },  // gaming
      { you: 95, hash: 5 },   // rendering
    ];
    const modeBtns = $$("#gm-modes button");
    let mode = 0, mAuto = !reduce, mTimer = 0, mOn = false;
    const paint = () => {
      const m = MODES[mode];
      $("#gm-you-bar").style.width = m.you + "%";
      $("#gm-mine-bar").style.width = 100 - m.you + "%";
      $("#gm-hash").textContent = m.hash + "% hashrate";
      modeBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(i === mode)));
    };
    const tick = () => { mode = (mode + 1) % MODES.length; paint(); mTimer = setTimeout(tick, 2600); };
    modeBtns.forEach((b, i) => b.addEventListener("click", () => { mAuto = false; clearTimeout(mTimer); mode = i; paint(); }));
    paint();
    if (mAuto) whileVisible(meter, (on) => {
      if (!mAuto || on === mOn) return;
      mOn = on;
      clearTimeout(mTimer);
      if (on) mTimer = setTimeout(tick, 2600);
    });
  }
  $$("[data-gpu-count]").forEach((e) => (e.textContent = GPUS.length));

  // ---------- Tax-pot simulation ----------
  const trades = $("#sim-trades"), pays = $("#sim-pay");
  if (!trades) return;
  const amountEl = $("#sim-amount"), prog = $("#sim-prog"), next = $("#sim-next"), chestBox = $("#sim-chest");
  const toggle = $("#sim-toggle");
  const mk = M.market();
  const SPLIT_MS = 12000, MAX_ROWS = 9, GPUS_MINING = 400, MCAP = 1_000_000;
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const addr = () => Array.from({ length: 4 }, () => pick(B58)).join("") + "…" + Array.from({ length: 4 }, () => pick(B58)).join("");
  const SAMPLE = ["RTX 4070", "RTX 3060", "RTX 5090", "RX 7900 XTX", "RTX 4060 Laptop", "RTX 4060", "RTX 4090 24GB", "RX 6700 XT", "RTX 4080 Laptop", "Arc A770"]
    .map((n) => GPUS.find((g) => g.name === n)).filter(Boolean);
  const MINER_W = GPUS_MINING * Math.sqrt(E.avgRev) * mk.avgMult;
  const HOLDER_W = MCAP * (mk.holderWeightPerGpu / mk.mcapPerGpu);
  const MINED_PER_SPLIT = (GPUS_MINING * E.avgRev) / 144;
  // The tax the formula sets at the estimate's volume; the pot is what's left after dev's share.
  const POT_PER_TRADE = mk.rate * (1 - mk.devShare);

  let pot = 0, elapsed = 0, last = 0, raf = 0, tradeTimer = 0, visible = true, paused = false;

  function row(list, html) {
    const li = document.createElement("li");
    li.innerHTML = html;
    list.prepend(li);
    while (list.children.length > MAX_ROWS) list.lastElementChild.remove();
  }
  function trade(amount, side, label) {
    const toPot = amount * POT_PER_TRADE;
    pot += toPot;
    row(trades, `<span class="side${side === "Sell" ? " sell" : ""}">${side}</span><span class="amt">${label || F.usd(amount)}</span><span class="to">+${money(toPot)}</span>`);
    amountEl.textContent = money(pot);
  }
  function randomTrade() {
    const big = Math.random() < 0.12;
    const amount = Math.round(big ? rnd(1500, 6000) : Math.exp(rnd(Math.log(30), Math.log(1200))));
    trade(amount, Math.random() < 0.58 ? "Buy" : "Sell");
  }
  function split() {
    const tax = pot / (1 - mk.devShare);
    const chest = Math.min(M.minerMaxAt(mk.rate) * tax, Math.max(M.SHARE.minerMin * tax, (M.TARGET - 1) * MINED_PER_SPLIT));
    const holders = pot - chest;
    const out = [];
    [...SAMPLE].sort(() => Math.random() - 0.5).slice(0, 3).forEach((g) => {
      const level = pick([1, 2, 2, 3]);
      out.push(`<span class="who">${addr()} <small>${g.name} · M${level}</small></span><span class="to">+${money((chest * Math.sqrt(g.rev) * M.MULT[level - 1]) / MINER_W)}</span>`);
    });
    for (let i = 0; i < 2; i++) {
      const hl = pick([1, 2, 2, 3]);
      const bag = Math.round(M.HOLDER.usd[hl - 1] * rnd(1, 2.5));
      out.push(`<span class="who">${addr()} <small>Holder · H${hl} · ${whole(bag)}</small></span><span class="to">+${money((holders * bag * M.MULT[hl - 1]) / HOLDER_W)}</span>`);
    }
    out.sort(() => Math.random() - 0.5).forEach((h) => row(pays, h));
    pot = 0;
    amountEl.textContent = "$0.00";
    chestBox.classList.add("split");
    setTimeout(() => chestBox.classList.remove("split"), 300);
    next.textContent = `Miners ${money(chest)} · holders ${money(holders)}`;
    // Miner payouts are market buys of $HASH, so they pay the tax too.
    setTimeout(() => trade(MINED_PER_SPLIT, "Buy", "miner payouts"), 900);
  }

  function frame(t) {
    raf = 0;
    if (!running()) { last = 0; return; }
    if (last) elapsed += t - last;
    last = t;
    if (elapsed >= SPLIT_MS) { elapsed = 0; split(); }
    prog.style.width = (elapsed / SPLIT_MS) * 100 + "%";
    if (elapsed > 2500) next.textContent = `Next split in ${Math.ceil((SPLIT_MS - elapsed) / 1000)}s`;
    raf = requestAnimationFrame(frame);
  }
  function scheduleTrade() {
    clearTimeout(tradeTimer);
    if (!running()) return;
    tradeTimer = setTimeout(() => { if (running()) randomTrade(); scheduleTrade(); }, rnd(550, 1300));
  }
  const running = () => visible && !paused && !document.hidden && !reduce;
  function kick() {
    if (running()) { if (!raf) raf = requestAnimationFrame(frame); scheduleTrade(); }
    else clearTimeout(tradeTimer);
  }

  // Start with some history so the panel never looks empty.
  for (let i = 0; i < 7; i++) randomTrade();
  split();
  for (let i = 0; i < 4; i++) randomTrade();
  if (reduce) {
    toggle.hidden = true;
    prog.style.width = "40%";
    next.textContent = "Splits every 10 minutes";
    return;
  }
  toggle.addEventListener("click", () => {
    paused = !paused;
    toggle.textContent = paused ? "Play" : "Pause";
    kick();
  });
  whileVisible(chestBox, (on) => { visible = on; kick(); });
})();
