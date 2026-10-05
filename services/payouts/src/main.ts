// The payout loop: runs on its own, round after round.
//   every few minutes   collector: pool stats → mining hours and mined USD per wallet
//   every round         index transfers (hold clocks) → harvest the tax → set the rate by the formula
//                       → split → pay miners, holders, dev → public record
//
//   npx tsx services/payouts/src/main.ts           run until stopped (Ctrl+C)
//   npx tsx services/payouts/src/main.ts --once    one collect + one round, then exit
//   Pause payouts: create services/payouts/data/PAUSE (rounds skip until it's deleted).
//
// Devnet only for now. Mainnet still needs market buys of $HASH for the mining part (here the
// treasury pays it from supply) and real settlement from coin sales.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { DEFAULT_RULES, type PriceContext } from "@hashcoin/engine";
import {
  harvestFees, mintTransactionsSince, sendBatch, setTaxRate, tokenBalance, transferFeeNow, usdToBaseUnits, type Transfer,
} from "@hashcoin/chain";
import { runCollector, walletsOf } from "@hashcoin/collector";
import { indexTransactions } from "./indexer.js";
import { day, emptyLedger, type Ledger, loadLedger, saveLedger } from "./ledger.js";
import { publicRecord, type RoundSummary } from "./publish.js";
import { decideRate, type RateConfig } from "./rate.js";
import { commitRound, planRound } from "./round.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const readJson = <T>(path: string, fallback: T): T => { try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; } };

interface Config {
  network: "devnet";
  rpc: string;
  /** Pause between per-transaction RPC reads (public endpoints rate-limit). */
  rpcPauseMs: number;
  collectorMinutes: number;
  roundMinutes: number;
  holderEveryRounds: number;
  /** Devnet has no market: an assumed price (USD per token). */
  priceUsd: number;
  decimals: number;
  rate: RateConfig & { adjust: boolean };
  settleAtEstimateAfterHours: number;
  minHolderPayoutUsd: number;
  /** Safety: a round that wants to pay more than this pauses instead. */
  maxPayoutUsdPerRound: number;
  /** Below this the treasury can't pay fees and rent: rounds wait. */
  minTreasurySol: number;
  /** Devnet stand-in for real trading: a "market" wallet sells to and buys from test traders. */
  simulate: { enabled: boolean; dailyVolumeUsd: number; traders: number; sellers: number; marketTokens: number };
}

const cfg = readJson<Config | null>(here("../config/payouts.json"), null);
if (!cfg) throw new Error("missing services/payouts/config/payouts.json");
if (cfg.network !== "devnet") throw new Error("only devnet is supported: mainnet needs market buys and real settlement first");

const DATA = here("../data");
const CHAIN_DATA = here("../../../packages/chain/data");
const PAUSE = `${DATA}/PAUSE`;
const LEDGER = `${DATA}/ledger.json`;
const ROUNDS = `${DATA}/rounds.json`;
mkdirSync(`${DATA}/rounds`, { recursive: true });

// Throwaway devnet keys from the first devnet round (packages/chain/scripts/devnet-run.ts).
const kp = (secret: number[]) => Keypair.fromSecretKey(Uint8Array.from(secret));
const keys = readJson<{ treasury: number[]; dev: number[]; holders: number[][] } | null>(`${CHAIN_DATA}/devnet-keys.json`, null);
const mintStr = readJson<{ mint?: string }>(`${CHAIN_DATA}/devnet-state.json`, {}).mint;
if (!keys || !mintStr) throw new Error("no devnet mint yet: run `npx tsx packages/chain/scripts/devnet-run.ts` once first");
const treasury = kp(keys.treasury), dev = kp(keys.dev), mint = new PublicKey(mintStr);
const sim = (() => {
  const file = `${DATA}/sim-keys.json`;
  const saved = readJson<{ market: number[]; traders: number[][] } | null>(file, null);
  const s = saved ?? { market: [...Keypair.generate().secretKey], traders: Array.from({ length: cfg.simulate.traders }, () => [...Keypair.generate().secretKey]) };
  if (!saved) writeFileSync(file, JSON.stringify(s));
  return { market: kp(s.market), traders: s.traders.map(kp) };
})();

