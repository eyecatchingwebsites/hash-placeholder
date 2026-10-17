// Payout loop settings: a JSON file for the numbers, the environment for everything secret or
// deployment-specific. Nothing secret is ever read from the repo.
//
//   HASH_PAYOUTS_CONFIG   config file (default services/payouts/config/payouts.json)
//   HASH_RPC_URL          RPC endpoint (required on mainnet: a dedicated one such as Helius)
//   HASH_KEYPAIR          path to the payout wallet's keypair file (solana-keygen JSON). It signs
//                         payouts, market buys, harvests and fee claims; keep only the float in it.
//                         Must live outside the repository.
//   HASH_DEV_WALLET       the dev share's address
//   HASH_MULTISIG         the Squads multisig (vault) address: rate changes are proposed to it
//                         once it holds the fee config authority
//   HASH_ALERT_WEBHOOK    URL that alerts are POSTed to (Discord or Slack incoming webhook)
//   HASH_DATA_DIR         ledger, records, alerts and the KILL file (default services/payouts/data)
//   HASH_KILL=1           kill switch from the environment (same as `ctl kill`)
//   HASH_MAINNET=yes      required with network "mainnet", so nothing reaches mainnet by accident
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { RateConfig } from "./rate.js";

export interface PayoutsConfig {
  network: "devnet" | "mainnet";
  /** Devnet default endpoint; mainnet takes HASH_RPC_URL only. */
  rpc?: string;
  /** Pause between per-transaction RPC reads (public endpoints rate-limit). */
  rpcPauseMs: number;
  collectorMinutes: number;
  roundMinutes: number;
  holderEveryRounds: number;
  decimals: number;
  /**
   * The Meteora market: the DBC config the token launched with (and optionally the DAMM v2 pool).
   * Without it (the Oct 5 devnet rehearsal) the price is `priceUsd` and mining is paid from supply.
   */
  market?: { mint: string; dbcConfig: string; dammPool?: string };
  /** Assumed $HASH price when there is no market (devnet rehearsal only). */
  priceUsd?: number;
  /** SOL/USD: Jupiter's price API with CoinGecko as a fallback, or a fixed number (tests). */
  solUsd: { source: "live" | "fixed"; fixed?: number; min: number; max: number };
  buy: {
    /** The swap fails rather than fill worse than this below the quote. */
    slippageBps: number;
    /** Skip the buy (miners' mining stays owed) if pool fee + price impact exceed this. */
    maxCostBps: number;
    /** Most USD of mining bought per round; more stays pending for the next rounds. */
    maxUsdPerRound: number;
  };
  funding: {
    /** SOL kept in the payout wallet for fees and token-account rent, never spent on buys. */
    reserveSol: number;
    /** Claim our curve trading fee once at least this much is waiting. */
    claimPartnerFeeMinSol: number;
  };
  /**
   * How held-back mining is paid. "sales": once the mined coin is sold (recorded with `ctl sold`),
   * at the sale's price ratio. "estimate": at its estimate after `minAgeHours` (devnet: no sales).
   */
  settlement: { mode: "sales" | "estimate"; minAgeHours: number };
  rate: RateConfig & { adjust: boolean };
  minHolderPayoutUsd: number;
  /** Safety: a round that wants to pay more than this pauses instead. */
  maxPayoutUsdPerRound: number;
  /** Below this the payout wallet can't pay fees and rent: rounds wait. */
  minTreasurySol: number;
  alerts: {
    /** Alert when this many rounds in a row harvest no tax. */
    emptyHarvestRounds: number;
    /** Alert when the SOL float (above the reserve) is worth less than this. */
    floatLowUsd: number;
    /** Alert when this many RPC calls fail within 10 minutes. */
    rpcErrorsPer10Min: number;
    /** The same alert is re-sent at most this often while it lasts. */
    repeatMinutes: number;
  };
  /** Compute-unit price on our own transactions (micro-lamports), so they land when the network is busy. */
  priorityFeeMicroLamports?: number;
  /** Never holders or miners: exchange wallets, LP lockers, etc. (pool vault owners are added automatically). */
  excluded?: string[];
  /** Devnet stand-ins. Refused on mainnet. */
  simulate?: {
    /** Fake mining credited to wallets each collector run (USD per hour). */
    miners?: { wallet: string; usdPerHour: number }[];
    /** The fake mining counts as PRL at this price (for rehearsing `ctl sold`). */
    prlPriceUsd?: number;
    /** The Oct 5 rehearsal's market wallet trading with test traders (no-market mode only). */
    trades?: { enabled: boolean; dailyVolumeUsd: number; traders: number; sellers: number; marketTokens: number };
  };
}

