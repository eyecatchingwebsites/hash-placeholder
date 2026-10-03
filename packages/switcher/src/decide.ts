import type { CoinScore } from "./score.js";
import type { SwitchPolicy } from "./types.js";

/** Per-GPU switching state kept by the server between check-ins. */
export interface GpuSwitchState {
  coin: string | null;
  since: number;
  /** Candidate that has been beating the current coin, and since when. */
  challenger: { coin: string; since: number } | null;
}

export interface Decision {
  coin: string | null;
  state: GpuSwitchState;
  reason: string;
}

/**
 * Hysteresis: only leave the current coin when another one has beaten it by
 * `minGain` continuously for `sustainMs`, and not within `minDwellMs` of the
 * last switch. If the current coin disappears (disabled or unscorable), switch now.
 */
export function decide(scores: CoinScore[], prev: GpuSwitchState | null, now: number, p: SwitchPolicy): Decision {
  const best = scores[0];
  if (!best) return { coin: null, state: { coin: null, since: now, challenger: null }, reason: "no mineable coin for this GPU" };

  if (!prev || prev.coin === null) {
    return { coin: best.coin, state: { coin: best.coin, since: now, challenger: null }, reason: `start on ${best.coin} (best)` };
  }
  const current = scores.find((s) => s.coin === prev.coin);
  if (!current) {
    return { coin: best.coin, state: { coin: best.coin, since: now, challenger: null }, reason: `${prev.coin} unavailable, switch to ${best.coin}` };
  }
  if (best.coin === current.coin || best.netUsdPerDay < current.netUsdPerDay * (1 + p.minGain)) {
    return { coin: current.coin, state: { ...prev, challenger: null }, reason: `stay on ${current.coin}` };
  }
  const challenger = prev.challenger?.coin === best.coin ? prev.challenger : { coin: best.coin, since: now };
  const sustained = now - challenger.since >= p.sustainMs;
  const dwelled = now - prev.since >= p.minDwellMs;
  if (sustained && dwelled) {
    const gain = ((best.netUsdPerDay / current.netUsdPerDay - 1) * 100).toFixed(0);
    return { coin: best.coin, state: { coin: best.coin, since: now, challenger: null }, reason: `switch ${current.coin} → ${best.coin} (+${gain}%)` };
  }
  return {
    coin: current.coin,
    state: { ...prev, challenger },
    reason: `stay on ${current.coin}; ${best.coin} ahead, waiting (${sustained ? "dwell" : "sustain"})`,
  };
}