const conn = new Connection(cfg.rpc, "confirmed");
const price: PriceContext = { priceUsd: cfg.priceUsd, decimals: cfg.decimals };
const rules = DEFAULT_RULES;
const platform = new Set([treasury.publicKey.toBase58(), dev.publicKey.toBase58()]);
// The simulated market stands in for a liquidity pool: never a holder.
const excluded = new Set([...platform, sim.market.publicKey.toBase58()]);
const explorer = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
const tokens = (b: bigint) => Number(b) / 10 ** cfg.decimals;
const log = (msg: string) => console.log(`${new Date().toLocaleTimeString()}  ${msg}`);

let ledger: Ledger = loadLedger(LEDGER) ?? emptyLedger(cfg.network, mint.toBase58());
if (ledger.mint !== mint.toBase58()) throw new Error(`ledger is for mint ${ledger.mint}, not ${mint.toBase58()}: move services/payouts/data/ledger.json aside to start over`);
const rounds = readJson<RoundSummary[]>(ROUNDS, []);

// One thing at a time: collector runs and rounds both change the ledger.
let queue: Promise<unknown> = Promise.resolve();
const serial = (name: string, f: () => Promise<void>) => (queue = queue.then(f).catch((e) => log(`${name} failed: ${(e as Error).message.split("\n")[0]}`)));

async function collectTick() {
  const report = await runCollector(false);
  const wallets = walletsOf(report);
  const now = Date.now();
  for (const w of wallets) {
    ledger.minedSinceRound[w.wallet] = (ledger.minedSinceRound[w.wallet] ?? 0) + w.minedUsd;
    ledger.hoursInWindow[w.wallet] = w.hoursInWindow;
    day(ledger, now).minedUsd += w.minedUsd;
  }
  saveLedger(LEDGER, ledger);
  const errors = Object.entries(report).filter(([, v]) => v && typeof v === "object" && "error" in v).map(([k, v]) => `${k}: ${(v as { error: string }).error}`);
  const gpus = wallets.flatMap((w) => w.gpus);
  log(`collector: ${gpus.length} GPU(s) mining, +$${wallets.reduce((a, w) => a + w.minedUsd, 0).toFixed(4)} mined${errors.length ? `; ${errors.join("; ")}` : ""}`);
}

/** Devnet stand-in for trading: the market wallet sells to traders (buys), some traders sell back. */
async function simulateTrades(fee: { bps: number; max: bigint }): Promise<string[]> {
  const s = cfg!.simulate;
  const sigs: string[] = [];
  const marketBal = await tokenBalance(conn, sim.market.publicKey, mint);
  const want = BigInt(s.marketTokens) * 10n ** BigInt(cfg!.decimals);
  if (marketBal < want / 2n) {
    const r = await sendBatch(conn, treasury, treasury, mint, cfg!.decimals, fee, [{ to: sim.market.publicKey, amount: want - marketBal }], { netOfFee: false });
    sigs.push(...r.map((x) => x.signature));
    log(`simulated market funded with ${tokens(want - marketBal).toLocaleString()} $HASH`);
  }
  const perRoundUsd = (s.dailyVolumeUsd * cfg!.roundMinutes) / (24 * 60);
  const jitter = () => 0.5 + Math.random();
  // A buy: the market sends to a random trader.
  const buyer = sim.traders[Math.floor(Math.random() * sim.traders.length)]!;
  const buy = usdToBaseUnits(perRoundUsd * 0.65 * jitter(), cfg!.priceUsd, cfg!.decimals);
  sigs.push(...(await sendBatch(conn, treasury, sim.market, mint, cfg!.decimals, fee, [{ to: buyer.publicKey, amount: buy }], { netOfFee: false })).map((x) => x.signature));
  // A sell, half the time, by one of the last `sellers` traders (the others only ever buy, so their hold clocks run).
  if (Math.random() < 0.5 && s.sellers > 0) {
    const seller = sim.traders[sim.traders.length - 1 - Math.floor(Math.random() * s.sellers)]!;
    const bal = await tokenBalance(conn, seller.publicKey, mint);
    const amount = [usdToBaseUnits(perRoundUsd * 0.7 * jitter(), cfg!.priceUsd, cfg!.decimals), bal / 3n].reduce((a, b) => (a < b ? a : b));
    if (amount > 0n) sigs.push(...(await sendBatch(conn, treasury, seller, mint, cfg!.decimals, fee, [{ to: sim.market.publicKey, amount }], { netOfFee: false })).map((x) => x.signature));
  }
  return sigs;
}

