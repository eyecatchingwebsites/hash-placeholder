// Home page: earnings panel, levels table, chest simulation.
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const M = window.HashModel, F = window.hcFmt, GPUS = window.GPUS || [];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const money = (v) => (v > 0 && v < 0.01 ? "<$0.01" : F.usd(v));

  // ---------- Earnings panel (one estimate: daily volume per GPU) ----------
  const E = M.ESTIMATE;
  const S = { gpu: "RTX 4070", level: 2 };
  const sel = $("#earn-gpu");
  hcFillGpuSelect(sel, S.gpu);
  [...sel.options].forEach((o) => {
    const g = GPUS.find((x) => x.name === o.value);
    if (g) o.textContent = `${g.name} · mines $${g.rev.toFixed(2)}/day`;
  });
  sel.addEventListener("change", () => { S.gpu = sel.value; update(); });
  $$("#earn-level button").forEach((b) => b.addEventListener("click", () => { S.level = +b.dataset.l; update(); }));
  $$(".lv-table tbody tr").forEach((tr) => tr.addEventListener("click", () => { S.level = +tr.dataset.l; update(); }));
  const n2 = (v) => v.toFixed(2);

  function update() {
    const g = GPUS.find((x) => x.name === S.gpu) || GPUS[0];
    const r = M.estimate({ myRev: g.rev, level: S.level });

    $("#earn-day").textContent = money(r.total);
    $("#earn-sub").innerHTML = `About <b>${money(r.total / 144)}</b> every 10-minute payout.`;
    $("#earn-cut").textContent = money(r.chestShare) + "/day";
    $("#earn-mine").textContent = money(r.mining) + "/day";
    $("#earn-share").textContent = F.mult(r.rel) + " the average GPU";
    $("#earn-assume").innerHTML = `Based on <b>$${E.volPerGpu} of daily volume per GPU mining</b>, which puts ${money(r.chestPerGpu)}/day into the chest per GPU.`;
    $("#earn-flag").innerHTML = S.level === 3
      ? `<p class="flag">Level 3 needs 14 days of holding, so it starts two weeks after launch.</p>` : "";
    $$("#earn-level button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.l === S.level)));
    sel.value = g.name;

    // Levels table follows the same GPU.
    const base = M.estimate({ myRev: g.rev, level: 1 });
    [1, 2, 3].forEach((l) => {
      const x = M.estimate({ myRev: g.rev, level: l });
      const cell = $(`[data-lv="${l}"]`);
      cell.innerHTML = `${money(x.total)}/day<small>${l === 1 ? "mining + 1× cut" : "+" + money(x.total - base.total) + " vs Level 1"}</small>`;
      cell.parentElement.classList.toggle("on", l === S.level);
    });
    $("#levels-lede").textContent = `Same GPU, same chest. Your level multiplies your share. Numbers below: ${g.name}, estimated at $${E.volPerGpu} of daily volume per GPU.`;

    // The math, with this GPU plugged in.
    const m = M.MULT[S.level - 1];
    const chestPer = (M.CHEST / 100) * (E.volPerGpu + E.avgRev);
    $("#plug-gpu").textContent = `${g.name} · Level ${S.level}`;
    $("#plug-eq").innerHTML =
      `cut = 2.5% × ($${E.volPerGpu} + $${n2(E.avgRev)}) × √${n2(g.rev)} × ${m} ÷ (√${n2(E.avgRev)} × ${E.avgMult})\n` +
      `    = $${n2(chestPer)} × ${Math.sqrt(g.rev).toFixed(3)} × ${m} ÷ ${(Math.sqrt(E.avgRev) * E.avgMult).toFixed(3)}\n` +
      `    = <b>${money(r.chestShare)}/day</b>\n\n` +
      `+ mining     ${money(r.mining)}/day\n` +
      `= total      <b>${money(r.total)}/day</b>`;
  }
  update();

  // ---------- Chest simulation ----------
  const trades = $("#sim-trades"), pays = $("#sim-pay");
  if (!trades) return;
  const amountEl = $("#sim-amount"), prog = $("#sim-prog"), next = $("#sim-next"), chestBox = $("#sim-chest");
  const toggle = $("#sim-toggle");
  const SPLIT_MS = 12000, MAX_ROWS = 9, GPUS_MINING = 400;
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const addr = () => Array.from({ length: 4 }, () => pick(B58)).join("") + "…" + Array.from({ length: 4 }, () => pick(B58)).join("");
  const SAMPLE = ["RTX 4070", "RTX 3060", "RTX 5090", "RX 7900 XTX", "RTX 3080", "RTX 4060", "RTX 4090 24GB", "RX 6700 XT", "RTX 5070 Ti", "Arc A770"]
    .map((n) => GPUS.find((g) => g.name === n)).filter(Boolean);
  // Approximate total weight of 400 GPUs averaging $2.50/day with a typical level mix (avg multiplier ~1.6).
  const TOTAL_W = GPUS_MINING * Math.sqrt(2.5) * 1.6;

  let chest = 0, elapsed = 0, last = 0, raf = 0, tradeTimer = 0, visible = true, paused = false;

  function row(list, html) {
    const li = document.createElement("li");
    li.innerHTML = html;
    list.prepend(li);
    while (list.children.length > MAX_ROWS) list.lastElementChild.remove();
  }
  function trade(amount, side, label) {
    const toChest = amount * 0.025;
    chest += toChest;
    row(trades, `<span class="side${side === "Sell" ? " sell" : ""}">${side}</span><span class="amt">${label || F.usd(amount)}</span><span class="to">+${money(toChest)}</span>`);
    amountEl.textContent = money(chest);
  }
  function randomTrade() {
    const big = Math.random() < 0.12;
    const amount = Math.round(big ? rnd(1500, 6000) : Math.exp(rnd(Math.log(30), Math.log(1200))));
    trade(amount, Math.random() < 0.58 ? "Buy" : "Sell");
  }
  function split() {
    const paid = chest;
    const picks = [...SAMPLE].sort(() => Math.random() - 0.5).slice(0, 5);
    picks.reverse().forEach((g) => {
      const level = pick([1, 2, 2, 3]);
      const cut = (paid * Math.sqrt(g.rev) * M.MULT[level - 1]) / TOTAL_W;
      row(pays, `<span class="who">${addr()} <small>${g.name} · L${level}</small></span><span class="to">+${money(cut)}</span>`);
    });
    chest = 0;
    amountEl.textContent = "$0.00";
    chestBox.classList.add("split");
    setTimeout(() => chestBox.classList.remove("split"), 300);
    next.textContent = `Split between ${GPUS_MINING} GPUs`;
    // Miner payouts are market buys of $HASH, so they pay the tax too.
    setTimeout(() => trade((GPUS_MINING * 2.5) / 144, "Buy", "miner payouts"), 900);
  }

  function frame(t) {
    raf = 0;
    if (!running()) { last = 0; return; }
    if (last) elapsed += t - last;
    last = t;
    if (elapsed >= SPLIT_MS) { elapsed = 0; split(); }
    prog.style.width = (elapsed / SPLIT_MS) * 100 + "%";
    if (elapsed > 1500) next.textContent = `Next split in ${Math.ceil((SPLIT_MS - elapsed) / 1000)}s`;
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
  next.textContent = reduce ? "Splits every 10 minutes" : "Next split soon";

  if (reduce) {
    toggle.hidden = true;
    prog.style.width = "40%";
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
