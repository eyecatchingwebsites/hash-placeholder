import { decide, type GpuSwitchState } from "./decide.js";
import { scoreCoins } from "./score.js";
import { poolUser } from "./wallet.js";
import type { Assignment, CoinInfo, GpuReport, RevenueQuote, ScoreInputs, SwitchPolicy } from "./types.js";

export interface AssignContext {
  coins: CoinInfo[];
  quotes: RevenueQuote[];
  score: ScoreInputs;
  policy: SwitchPolicy;
  /** How long an assignment stays valid; the app re-checks before it expires. */
  ttlMs: number;
  /** Preferred pool region for this rig, if known. */
  region?: string;
}

export interface AssignResult {
  assignment: Assignment | null;
  state: GpuSwitchState;
  reason: string;
}

export function assignGpu(
  rig: { wallet: string; rigId: string },
  gpu: GpuReport,
  prev: GpuSwitchState | null,
  now: number,
  ctx: AssignContext,
): AssignResult {
  const scores = scoreCoins(gpu, ctx.coins, ctx.quotes, ctx.score);
  const d = decide(scores, prev, now, ctx.policy);
  if (!d.coin) return { assignment: null, state: d.state, reason: d.reason };
  const coin = ctx.coins.find((c) => c.id === d.coin)!;
  const pool = coin.pools.find((p) => p.region === ctx.region) ?? coin.pools[0]!;
  const score = scores.find((s) => s.coin === d.coin)!;
  return {
    state: d.state,
    reason: d.reason,
    assignment: {
      v: 1,
      rigId: rig.rigId,
      wallet: rig.wallet,
      gpuIndex: gpu.index,
      gpu: gpu.name,
      coin: coin.id,
      algo: coin.algo,
      minerId: coin.miner[gpu.vendor]!,
      // Login = platform payout address + a short worker id derived from the wallet and rig;
      // the server keeps the worker → wallet map, so per-worker stats map straight to payouts.
      pool: { url: pool.url, user: poolUser(coin.payoutAddress!, rig.wallet, rig.rigId, gpu.index), pass: "x" },
      expectedUsdPerDay: Math.round(score.netUsdPerDay * 100) / 100,
      reason: d.reason,
      issuedAt: now,
      expiresAt: now + ctx.ttlMs,
    },
  };
}