export interface Runtime {
  cfg: PayoutsConfig;
  configPath: string;
  rpcUrl: string;
  dataDir: string;
  /** The payout wallet's keypair file, or null for the devnet rehearsal's keys. */
  keypairPath: string | null;
  devWallet?: string;
  multisig?: PublicKey;
  webhook?: string;
  envKill: string | null;
  warnings: string[];
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export const REPO_ROOT = resolve(here("../../.."));

const PUBLIC_RPCS = ["api.mainnet-beta.solana.com", "api.devnet.solana.com", "api.testnet.solana.com"];

function inside(dir: string, path: string): boolean {
  const rel = relative(dir, resolve(path));
  return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
}
const insideRepo = (path: string) => inside(REPO_ROOT, path);

/** Read the config file and the environment, and refuse anything unsafe for the network. */
export function loadRuntime(env: Record<string, string | undefined> = process.env): Runtime {
  const configPath = resolve(env.HASH_PAYOUTS_CONFIG ?? here("../config/payouts.json"));
  if (!existsSync(configPath)) throw new Error(`missing payout config ${configPath}`);
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as PayoutsConfig;
  return checkRuntime(cfg, configPath, env);
}

export function checkRuntime(cfg: PayoutsConfig, configPath: string, env: Record<string, string | undefined>): Runtime {
  const warnings: string[] = [];
  if (cfg.network !== "devnet" && cfg.network !== "mainnet") throw new Error(`unknown network ${String(cfg.network)}`);
  const mainnet = cfg.network === "mainnet";
  const rpcUrl = env.HASH_RPC_URL ?? (mainnet ? undefined : cfg.rpc ?? "https://api.devnet.solana.com");
  const keypairPath = env.HASH_KEYPAIR ? resolve(env.HASH_KEYPAIR) : null;
  const dataDir = resolve(env.HASH_DATA_DIR ?? here("../data"));

  // Devnet throwaway keys may sit in the gitignored data folders; anything else in the repo is refused.
  const devnetKeyDirs = [resolve(here("../data")), resolve(REPO_ROOT, "packages/chain/data")];
  if (keypairPath && insideRepo(keypairPath) && !devnetKeyDirs.some((d) => inside(d, keypairPath))) {
    throw new Error(`HASH_KEYPAIR ${keypairPath} is inside the repository: keep keys outside it (or in the gitignored services/payouts/data or packages/chain/data on devnet)`);
  }
  let multisig: PublicKey | undefined;
  if (env.HASH_MULTISIG) {
    try { multisig = new PublicKey(env.HASH_MULTISIG); } catch { throw new Error("HASH_MULTISIG is not a Solana address"); }
  }
  if (env.HASH_DEV_WALLET) {
    try { new PublicKey(env.HASH_DEV_WALLET); } catch { throw new Error("HASH_DEV_WALLET is not a Solana address"); }
  }

  if (mainnet) {
    if (env.HASH_MAINNET !== "yes") throw new Error("network is mainnet: set HASH_MAINNET=yes to confirm");
    if (!rpcUrl) throw new Error("mainnet needs HASH_RPC_URL (a dedicated RPC such as Helius; the public endpoint refuses Token-2022 scans and rate-limits)");
    if (PUBLIC_RPCS.some((h) => rpcUrl.includes(h))) throw new Error("mainnet needs a dedicated RPC in HASH_RPC_URL, not Solana's public endpoint");
    if (!keypairPath) throw new Error("mainnet needs HASH_KEYPAIR (the payout wallet's keypair file, outside the repository)");
    if (insideRepo(keypairPath)) throw new Error("on mainnet HASH_KEYPAIR must be outside the repository");
    if (!env.HASH_DEV_WALLET) throw new Error("mainnet needs HASH_DEV_WALLET (where the dev share goes)");
    if (!cfg.market) throw new Error("mainnet needs `market` in the config (the token's mint and DBC config)");
    if (cfg.simulate?.miners?.length || cfg.simulate?.trades?.enabled) throw new Error("`simulate` is devnet only");
    if (cfg.settlement.mode !== "sales") throw new Error("mainnet pays held-back mining from coin sales: settlement.mode must be \"sales\"");
    if (cfg.solUsd.source !== "live") throw new Error("mainnet needs a live SOL price (solUsd.source \"live\")");
    if (!multisig) warnings.push("HASH_MULTISIG not set: rate changes are sent by the payout wallet if it holds the fee authority");
    if (!env.HASH_ALERT_WEBHOOK) warnings.push("HASH_ALERT_WEBHOOK not set: alerts only go to the log and data/alerts.log");
  }
  if (!cfg.market && cfg.priceUsd === undefined) throw new Error("without `market` the config needs `priceUsd`");
  const envKill = env.HASH_KILL && env.HASH_KILL !== "0" ? `HASH_KILL=${env.HASH_KILL}` : null;
  return {
    cfg, configPath, rpcUrl: rpcUrl!, dataDir, keypairPath, devWallet: env.HASH_DEV_WALLET, multisig,
    webhook: env.HASH_ALERT_WEBHOOK, envKill, warnings,
  };
}

/** A keypair file as written by `solana-keygen` (a JSON array of 64 numbers). */
export function readKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  if (!Array.isArray(raw) || raw.length !== 64) throw new Error(`${path} is not a keypair file`);
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export const dataPath = (rt: Runtime, ...parts: string[]) => resolve(rt.dataDir, ...parts);
