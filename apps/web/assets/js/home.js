// Home page: earnings panel (mining / holding), level tables, the math, tax-pot simulation.
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

  // ---------- Tabs ----------
  const tabs = $$("#earn [role=tab]");
  function showTab(id) {
    tabs.forEach((t) => {
      const on = t.id === id;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $("#" + t.getAttribute("aria-controls")).hidden = !on;
    });
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => showTab(t.id));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        showTab(n.id); n.focus();
      }
    });
  });

  // ---------- State ----------
  const S = { gpu: "RTX 4070", level: 2, bag: 500, hlevel: 2 };
  const mk = M.market();
  const sel = $("#earn-gpu");
  hcFillGpuSelect(sel, S.gpu);
  [...sel.options].forEach((o) => {
    const g = GPUS.find((x) => x.name === o.value);
    if (g) o.textContent = `${g.name} · mines $${g.rev.toFixed(2)}/day`;
  });
  sel.addEventListener("change", () => { S.gpu = sel.value; update(); });
  $$("#earn-level button").forEach((b) => b.addEventListener("click", () => { S.level = +b.dataset.l; update(); }));
  $$("#lvm tbody tr").forEach((tr) => tr.addEventListener("click", () => { S.level = +tr.dataset.l; update(); }));
  $("#bag").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v >= 0) { S.bag = v; S.hlevel = Math.max(1, Math.min(S.hlevel, M.holderLevelFor(v) || 1)); update(); }
  });
  $$("#bag-level button").forEach((b) => b.addEventListener("click", () => { S.hlevel = +b.dataset.h; update(); }));

  function update() {
    const g = GPUS.find((x) => x.name === S.gpu) || GPUS[0];

    // Mining tab
    const r = M.miner({ myRev: g.rev, level: S.level });
    $("#earn-day").textContent = money(r.total);
    $("#earn-sub").innerHTML = `About <b>${money(r.total / 144)}</b> every 10-minute payout.`;
    $("#earn-cut").textContent = money(r.chestShare) + "/day";
    $("#earn-mine").textContent = money(r.mining) + "/day";
    $("#earn-mult").textContent = F.mult(r.mult);
    $("#earn-assume").innerHTML = `Based on <b>$${E.volPerGpu} of daily volume per GPU mining</b>. The average miner gets 5× their mining. ${g.name} at M${S.level}: ${F.mult(r.mult)}.`;
    $$("#earn-level button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.l === S.level)));
    sel.value = g.name;

    // Holding tab
    const maxLevel = M.holderLevelFor(S.bag);
    const h = M.holder(S.bag, S.hlevel);
    $("#hold-day").textContent = money(h.perDay);
    $("#hold-sub").innerHTML = `About <b>${money(h.perDay / 24)}</b> an hour on a ${whole(S.bag)} bag at H${S.hlevel}.`;
    $("#hold-flag").innerHTML = S.hlevel > maxLevel
      ? `<p class="flag">H${S.hlevel} needs a bag of at least ${whole(M.HOLDER.usd[S.hlevel - 1])}. ${maxLevel ? `This bag reaches H${maxLevel}.` : "This bag is below H1, so it earns nothing yet."}</p>` : "";
    $("#hold-assume").innerHTML = `Based on the same <b>$${E.volPerGpu} of volume per GPU</b>: holders get ${F.pct(100 * mk.holderRate)} of volume, at least 1%. H${S.hlevel} also needs ${M.HOLDER.hours[S.hlevel - 1] ? M.HOLDER.hours[S.hlevel - 1] + " hours on the hold clock" : "no hold time"}.`;
    $$("#bag-level button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.h === S.hlevel)));

    // Level tables
    [1, 2, 3].forEach((l) => {
      const hc = $(`[data-lvh="${l}"]`);
      const bag = M.HOLDER.usd[l - 1];
      hc.innerHTML = `${money(M.holder(bag, l).perDay)}/day<small>on ${whole(bag)}</small>`;
      const x = M.miner({ myRev: g.rev, level: l });
      const mc = $(`[data-lv="${l}"]`);
      mc.innerHTML = `${money(x.total)}/day<small>${F.mult(x.mult)} its mining</small>`;
      mc.parentElement.classList.toggle("on", l === S.level);
    });
    $("#lvm-note").textContent = g.name;

    // The math, plugged in
    const m = M.MULT[S.level - 1];
    const hb = M.holder(S.bag, S.hlevel);
    $("#plug-gpu").textContent = `${g.name} · M${S.level} · $${S.bag} H${S.hlevel}`;
    $("#plug-eq").innerHTML =
      `pot ÷ N    = 4.5% × ($${E.volPerGpu} + $${n2(E.avgRev)}) = $${n2(mk.pool)}\n` +
      `chest ÷ N  = min(4 × $${n2(E.avgRev)}, 3.5% × $${n2(mk.base)}) = $${n2(mk.chestPerGpu)}\n` +
      `holders ÷ N = $${n2(mk.pool)} − $${n2(mk.chestPerGpu)} = $${n2(mk.holderPerGpu)}\n\n` +
      `your cut   = $${n2(mk.chestPerGpu)} × √${n2(g.rev)} × ${m} ÷ (√${n2(E.avgRev)} × ${mk.avgMult.toFixed(1)})\n` +
      `           = <b>${money(r.chestShare)}/day</b> + mining ${money(r.mining)} = <b>${money(r.total)}/day</b>\n\n` +
      `your bag   = $${S.bag} × ${(100 * mk.yieldPerDay[S.hlevel - 1]).toFixed(2)}% a day (H${S.hlevel})\n` +
      `           = <b>${money(hb.perDay)}/day</b>`;
    $("#plug-note").textContent =
      `Miners reach 5× once volume per GPU is above $${Math.round(mk.targetVolPerGpu)}. Above that, extra volume goes to holders. ` +
      `Below it, miners get the full 3.5% and holders their 1% minimum, so holder rewards fall first. ` +
      `$${E.volPerGpu} is launch-week trading; later it's usually much lower. After launch, this estimate is replaced by what each level was actually paid in the last 24 hours.`;
  }
  update();

  // ---------- Tax-pot simulation ----------
  const trades = $("#sim-trades"), pays = $("#sim-pay");
  if (!trades) return;
  const amountEl = $("#sim-amount"), prog = $("#sim-prog"), next = $("#sim-next"), chestBox = $("#sim-chest");
  const toggle = $("#sim-toggle");
  const SPLIT_MS = 12000, MAX_ROWS = 9, GPUS_MINING = 400, MCAP = 1_000_000;
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const addr = () => Array.from({ length: 4 }, () => pick(B58)).join("") + "…" + Array.from({ length: 4 }, () => pick(B58)).join("");
  const SAMPLE = ["RTX 4070", "RTX 3060", "RTX 5090", "RX 7900 XTX", "RTX 3080", "RTX 4060", "RTX 4090 24GB", "RX 6700 XT", "RTX 5070 Ti", "Arc A770"]
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
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((en) => { visible = en[0].isIntersecting; kick(); }).observe($("#sim-chest"));
  }
  document.addEventListener("visibilitychange", kick);
  kick();
})();
