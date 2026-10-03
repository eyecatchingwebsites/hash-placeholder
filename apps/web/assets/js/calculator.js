// Full calculator page.
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const M = window.HashModel, F = window.hcFmt, GPUS = window.GPUS || [];

  const LOGS = { vol: [5000, 10e6], miners: [10, 20000] };
  const toPos = (k, v) => { const [a, b] = LOGS[k]; return Math.round((1000 * Math.log(v / a)) / Math.log(b / a)); };
  const fromPos = (k, p) => { const [a, b] = LOGS[k]; return a * Math.pow(b / a, p / 1000); };
  const nice = (v) => { const m = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / m) * m; };

  const g0 = GPUS.find((g) => g.name === "RTX 4070") || GPUS[0];
  const DEFAULTS = { gpu: g0.name, myRev: g0.rev, watts: g0.w, elec: 0.15, level: 2, scen: M.DEFAULT_SCEN, ...M.scenario(M.DEFAULT_SCEN).v };
  let S = { ...DEFAULTS };

  const sel = $("#fc-gpu");
  hcFillGpuSelect(sel, S.gpu);
  const custom = document.createElement("option");
  custom.value = "custom"; custom.textContent = "Custom (your own numbers)";
  sel.append(custom);

  // Scenario chips
  const scenBox = $("#fc-scen");
  M.SCENARIOS.forEach((sc) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.dataset.s = sc.id;
    b.innerHTML = `${sc.name}<span class="wk">${sc.wk}</span>`;
    b.addEventListener("click", () => { Object.assign(S, sc.v); S.scen = sc.id; sync(); });
    scenBox.append(b);
  });

  // Inputs
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
  $("#fc-elec").addEventListener("input", (e) => { S.elec = +e.target.value; sync(); });
  $("#fc-avg").addEventListener("input", (e) => { S.avgRev = +e.target.value; S.scen = null; sync(); });
  ["vol", "miners"].forEach((k) => $("#fc-" + k).addEventListener("input", (e) => {
    let v = nice(fromPos(k, +e.target.value));
    if (k === "miners") v = Math.max(1, Math.round(v));
    S[k] = v; S.scen = null; sync();
  }));
  $("#fc-p2").addEventListener("input", (e) => { S.p2 = +e.target.value; if (S.p2 + S.p3 > 100) S.p3 = 100 - S.p2; S.scen = null; sync(); });
  $("#fc-p3").addEventListener("input", (e) => { S.p3 = +e.target.value; if (S.p2 + S.p3 > 100) S.p2 = 100 - S.p3; S.scen = null; sync(); });
  $$("#fc-level button").forEach((b) => b.addEventListener("click", () => { S.level = +b.dataset.l; sync(); }));
  $("#fc-reset").addEventListener("click", () => { S = { ...DEFAULTS }; sync(); });

  const LEVEL_HINT = {
    1: "Level 1: just mine. Weight 1×.",
    2: "Level 2: hold at least $50 of $HASH. Weight 2×.",
    3: "Level 3: hold at least $500, 14+ days since your first $HASH, never sold or transferred out. Weight 4×.",
  };
  const money = (v) => (v > 0 && v < 0.01 ? "<$0.01" : F.usd(v));
  const set = (k, v) => { const e = $(`[data-o="${k}"]`); if (e) e.textContent = v; };

  function sync(syncNumbers = true) {
    // Inputs
    sel.value = GPUS.some((g) => g.name === S.gpu) ? S.gpu : "custom";
    if (syncNumbers) { $("#fc-rev").value = S.myRev; $("#fc-watts").value = S.watts; }
    $("#fc-elec").value = S.elec; $("#fc-elec-o").textContent = "$" + S.elec.toFixed(2) + "/kWh";
    $("#fc-vol").value = toPos("vol", S.vol); $("#fc-vol-o").textContent = F.usd(S.vol);
    $("#fc-miners").value = toPos("miners", S.miners); $("#fc-miners-o").textContent = S.miners.toLocaleString("en-US");
    $("#fc-avg").value = S.avgRev; $("#fc-avg-o").textContent = "$" + S.avgRev.toFixed(2);
    $("#fc-p2").value = S.p2; $("#fc-p2-o").textContent = S.p2 + "%";
    $("#fc-p3").value = S.p3; $("#fc-p3-o").textContent = S.p3 + "%";
    $$("#fc-level button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.l === S.level)));
    $("#fc-level-hint").textContent = LEVEL_HINT[S.level];
    $$("#fc-scen .chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.s === S.scen)));
    const sc = M.SCENARIOS.find((x) => x.id === S.scen);
    $("#fc-scen-desc").innerHTML = sc
      ? `<b>${sc.name}.</b> ${sc.d}`
      : "<b>Custom.</b> You've changed the market inputs. Pick a scenario to reset them.";

    // Results
    const r = M.run(S);
    const rows = { m: r.mining, c: r.chestShare, p: -r.power, n: r.net };
    Object.entries(rows).forEach(([k, d]) => {
      const f = k === "p" ? (v) => (v === 0 ? "$0.00" : "−" + money(-v)) : k === "n" ? (v) => (v < 0 ? "−" + money(-v) : money(v)) : money;
      set(k + "-h", f(d / 24)); set(k + "-d", f(d)); set(k + "-w", f(d * 7)); set(k + "-m", f(d * 30));
    });
    $("#fc-chest").textContent = F.usd(r.chest);
    $("#fc-share").textContent = F.pct(r.share * 100);
    $("#fc-mult").textContent = F.mult(r.mult);

    const flags = [];
    if (S.level === 3 && sc && !sc.l3) flags.push("Level 3 isn't possible in the first 14 days after launch. Pick Level 1 or 2 for this scenario.");
    if (r.capped) flags.push("You've hit the 5% cap. The excess is shared out to other miners.");
    if (r.net < 0) flags.push("At this electricity price, power costs more than this card earns in this scenario.");
    $("#fc-flags").innerHTML = flags.map((f) => `<p class="flag">${f}</p>`).join("");

    // Bars by level
    const lv = [1, 2, 3].map((l) => M.run({ ...S, level: l }));
    const max = Math.max(...lv.map((x) => x.total)) || 1;
    $("#fc-bars").innerHTML = lv.map((x, i) => {
      const mw = (x.mining / max) * 100, cw = (x.chestShare / max) * 100;
      return `<div class="bar-row${i + 1 === S.level ? " on" : ""}"><span>Level ${i + 1}</span>
        <span class="track"><i style="width:${mw}%"></i><i class="chest" style="left:${mw}%;width:${cw}%"></i></span>
        <b>${money(x.total)}</b></div>`;
    }).join("");
  }
  sync();
})();
