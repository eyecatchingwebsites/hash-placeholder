// Full calculator page: mining and holding, one estimate based on daily volume per GPU mining.
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const M = window.HashModel, F = window.hcFmt, GPUS = window.GPUS || [], E = M.ESTIMATE;

  // Log-mapped slider for volume per GPU ($25 to $10,000).
  const RANGE = [25, 10000];
  const toPos = (v) => Math.round((1000 * Math.log(v / RANGE[0])) / Math.log(RANGE[1] / RANGE[0]));
  const fromPos = (p) => RANGE[0] * Math.pow(RANGE[1] / RANGE[0], p / 1000);
  const nice = (v) => { const m = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / m) * m; };

  const g0 = GPUS.find((g) => g.name === "RTX 4070") || GPUS[0];
  const DEFAULTS = {
    gpu: g0.name, myRev: g0.rev, watts: g0.w, elec: 0.15, level: 2, bag: 500, hlevel: 2,
    volPerGpu: E.volPerGpu, avgRev: E.avgRev, p2: E.mMix[1], p3: E.mMix[2],
  };
  let S = { ...DEFAULTS };

  const sel = $("#fc-gpu");
  hcFillGpuSelect(sel, S.gpu);
  const custom = document.createElement("option");
  custom.value = "custom"; custom.textContent = "Custom (your own numbers)";
  sel.append(custom);

  sel.addEventListener("change", () => {
    S.gpu = sel.value;
    const g = GPUS.find((x) => x.name === sel.value);
    if (g) { S.myRev = g.rev; S.watts = g.w; }
    sync();
  });
  [["#fc-rev", "myRev"], ["#fc-watts", "watts"]].forEach(([id, k]) => $(id).addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v >= 0) { S[k] = v; S.gpu = "custom"; sync(false); }
  }));
  $("#fc-bag").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v >= 0) { S.bag = v; sync(false); }
  });
  $("#fc-elec").addEventListener("input", (e) => { S.elec = +e.target.value; sync(); });
  $("#fc-ratio").addEventListener("input", (e) => { S.volPerGpu = nice(fromPos(+e.target.value)); sync(); });
  $("#fc-avg").addEventListener("input", (e) => { S.avgRev = +e.target.value; sync(); });
  $("#fc-p2").addEventListener("input", (e) => { S.p2 = +e.target.value; if (S.p2 + S.p3 > 100) S.p3 = 100 - S.p2; sync(); });
  $("#fc-p3").addEventListener("input", (e) => { S.p3 = +e.target.value; if (S.p2 + S.p3 > 100) S.p2 = 100 - S.p3; sync(); });
  $$("#fc-level button").forEach((b) => b.addEventListener("click", () => { S.level = +b.dataset.l; sync(); }));
  $$("#fc-hlevel button").forEach((b) => b.addEventListener("click", () => { S.hlevel = +b.dataset.h; sync(); }));
  $("#fc-reset").addEventListener("click", () => { S = { ...DEFAULTS }; sync(); });

  const LEVEL_HINT = {
    1: "M1: just mine. Weight 1×.",
    2: "M2: mined on 2 of the last 7 days, and at least H1 ($50 held). Weight 2×.",
    3: "M3: mined on 5 of the last 7 days, and at least H2 ($500 held for 24 hours). Weight 4×.",
  };
  const money = (v) => (v > 0 && v < 0.01 ? "<$0.01" : F.usd(v));
  const whole = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const set = (k, v) => { const e = $(`[data-o="${k}"]`); if (e) e.textContent = v; };
  const mix = () => [100 - S.p2 - S.p3, S.p2, S.p3];
  const mkInputs = () => ({ volPerGpu: S.volPerGpu, avgRev: S.avgRev, mMix: mix() });
  const est = (level) => M.miner({ myRev: S.myRev, level, watts: S.watts, elec: S.elec, ...mkInputs() });

  function sync(syncNumbers = true) {
    sel.value = GPUS.some((g) => g.name === S.gpu) ? S.gpu : "custom";
    if (syncNumbers) { $("#fc-rev").value = S.myRev; $("#fc-watts").value = S.watts; $("#fc-bag").value = S.bag; }
    $("#fc-elec").value = S.elec; $("#fc-elec-o").textContent = "$" + S.elec.toFixed(2) + "/kWh";
    $("#fc-ratio").value = toPos(S.volPerGpu); $("#fc-ratio-o").textContent = F.usd(S.volPerGpu);
    $("#fc-avg").value = S.avgRev; $("#fc-avg-o").textContent = "$" + S.avgRev.toFixed(2);
    $("#fc-p2").value = S.p2; $("#fc-p2-o").textContent = S.p2 + "%";
    $("#fc-p3").value = S.p3; $("#fc-p3-o").textContent = S.p3 + "%";
    $$("#fc-level button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.l === S.level)));
    $$("#fc-hlevel button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.h === S.hlevel)));
    $("#fc-level-hint").textContent = LEVEL_HINT[S.level];

    const r = est(S.level);
    const mk = r.mk;
    const maxH = M.holderLevelFor(S.bag);
    const hl = Math.min(S.hlevel, maxH);
    const hold = M.holder(S.bag, hl, mkInputs());
    $("#fc-hlevel-hint").textContent = hl > 0
      ? `H${hl}: ${(100 * mk.yieldPerDay[hl - 1]).toFixed(2)}% of your bag a day at this volume.${M.HOLDER.hours[hl - 1] ? ` Needs ${M.HOLDER.hours[hl - 1]} hours on your hold clock.` : ""}`
      : "Below $50 a bag earns no holder rewards.";
    $("#fc-ratio-hint").textContent =
      `Miners reach 5× above ${whole(mk.targetVolPerGpu)} per GPU. ` +
      (S.volPerGpu === E.volPerGpu ? "Default: launch-week trading." : `For example ${F.usd(S.volPerGpu * 400)} of daily volume with 400 GPUs mining.`);

    const rows = { m: r.mining, c: r.chestShare, h: hold.perDay, p: -r.power, n: r.net + hold.perDay };
    Object.entries(rows).forEach(([k, d]) => {
      const f = k === "p" ? (v) => (v === 0 ? "$0.00" : "−" + money(-v)) : k === "n" ? (v) => (v < 0 ? "−" + money(-v) : money(v)) : money;
      set(k + "-h", f(d / 24)); set(k + "-d", f(d)); set(k + "-w", f(d * 7));
    });
    $("#fc-chest").textContent = `${F.pct(100 * mk.chestRate)} / ${F.pct(100 * mk.holderRate)}`;
    $("#fc-share").textContent = F.mult(r.rel) + " avg";
    $("#fc-mult").textContent = F.mult(r.mult);

    const flags = [];
    if (S.hlevel > maxH) flags.push(maxH ? `H${S.hlevel} needs ${whole(M.HOLDER.usd[S.hlevel - 1])}; this bag counts as H${maxH}.` : "This bag is below $50, so it earns no holder rewards.");
    if ((S.level === 2 && maxH < 1) || (S.level === 3 && maxH < 2)) flags.push(`M${S.level} also needs ${S.level === 2 ? "H1 ($50 held)" : "H2 ($500 held for 24 hours)"}. Set your bag to match.`);
    if (!mk.targetMet) flags.push(`At ${F.usd(S.volPerGpu)} per GPU the 3.5% cap is reached before 5×, so miners average ${F.mult(1 + mk.chestPerGpu / S.avgRev)} and holders get their 1% minimum.`);
    if (r.net + hold.perDay < 0) flags.push("At this electricity price, power costs more than you earn in this estimate.");
    $("#fc-flags").innerHTML = flags.map((f) => `<p class="flag">${f}</p>`).join("");

    const lv = [1, 2, 3].map(est);
    const max = Math.max(...lv.map((x) => x.total)) || 1;
    $("#fc-bars").innerHTML = lv.map((x, i) => {
      const mw = (x.mining / max) * 100, cw = (x.chestShare / max) * 100;
      return `<div class="bar-row${i + 1 === S.level ? " on" : ""}"><span>M${i + 1}</span>
        <span class="track"><i style="width:${mw}%"></i><i class="chest" style="left:${mw}%;width:${cw}%"></i></span>
        <b>${money(x.total)}</b></div>`;
    }).join("");
  }
  sync();
})();
