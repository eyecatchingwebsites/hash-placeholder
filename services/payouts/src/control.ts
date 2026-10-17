// The kill switch: one file (or HASH_KILL) stops every transaction the loop would send: payouts,
// market buys, harvests, fee claims, rate changes. It is checked at each send (see
// packages/chain guardSends), so it also stops a round that is already running.
//   npx tsx services/payouts/src/ctl.ts kill "why"     engage
//   npx tsx services/payouts/src/ctl.ts resume         release
// PAUSE (older, softer) only makes rounds skip; KILL blocks sends outright.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const killFile = (dataDir: string) => resolve(dataDir, "KILL");
export const pauseFile = (dataDir: string) => resolve(dataDir, "PAUSE");

/** Why sends are blocked, or null. Read fresh every time (another process may flip it). */
export function killReason(dataDir: string, envKill: string | null): string | null {
  if (envKill) return `kill switch (${envKill})`;
  const f = killFile(dataDir);
  if (!existsSync(f)) return null;
  let note = "";
  try { note = readFileSync(f, "utf8").trim(); } catch { /* unreadable still counts */ }
  return `kill switch engaged${note ? `: ${note}` : ""}`;
}

export function engageKill(dataDir: string, reason: string, now = new Date()) {
  writeFileSync(killFile(dataDir), `${now.toISOString()} ${reason || "no reason given"}\n`);
}

export function releaseKill(dataDir: string): boolean {
  const f = killFile(dataDir);
  if (!existsSync(f)) return false;
  rmSync(f);
  return true;
}
