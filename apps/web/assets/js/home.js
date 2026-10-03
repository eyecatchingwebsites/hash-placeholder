// Home page: the two loops, levels, simple calculator, GPU list.
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const M = window.HashModel, F = window.hcFmt, GPUS = window.GPUS || [];
  const EX = M.EXAMPLE;
  const EX_GPU = GPUS.find((g) => g.name === "RTX 4070") || GPUS[0];

  // ---------- Loops ----------
  const hero = $("#hero-loop");
  if (hero) HashLoop(hero, { caption: $("#hero-caption"), controls: $("#hero-controls") });

  const howRoot = $("#how-loop");
  const steps = $$("#how-steps .step");
  if (howRoot) {
    const how = HashLoop(howRoot, {
      onStep: (i) => steps.forEach((s, k) => s.classList.toggle("lit", k === i)),
    });
    steps.forEach((s, i) => {
      s.addEventListener("click", () => how.jumpTo(i, true));
      s.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); how.jumpTo(i, true); }
      });
    });
  }

  const exampleText =
    `Example only. ${EX_GPU.name} mining $${EX_GPU.rev.toFixed(2)}/day (hashrate.no, Oct 3, 2026). ` +
    `Example market: ${F.usd(EX.vol)} of $HASH traded per day and ${EX.miners} miners averaging $${EX.avgRev.toFixed(2)}/day, ` +
    `${EX.p2}% at Level 2 and ${EX.p3}% at Level 3. Real payouts depend on live volume and miner count and can be much lower. Only the 1 : 2 : 4 ratio is fixed.`;

  // ---------- Levels ----------
  const stops = $$(".ladder-stop");
  const cards = $$(".level");
  const fill = $("#ladder-fill");
  function selectLevel(l) {
    stops.forEach((b) => {
      const n = +b.dataset.level;
      b.setAttribute("aria-pressed", String(n === l));
      b.classList.toggle("on", n <= l);
    });
    cards.forEach((c) => c.setAttribute("aria-current", String(+c.dataset.level === l)));
    if (fill) fill.style.width = [100 / 6, 50, 500 / 6][l - 1] + "%";
  }
  stops.forEach((b) => b.addEventListener("click", () => selectLevel(+b.dataset.level)));
  cards.forEach((c) => c.addEventListener("mouseenter", () => selectLevel(+c.dataset.level)));
  selectLevel(2);

  const base = M.run({ ...EX, myRev: EX_GPU.rev, level: 1 });
  $$("[data-example]").forEach((box) => {
    const l = +box.dataset.example;
    const r = M.run({ ...EX, myRev: EX_GPU.rev, level: l });
    box.innerHTML = `
      <span class="label-example">Example · ${EX_GPU.name}</span>
      <table>
        <tr><td>Mining</td><td>${F.usd(r.mining)}/day</td></tr>
        <tr><td>Chest share</td><td>+${F.usd(r.chestShare)}/day</td></tr>
        <tr class="total"><td>Total</td><td>${F.usd(r.total)}/day</td></tr>
        <tr><td>vs mining alone</td><td>${F.mult(r.mult)}</td></tr>
        <tr><td>vs Level 1</td><td>${l > 1 ? "+" + F.usd(r.total - base.total) + "/day" : "—"}</td></tr>
      </table>`;
  });
  const ln = $("#levels-note");
  if (ln) ln.textContent = exampleText;

  // ---------- Simple calculator ----------
  const sel = $("#calc-gpu");
  if (sel) {
    let level = 2;
    hcFillGpuSelect(sel, EX_GPU.name);
    const segBtns = $$("#calc-level button");
    const out = (k, v) => { const e = $(`[data-out="${k}"]`); if (e) e.textContent = v; };
    const fmt = (v) => (v > 0 && v < 0.01 ? "<$0.01" : F.usd(v));
    function update() {
      const g = GPUS.find((x) => x.name === sel.value) || EX_GPU;
      const r = M.run({ ...EX, myRev: g.rev, level });
      out("mh", fmt(r.mining / 24)); out("md", fmt(r.mining)); out("mw", fmt(r.mining * 7));
      out("ch", fmt(r.chestShare / 24)); out("cd", fmt(r.chestShare)); out("cw", fmt(r.chestShare * 7));
      out("th", fmt(r.total / 24)); out("td", fmt(r.total)); out("tw", fmt(r.total * 7));
      $("#calc-coin").textContent = g.coin;
      $("#calc-share").textContent = F.pct(r.share * 100) + (r.capped ? " (cap)" : "");
      segBtns.forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.l === level)));
    }
    sel.addEventListener("change", update);
    segBtns.forEach((b) => b.addEventListener("click", () => { level = +b.dataset.l; update(); }));
    $("#calc-assume").textContent =
      `Mining: hashrate.no 24h revenue for your card, Oct 3, 2026. Chest share: example market of ${F.usd(EX.vol)} traded per day, ` +
      `${EX.miners} miners averaging $${EX.avgRev.toFixed(2)}/day, ${EX.p2}% at Level 2 and ${EX.p3}% at Level 3. Real numbers will differ. ` +
      `About 75% of mining is paid right away and the rest after the mined coin confirms.`;
    update();
  }

  // ---------- GPU table ----------
  const body = $("#gpu-body");
  if (body) {
    const search = $("#gpu-search"), more = $("#gpu-more"), count = $("#gpu-count");
    const brandBtns = $$("#gpu-brands .chip");
    let brand = "", showAll = false;
    const LIMIT = 12;
    function render() {
      const q = search.value.trim().toLowerCase();
      const rows = GPUS.filter((g) => (!brand || g.brand === brand) && (!q || g.name.toLowerCase().includes(q)));
      const shown = showAll || q ? rows : rows.slice(0, LIMIT);
      body.innerHTML = shown.length
        ? shown.map((g) => `<tr><td>${g.name}</td><td>${g.brand}</td><td><span class="coin ${g.coin}">${g.coin}</span></td><td class="num">$${g.rev.toFixed(2)}</td></tr>`).join("")
        : `<tr><td colspan="4" style="color: var(--muted)">No match. Try a model number like 3060.</td></tr>`;
      count.textContent = `Showing ${shown.length} of ${rows.length} ${brand || ""} cards`.replace("  ", " ");
      more.hidden = !!q || rows.length <= LIMIT;
      more.textContent = showAll ? "Show fewer" : `Show all ${rows.length}`;
      more.setAttribute("aria-expanded", String(showAll));
    }
    search.addEventListener("input", render);
    brandBtns.forEach((b) => b.addEventListener("click", () => {
      brand = b.dataset.brand;
      brandBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      render();
    }));
    more.addEventListener("click", () => { showAll = !showAll; render(); });
    render();
  }
})();
