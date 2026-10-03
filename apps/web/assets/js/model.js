// Chest-share model, matching packages/engine and calculator/index.html:
// weight = (GPU USD earnings)^0.5 × level multiplier, each wallet capped at 5% of the chest.
// Everything here is a scenario. Real payouts depend on live volume and miner count.
window.HashModel = (function () {
  "use strict";
  const FEE = 3, CHEST = 2.5, DEV = 0.5;
  const MULT = [1, 2, 4];
  const ALPHA = 0.5, CAP = 0.05;

  // The project's scenario presets (calculator/index.html and the 90-day simulation in sim/).
  // vol = 24h $HASH volume, miners = GPUs mining, avgRev = average GPU's mining $/day,
  // p2 / p3 = % of miners at Level 2 / Level 3.
  const SCENARIOS = [
    { id: "launch", name: "Launch day", wk: "day 1", l3: false,
      v: { vol: 600000, miners: 80, avgRev: 3.0, p2: 30, p3: 0 },
      d: "First 24 hours. Volume is often 2× market cap while few people have set up mining, so each GPU gets a big share. Level 3 isn't possible before day 14." },
    { id: "hype", name: "Hype week", wk: "days 2–7", l3: false,
      v: { vol: 300000, miners: 400, avgRev: 2.5, p2: 50, p3: 0 },
      d: "The base case: about $1M market cap trading $300K a day, with 400 GPUs mining. Level 3 isn't possible before day 14." },
    { id: "peak", name: "Peak run", wk: "weeks 2–3", l3: true,
      v: { vol: 2000000, miners: 1500, avgRev: 4.0, p2: 55, p3: 15 },
      d: "The coin runs to around $5M. Volume is high but far more GPUs join, including rented ones, so the chest is split more ways." },
    { id: "cool", name: "Cooling off", wk: "month 2", l3: true,
      v: { vol: 100000, miners: 600, avgRev: 3.0, p2: 40, p3: 30 },
      d: "Volume drops to about $100K a day. Renters leave first; the miners who stay are mostly holders." },
    { id: "steady", name: "Steady state", wk: "month 3+", l3: true,
      v: { vol: 25000, miners: 250, avgRev: 2.5, p2: 35, p3: 40 },
      d: "Volume settles at a few percent of market cap a day. The cut is modest and Level 3 holders take most of it." },
    { id: "flop", name: "Flop", wk: "any time", l3: true,
      v: { vol: 8000, miners: 40, avgRev: 2.0, p2: 30, p3: 10 },
      d: "Hype never arrives or fades fast. Thin volume, small cut. The most common outcome for new tokens." },
  ];
  const DEFAULT_SCEN = "hype";
  const scenario = (id) => SCENARIOS.find((s) => s.id === id);

  // x: { myRev, level, vol, miners, avgRev, p2, p3, watts?, elec? }
  function run(x) {
    const N = Math.max(1, x.miners);
    const p3 = Math.min(1, x.p3 / 100);
    const p2 = Math.min(x.p2 / 100, 1 - p3);
    const p1 = Math.max(0, 1 - p2 - p3);
    const avgMult = p1 * MULT[0] + p2 * MULT[1] + p3 * MULT[2];
    // Volume includes the platform's own $HASH buys for miner payouts (they pay the tax too).
    const chestVol = x.vol + N * x.avgRev;
    const chest = chestVol * CHEST / 100;
    const othersW = (N - 1) * Math.pow(x.avgRev, ALPHA) * avgMult;
    const myW = Math.pow(Math.max(0, x.myRev), ALPHA) * MULT[x.level - 1];
    let share = myW / (othersW + myW || 1);
    const capped = share > CAP;
    share = Math.min(share, CAP);
    const chestShare = chest * share;
    const total = x.myRev + chestShare;
    const power = x.watts != null && x.elec != null ? (x.watts * 24 / 1000) * x.elec : 0;
    return { chest, chestVol, share, capped, mining: x.myRev, chestShare, total, power, net: total - power, mult: x.myRev > 0 ? total / x.myRev : 0 };
  }

  return { FEE, CHEST, DEV, MULT, CAP, SCENARIOS, DEFAULT_SCEN, scenario, run };
})();