/**
 * First start on a mint: replay its history (balances and hold clocks only), sweep any tax
 * already sitting in token accounts to the treasury, and count from now on.
 */
async function takeOver() {
  const found = await mintTransactionsSince(conn, mint, ledger.lastSignature, { pauseMs: cfg!.rpcPauseMs });
  indexTransactions(ledger, found, { price, rules, platform });
  const sweep = await harvestFees(conn, treasury, mint, treasury, treasury.publicKey, ledger.tokenAccounts.map((a) => new PublicKey(a)));
  ledger.startedAt = Date.now();
  saveLedger(LEDGER, ledger);
  log(`took over: replayed ${found.length} past transactions (${Object.keys(ledger.wallets).length} wallets); swept ${tokens(sweep.harvested).toLocaleString()} $HASH of earlier tax to the treasury`);
}

async function roundTick() {
  if (existsSync(PAUSE)) { log("paused (delete services/payouts/data/PAUSE to resume)"); return; }
  const sol = (await conn.getBalance(treasury.publicKey)) / LAMPORTS_PER_SOL;
  if (sol < cfg!.minTreasurySol) { log(`treasury has ${sol} SOL; fund ${treasury.publicKey.toBase58()} at https://faucet.solana.com (devnet)`); return; }

  const txs: string[] = [];
  let fee = await transferFeeNow(conn, mint);
  if (cfg!.simulate.enabled) txs.push(...await simulateTrades(fee));

  // 1. Index every mint transaction since last time: balances, hold clocks, trading volume.
  const found = await mintTransactionsSince(conn, mint, ledger.lastSignature, { pauseMs: cfg!.rpcPauseMs });
  const volume = indexTransactions(ledger, found, { price, rules, platform });

  // 2. Harvest the tax. Fees our own payouts paid go back to the treasury, not the pot.
  const harvest = await harvestFees(conn, treasury, mint, treasury, treasury.publicKey, ledger.tokenAccounts.map((a) => new PublicKey(a)));
  txs.push(...harvest.signatures);
  const ownBefore = BigInt(ledger.ownFeesUnharvested);
  const own = harvest.harvested < ownBefore ? harvest.harvested : ownBefore;
  ledger.ownFeesUnharvested = (ownBefore - own).toString();
  const taxTokens = harvest.harvested - own;

  // 3. The tax rate, by the public formula (on-chain ~4 days later).
  const now = Date.now();
  fee = await transferFeeNow(conn, mint);
  const decision = cfg!.rate.adjust ? decideRate(ledger, { now, priceUsd: cfg!.priceUsd, liveBps: fee.bps, scheduledBps: fee.scheduled?.bps }, cfg!.rate, rules) : null;
  if (decision) {
    const signature = await setTaxRate(conn, treasury, mint, treasury, decision.bps, fee.max);
    ledger.rateChanges.push({ at: now, bps: decision.bps, effectiveEpoch: fee.epoch + 2, reason: decision.reason, signature });
    txs.push(signature);
    log(`tax rate → ${decision.bps / 100}% from epoch ${fee.epoch + 2}: ${decision.reason}`);
  }

  // 4. Plan the round.
  const roundId = `devnet-${ledger.round + 1}`;
  const plan = planRound({
    ledger, now, roundId, taxTokens, rateBps: fee.bps, price, rules, excluded, dev: dev.publicKey.toBase58(),
    payHolders: (ledger.round + 1) % Math.max(1, cfg!.holderEveryRounds) === 0,
    settleAtEstimateAfterMs: cfg!.settleAtEstimateAfterHours * 3_600_000, minHolderPayoutUsd: cfg!.minHolderPayoutUsd,
  });
  if (plan.payouts.length === 0 && taxTokens === 0n && plan.minedUsd === 0) {
    saveLedger(LEDGER, ledger);
    log(`round skipped: nothing to pay (indexed ${found.length} tx, ${tokens(volume).toFixed(2)} $HASH traded)`);
    return;
  }
  const totalUsd = plan.payouts.reduce((a, p) => a + p.usd, 0);
  if (totalUsd > cfg!.maxPayoutUsdPerRound) {
    writeFileSync(PAUSE, `round ${roundId} wanted to pay $${totalUsd.toFixed(2)}, over the $${cfg!.maxPayoutUsdPerRound} limit\n`);
    saveLedger(LEDGER, ledger);
    log(`PAUSED: round wants $${totalUsd.toFixed(2)}, over the limit. Check data/rounds, then delete data/PAUSE.`);
    return;
  }

  // 5. Pay, five transfers per transaction. A failed transaction's payouts are owed next round.
  // Devnet has no market, so the treasury pays the mining part from supply; mainnet buys it first.
  const amounts: Transfer[] = plan.payouts.map((p) => ({ to: new PublicKey(p.address), amount: usdToBaseUnits(p.usd, cfg!.priceUsd, cfg!.decimals) }));
  const sent: (bigint | undefined)[] = amounts.map((a) => (a.amount > 0n ? undefined : 0n));
  for (let i = 0; i < amounts.length; i += 5) {
    const group = amounts.slice(i, i + 5).map((t, k) => ({ t, k: i + k })).filter(({ t }) => t.amount > 0n);
    if (!group.length) continue;
    try {
      const r = await sendBatch(conn, treasury, treasury, mint, cfg!.decimals, fee, group.map((g) => g.t), { netOfFee: true, perTx: 5 });
      txs.push(...r.map((x) => x.signature));
      for (const [j, t] of r.flatMap((x) => x.transfers).entries()) sent[group[j]!.k] = t.amount;
    } catch (e) {
      log(`payout transaction failed (owed next round): ${(e as Error).message.split("\n")[0]}`);
    }
  }
  commitRound(ledger, plan, { now, taxTokens, decimals: cfg!.decimals }, sent);
  saveLedger(LEDGER, ledger);

  // 6. The public record.
  const summary: RoundSummary = {
    round: ledger.round, at: new Date(now).toISOString(), rateBps: fee.bps, taxUsd: plan.taxUsd, minedUsd: plan.minedUsd,
    split: { devUsd: plan.split.devUsd, chestUsd: plan.split.chestUsd, holderUsd: plan.split.holderUsd },
    miners: plan.epoch.lines.length, holders: plan.holders?.lines.length ?? 0,
    paidTokens: sent.reduce<number>((a, s) => a + (s ? tokens(s) : 0), 0), transactions: txs,
  };
  rounds.push(summary);
  writeFileSync(ROUNDS, JSON.stringify(rounds.slice(-500)));
  const big = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v instanceof Set ? [...v] : v);
  writeFileSync(`${DATA}/rounds/round-${ledger.round}.json`, JSON.stringify({ ...summary, transactions: txs.map(explorer), plan, sent }, big, 2));
  writeFileSync(`${DATA}/public.json`, JSON.stringify(publicRecord(ledger, { now, price, rules, excluded, explorer, rate: { bps: fee.bps, scheduled: fee.scheduled ? { bps: fee.scheduled.bps, epoch: fee.scheduled.epoch } : undefined }, rounds }), big, 2));

  const failed = ledger.owed.length ? `, ${ledger.owed.length} owed` : "";
  log(`round ${ledger.round}: tax $${plan.taxUsd.toFixed(4)} at ${fee.bps / 100}% (dev $${plan.split.devUsd.toFixed(4)}, miners $${plan.split.chestUsd.toFixed(4)}, holders $${plan.split.holderUsd.toFixed(4)}), mined $${plan.minedUsd.toFixed(4)}; paid ${plan.epoch.lines.length} miner(s), ${plan.holders?.lines.length ?? 0} holder(s), ${summary.paidTokens.toFixed(2)} $HASH${failed}`);
}

log(`payout loop on ${cfg.network}: mint ${mint.toBase58()}, treasury ${treasury.publicKey.toBase58()}`);
log(`collector every ${cfg.collectorMinutes} min, a round every ${cfg.roundMinutes} min; ${ledger.round} rounds so far`);
if (ledger.startedAt === Number.MAX_SAFE_INTEGER) await serial("take-over", takeOver);
if (ledger.startedAt === Number.MAX_SAFE_INTEGER) process.exit(1);
await serial("collector", collectTick);
await serial("round", roundTick);
if (!process.argv.includes("--once")) {
  setInterval(() => serial("collector", collectTick), cfg.collectorMinutes * 60_000);
  setInterval(() => serial("round", roundTick), cfg.roundMinutes * 60_000);
}
