// Chest-share model, matching packages/engine and calculator/index.html:
// weight = (GPU USD earnings)^0.5 × level multiplier, each wallet capped at 5% of the chest.
// Everything here is an illustration. Real payouts depend on live volume and miners.
window.HashModel = (function () {
  "use strict";
  const FEE = 3, CHEST = 2.5, DEV = 0.5;
  const MULT = [1, 2, 4];
  const ALPHA = 0.5, CAP = 0.05;

  // The example market used on the home page. Labeled as an example wherever it's shown.
  const EXAMPLE = { vol: 100000, miners: 500, avgRev: 2.5, p2: 40, p3: 20 };

  // Scenarios for the full calculator. Market and miner inputs only.
  // From calculator/index.html and the 90-day simulation in sim/.
  const SCENARIOS = [
    { id: "launch", name: "Launch day", wk: "day 1",
      v: { vol: 600000, miners: 80, avgRev: 3.0, p2: 30, p3: 0 },
      d: "First 24 hours. Volume can be high while few people have set up mining, so each GPU's share is large. Nobody can be Level 3 before day 14. Rarely lasts." },
    { id: "hype", name: "Hype week", wk: "days 2–7",
      v: { vol: 300000, miners: 400, avgRev: 2.5, p2: 50, p3: 0 },
      d: "Traders start mining on gaming PCs. Many hold $50 for Level 2. Level 3 is still locked by the 14-day rule." },
    { id: "example", name: "Example", wk: "home page",
      v: { ...EXAMPLE },
      d: "The example used on the home page. A moderately active coin with a mix of levels." },
    { id: "steady", name: "Steady state", wk: "month 3+",
      v: { vol: 25000, miners: 250, avgRev: 2.5, p2: 35, p3: 40 },
      d: "Volume settles at a few percent of market cap per day. The chest is modest and committed Level 3 holders take most of it." },
    { id: "flop", name: "Flop", wk: "any time",
      v: { vol: 8000, miners: 40, avgRev: 2.0, p2: 30, p3: 10 },
      d: "Hype never arrives or fades fast. Volume is thin and the chest barely adds anything. This is the most common outcome for new tokens." },
  ];

  // x: { myRev, level, vol, miners, avgRev, p2, p3, watts?, elec? }
  function run(x) {
    const N = Math.max(1, x.miners);
    const p3 = Math.min(1, x.p3 / 100);
    const p2 = Math.min(x.p2 / 100, 1 - p3);
    const p1 = Math.max(0, 1 - p2 - p3);
    const avgMult = p1 * MULT[0] + p2 * MULT[1] + p3 * MULT[2];
    // Volume includes the platform's own $HASH buys for miner payouts (they pay the fee too).
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

  return { FEE, CHEST, DEV, MULT, CAP, EXAMPLE, SCENARIOS, run };
})();
