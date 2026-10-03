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
      if (on) t.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }
  function scrollToEl(el) {
    const offset = 64 + $(".xbar").offsetHeight + 12;
    const top = el === explore ? explore.offsetTop - 64 : el.getBoundingClientRect().top + window.scrollY - offset;
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

  // ---------- Earnings ----------
  const scope = $("#earn-scope");
  const cardsBox = $("#lv-cards");
  const cards = $$(".lv-card", cardsBox);
  const sel = $("#earn-gpu");
  const AUTO_MS = 3400;
  const S = { gpu: "RTX 4070", level: reduce ? 2 : 1, bag: 2500, auto: !reduce };
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

    // If you mine
    const r = M.miner({ myRev: g.rev, level: L });
    const top = M.miner({ myRev: g.rev, level: 3 }).total || 1;
    tween($("#earn-day"), r.total, money);
    tween($("#earn-mine"), r.mining, money);
    tween($("#earn-cut"), r.chestShare, (v) => "+" + money(v));
    $("#sb-mined").style.width = (100 * r.mining) / top + "%";
    $("#sb-tax").style.width = (100 * r.chestShare) / top + "%";
    $("[data-pill=M]").textContent = "M" + L;
    $("#earn-sub").innerHTML = `<b>${F.mult(r.mult)}</b> what the ${g.name} mines on its own. Paid in $HASH every 10 minutes.${g.est ? " Laptop figure estimated from desktop data." : ""}`;

    // If you hold
    const maxH = M.holderLevelFor(S.bag);
    const hl = Math.min(L, maxH);
    const h = M.holder(S.bag, hl);
    tween($("#hold-day"), h.perDay, money);
    $("[data-pill=H]").textContent = hl ? "H" + hl : "H–";
    $("#hold-sub").innerHTML = hl ? `<b>${h.yieldPct.toFixed(2)}%</b> of your bag a day. Paid in $HASH.` : "Hold $50 or more to earn.";
    $("#hold-flag").innerHTML = maxH && L > maxH
      ? `<p class="flag">Level ${L} needs a ${whole(M.HOLDER.usd[L - 1])} bag. Yours counts as Level ${maxH}.</p>` : "";

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
      `pot ÷ N     = 4.5% × ($${E.volPerGpu} + $${n2(E.avgRev)}) = $${n2(mk.pool)}\n` +
      `chest ÷ N   = min(4 × $${n2(E.avgRev)}, 3.5% × $${n2(mk.base)}) = $${n2(mk.chestPerGpu)}\n` +
      `holders ÷ N = $${n2(mk.pool)} − $${n2(mk.chestPerGpu)} = $${n2(mk.holderPerGpu)}\n\n` +
      `your cut    = $${n2(mk.chestPerGpu)} × √${n2(g.rev)} × ${M.MULT[L - 1]} ÷ (√${n2(E.avgRev)} × ${mk.avgMult.toFixed(1)})\n` +
      `            = <b>${money(r.chestShare)}/day</b> + mining ${money(r.mining)} = <b>${money(r.total)}/day</b>\n\n` +
      `your bag    = ${whole(S.bag)} × ${(100 * mk.yieldPerDay[pl - 1]).toFixed(2)}% a day (H${pl})\n` +
      `            = <b>${money(hb.perDay)}/day</b>`;
    $("#plug-note").textContent =
      `Miners reach 5× once volume per GPU is above $${Math.round(mk.targetVolPerGpu)}. Below that, holder rewards shrink first, down to 1%. ` +
      `$${E.volPerGpu} is launch-week trading; later it's usually lower. After launch this is replaced by what each level was actually paid.`;
  }
  render();

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

  let pot = 0, elapsed = 0, last = 0, raf = 0, tradeTimer = 0, visible = true, paused = false;

  function row(list, html) {
    const li = document.createElement("li");
    li.innerHTML = html;
    list.prepend(li);
    while (list.children.length > MAX_ROWS) list.lastElementChild.remove();
  }
  function trade(amount, side, label) {
    const toPot = amount * (M.TAX - M.DEV);
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
    const chest = Math.min((M.TARGET - 1) * MINED_PER_SPLIT, pot * (M.CHEST_MAX / (M.TAX - M.DEV)));
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
