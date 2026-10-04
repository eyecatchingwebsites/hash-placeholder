// Pre-launch earnings estimate for the decided design (packages/engine):
// 5% tax: 0.5% dev; miner chest gets what lifts miners to 5× their mining, max 3.5%;
// holders get the rest (at least 1%). Miner weight = √(GPU $/day) × M1/M2/M3 (1/2/4);
// holder weight = bag × H1/H2/H3 (1/2/4).
window.HashModel = (function () {
  "use strict";
  const TAX = 0.05, DEV = 0.005, CHEST_MAX = 0.035, TARGET = 5;
  const HOLDER_MIN = TAX - DEV - CHEST_MAX;
  const MULT = [1, 2, 4];
  const HOLDER = { usd: [50, 500, 2500], hours: [0, 24, 168] };
  const MINER = { hours: [0, 48, 120], windowDays: 14 };

  // Payouts depend on the market only through daily volume per GPU mining (V / N).
  //   V / N = (volume ÷ market cap) × (market cap ÷ holders) ÷ (miners ÷ holders)
  //         = 30% × $1,000 ÷ 40% = $750 of daily volume per GPU. Market cap cancels.
  const ESTIMATE = {
    turnover: 30,       // % of market cap traded per day (launch weeks)
    capPerHolder: 1000, // $ of market cap per holder
    minerShare: 40,     // % of holders who mine
    avgRev: 2.5,        // average mining GPU's revenue, $/day (a)
    mMix: [30, 50, 20], // % of miners at M1 / M2 / M3
    heldShare: 60,      // % of market cap held by wallets that can earn holder rewards
    hMix: [15, 30, 35, 20], // % of that value below H1 / at H1 / H2 / H3
  };
  ESTIMATE.volPerGpu = (ESTIMATE.turnover / 100) * ESTIMATE.capPerHolder / (ESTIMATE.minerShare / 100);

  const avgMinerMult = (mix) => mix.reduce((a, p, i) => a + (p / 100) * MULT[i], 0);

  // Per-GPU market: how one day's tax splits, per GPU mining.
  // x: { volPerGpu?, avgRev?, mMix?, turnover?, heldShare?, hMix? }
  function market(x = {}) {
    const e = { ...ESTIMATE, ...x };
    const base = e.volPerGpu + e.avgRev;              // volume incl. the platform's own payout buys
    const pool = (TAX - DEV) * base;                  // miners + holders
    const chestNeed = (TARGET - 1) * e.avgRev;        // what lifts the average miner to 5×
    const chestPerGpu = Math.min(chestNeed, CHEST_MAX * base);
    const holderPerGpu = pool - chestPerGpu;
    const mcapPerGpu = e.volPerGpu / (e.turnover / 100);
    const holderWeightPerGpu = mcapPerGpu * (e.heldShare / 100) *
      ((e.hMix[1] / 100) * MULT[0] + (e.hMix[2] / 100) * MULT[1] + (e.hMix[3] / 100) * MULT[2]);
    const yieldPerDay = MULT.map((m) => (holderWeightPerGpu > 0 ? (holderPerGpu * m) / holderWeightPerGpu : 0));
    return {
      ...e, base, pool, chestNeed, chestPerGpu, holderPerGpu, targetMet: chestNeed <= CHEST_MAX * base,
      chestRate: (chestPerGpu / base), holderRate: (holderPerGpu / base), avgMult: avgMinerMult(e.mMix),
      mcapPerGpu, holderWeightPerGpu, yieldPerDay,
      // volume per GPU at which miners just reach the target with the full 3.5%
      targetVolPerGpu: chestNeed / CHEST_MAX - e.avgRev,
    };
  }

  // Miner: cut = chest per GPU × √(your GPU) × level ÷ (√a × average level).
  // x: { myRev, level, watts?, elec?, ...market inputs }
  function miner(x) {
    const mk = market(x);
    const rel = (Math.sqrt(Math.max(0, x.myRev)) * MULT[x.level - 1]) / (Math.sqrt(mk.avgRev) * mk.avgMult);
    const chestShare = mk.chestPerGpu * rel;
    const total = x.myRev + chestShare;
    const power = x.watts != null && x.elec != null ? (x.watts * 24 / 1000) * x.elec : 0;
    return { mk, rel, chestShare, mining: x.myRev, total, power, net: total - power, mult: x.myRev > 0 ? total / x.myRev : 0 };
  }

  // Holder: bag × daily yield for that holder level.
  function holder(bagUsd, level, x = {}) {
    const mk = market(x);
    const perDay = level > 0 ? bagUsd * mk.yieldPerDay[level - 1] : 0;
    return { mk, perDay, yieldPct: level > 0 ? 100 * mk.yieldPerDay[level - 1] : 0 };
  }

  // Highest holder level a bag reaches (ignoring the hold clock).
  const holderLevelFor = (bagUsd) => (bagUsd >= HOLDER.usd[2] ? 3 : bagUsd >= HOLDER.usd[1] ? 2 : bagUsd >= HOLDER.usd[0] ? 1 : 0);

  return { TAX, DEV, CHEST_MAX, HOLDER_MIN, TARGET, MULT, HOLDER, MINER, ESTIMATE, market, miner, holder, holderLevelFor };
})();
