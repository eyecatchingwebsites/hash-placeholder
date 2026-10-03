// Pre-launch earnings estimate, matching the chest rules in packages/engine:
// weight = (GPU USD earnings)^0.5 × level multiplier, the chest is 2.5% of all $HASH volume.
window.HashModel = (function () {
  "use strict";
  const FEE = 3, CHEST = 2.5, DEV = 0.5;
  const MULT = [1, 2, 4];

  // Payouts depend on the market only through daily volume per GPU mining (V / N), so the site
  // uses one ratio instead of situations. The derivation is on the home page (#math).
  //   V / N = (volume ÷ market cap) × (market cap ÷ holders) ÷ (miners ÷ holders)
  //         = 30% × $1,000 ÷ 40% = $750 of daily volume per GPU. Market cap cancels.
  const ESTIMATE = {
    turnover: 30,       // % of market cap traded per day
    capPerHolder: 1000, // $ of market cap per holder
    minerShare: 40,     // % of holders who mine
    avgRev: 2.5,        // average mining GPU's revenue, $/day (ā)
    p2: 50, p3: 0,      // level mix: half of miners hold $50+ (Level 3 only exists after day 14)
  };
  ESTIMATE.volPerGpu = (ESTIMATE.turnover / 100) * ESTIMATE.capPerHolder / (ESTIMATE.minerShare / 100);
  ESTIMATE.avgMult = (1 - (ESTIMATE.p2 + ESTIMATE.p3) / 100) * MULT[0] + (ESTIMATE.p2 / 100) * MULT[1] + (ESTIMATE.p3 / 100) * MULT[2];

  // cut = 2.5% × (V/N + ā) × √(your GPU) × level ÷ (√ā × m̄)
  // This is the many-miners limit of the exact split; it ignores the 5% per-wallet cap,
  // which only bites when very few GPUs are mining.
  // x: { myRev, level, volPerGpu?, avgRev?, avgMult?, watts?, elec? }
  function estimate(x) {
    const e = { ...ESTIMATE, ...x };
    const chestPerGpu = (CHEST / 100) * (e.volPerGpu + e.avgRev);
    const rel = (Math.sqrt(Math.max(0, e.myRev)) * MULT[e.level - 1]) / (Math.sqrt(e.avgRev) * e.avgMult);
    const chestShare = chestPerGpu * rel;
    const total = e.myRev + chestShare;
    const power = e.watts != null && e.elec != null ? (e.watts * 24 / 1000) * e.elec : 0;
    return { chestPerGpu, rel, chestShare, mining: e.myRev, total, power, net: total - power, mult: e.myRev > 0 ? total / e.myRev : 0 };
  }

  return { FEE, CHEST, DEV, MULT, ESTIMATE, estimate };
})();
