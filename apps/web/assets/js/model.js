// Pre-launch earnings estimate for the decided design (packages/engine, tax.ts):
// The tax is 2–5%: the lowest rate (in 0.25% steps) at which miners reach 5× their mining AND
// holders still get at least 1% of trading volume (so it bottoms out at 2.25%).
// Shares of the tax: dev 10% at a 2% tax down to 5% at 5%; miners 45–75% (what reaches 5×, leaving
// holders at least 20%); holders the rest. Miner weight = √(GPU $/day) × M1/M2/M3 (1/2/4);
// holder weight = bag × H1/H2/H3 (1/2/4).
window.HashModel = (function () {
  "use strict";
  const TARGET = 5;
  const RATE = { min: 0.02, max: 0.05, step: 0.0025 };
  const SHARE = { devAtMin: 0.10, devAtMax: 0.05, minerMin: 0.45, minerMax: 0.75, holderMin: 0.20 };
  const HOLDER_MIN_OF_VOLUME = 0.01;
  const devShareAt = (rate) => SHARE.devAtMin + (SHARE.devAtMax - SHARE.devAtMin) * Math.min(1, Math.max(0, (rate - RATE.min) / (RATE.max - RATE.min)));
  const minerMaxAt = (rate) => Math.min(SHARE.minerMax, 1 - devShareAt(rate) - SHARE.holderMin);
  // Split a tax amount at a rate (same as the engine's splitTax).
  function splitAt(rate, tax, need) {
    const dev = devShareAt(rate) * tax;
    const chest = Math.min(minerMaxAt(rate) * tax, Math.max(SHARE.minerMin * tax, need));
    return { dev, chest, holders: tax - dev - chest, targetMet: need <= minerMaxAt(rate) * tax };
  }
  // Lowest rate where miners reach 5× and holders keep 1% of volume (same as the engine's targetTaxRate).
  function rateFor(volume, need) {
    const steps = Math.round((RATE.max - RATE.min) / RATE.step);
    for (let i = 0; i <= steps; i++) {
      const r = +(RATE.min + i * RATE.step).toFixed(4);
      const s = splitAt(r, r * volume, need);
      if (s.targetMet && s.holders >= HOLDER_MIN_OF_VOLUME * volume - 1e-9) return r;
    }
    return RATE.max;
  }
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
    const chestNeed = (TARGET - 1) * e.avgRev;        // what lifts the average miner to 5×
    const rate = e.rate ?? rateFor(base, chestNeed);  // the tax the formula sets at this volume
    const tax = rate * base;
    const devShare = devShareAt(rate);
    const minerMax = minerMaxAt(rate);
    const { dev: devPerGpu, chest: chestPerGpu, holders: holderPerGpu } = splitAt(rate, tax, chestNeed);
    const pool = tax - devPerGpu;                     // miners + holders
    const mcapPerGpu = e.volPerGpu / (e.turnover / 100);
    const holderWeightPerGpu = mcapPerGpu * (e.heldShare / 100) *
      ((e.hMix[1] / 100) * MULT[0] + (e.hMix[2] / 100) * MULT[1] + (e.hMix[3] / 100) * MULT[2]);
    const yieldPerDay = MULT.map((m) => (holderWeightPerGpu > 0 ? (holderPerGpu * m) / holderWeightPerGpu : 0));
    return {
      ...e, base, rate, tax, devShare, devPerGpu, pool, chestNeed, chestPerGpu, holderPerGpu, targetMet: chestNeed <= minerMax * tax,
      shares: { dev: devShare, miners: chestPerGpu / tax, holders: holderPerGpu / tax },
      chestRate: (chestPerGpu / base), holderRate: (holderPerGpu / base), avgMult: avgMinerMult(e.mMix),
      mcapPerGpu, holderWeightPerGpu, yieldPerDay,
      // volume per GPU below which even a 5% tax can't lift miners to 5×
      targetVolPerGpu: chestNeed / (RATE.max * minerMaxAt(RATE.max)) - e.avgRev,
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

  return { TARGET, RATE, SHARE, HOLDER_MIN_OF_VOLUME, devShareAt, minerMaxAt, rateFor, MULT, HOLDER, MINER, ESTIMATE, market, miner, holder, holderLevelFor };
})();
