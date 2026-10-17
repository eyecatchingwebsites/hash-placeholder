// The payout loop: runs on its own, round after round.
//   every few minutes   collector: pool stats → mining hours and mined USD per wallet (trued up to the pool)
//   every round         market phase (curve / graduating / DAMM v2) and price → claim our curve trading fee (SOL)
//                       → index transfers (hold clocks) → harvest the tax → set the rate by the formula
//                       → split → buy miners' $HASH on the market with the SOL float → pay miners, holders,
//                       dev → public record → alerts
//
//   npx tsx services/payouts/src/main.ts             run until stopped (Ctrl+C)
//   npx tsx services/payouts/src/main.ts --once      one collect + one round, then exit
//   npx tsx services/payouts/src/main.ts --dry-run   compute one round from live data, send nothing, save nothing
//
// Settings: config/payouts.json plus the environment (src/config.ts lists every variable).
// Kill switch: `npx tsx services/payouts/src/ctl.ts kill "why"` (or HASH_KILL=1) blocks every send at once.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ComputeBudgetProgram, type Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, type Transaction } from "@solana/web3.js";
import { getMint, getTransferFeeConfig, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { DEFAULT_RULES, type PriceContext } from "@hashcoin/engine";
import {
  grossUp, guardSends, harvestFees, lamportsForUsd, MeteoraMarket, mintTransactionsSince, monitoredConnection, sendBatch, SendBlockedError, setTaxRate,
  tokenBalance, tokenDeltaOf, transferFeeNow, usdToBaseUnits, withheldTotal, type MarketState, type Transfer,
} from "@hashcoin/chain";
import { runCollector, trueUpsOf, walletsOf } from "@hashcoin/collector";
import { Alerts, RpcWatch } from "./alerts.js";
import { dataPath, loadRuntime, readKeypair, REPO_ROOT } from "./config.js";
import { killReason, pauseFile } from "./control.js";
import { resolveInFlight } from "./inflight.js";
import { indexTransactions } from "./indexer.js";
import { addBig, day, emptyLedger, type Ledger, loadLedger, recordPrice, saveLedger } from "./ledger.js";
import { rateProposal } from "./proposal.js";
import { type MarketStatus, publicRecord, type RoundSummary } from "./publish.js";
import { solUsd } from "./price.js";
import { decideRate } from "./rate.js";
import { payoutParts, planRound, recordSent, stageRound } from "./round.js";

const rt = loadRuntime();
const cfg = rt.cfg;
const DRY = process.argv.includes("--dry-run");
const ONCE = DRY || process.argv.includes("--once");
const readJson = <T>(path: string, fallback: T): T => { try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; } };
for (const d of ["rounds", "dry-run", "proposals"]) mkdirSync(dataPath(rt, d), { recursive: true });

const log = (msg: string) => console.log(`${new Date().toLocaleTimeString()}  ${DRY ? "[dry run] " : ""}${msg}`);
const rpcWatch = new RpcWatch();
const alerts = new Alerts({ webhook: rt.webhook, logFile: dataPath(rt, "alerts.log"), stateFile: DRY ? undefined : dataPath(rt, "alerts-state.json"), repeatMs: cfg.alerts.repeatMinutes * 60_000, label: `$HASH payouts (${cfg.network}${DRY ? ", dry run" : ""})` });
// Every send passes this check, so the kill switch stops a round mid-way and a dry run can't send.
const conn: Connection = guardSends(monitoredConnection(rt.rpcUrl, rpcWatch.record), () => (DRY ? "dry run" : killReason(rt.dataDir, rt.envKill)));
const send = (tx: Transaction, signers: Keypair[]) => {
  if (cfg.priorityFeeMicroLamports) tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cfg.priorityFeeMicroLamports }));
  return sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
};

// Keys: the payout wallet from HASH_KEYPAIR; without it, the Oct 4 devnet rehearsal's throwaway keys.
const CHAIN_DATA = resolve(REPO_ROOT, "packages/chain/data");
const legacy = rt.keypairPath ? null : readJson<{ treasury: number[]; dev: number[] } | null>(resolve(CHAIN_DATA, "devnet-keys.json"), null);
if (!rt.keypairPath && (!legacy || cfg.network !== "devnet")) throw new Error("set HASH_KEYPAIR to the payout wallet's keypair file");
const signer = rt.keypairPath ? readKeypair(rt.keypairPath) : Keypair.fromSecretKey(Uint8Array.from(legacy!.treasury));
const devAddress = rt.devWallet ?? (legacy ? Keypair.fromSecretKey(Uint8Array.from(legacy.dev)).publicKey.toBase58() : signer.publicKey.toBase58());
const mintStr = cfg.market?.mint ?? readJson<{ mint?: string }>(resolve(CHAIN_DATA, "devnet-state.json"), {}).mint;
if (!mintStr) throw new Error("no mint: set `market` in the config");
const mint = new PublicKey(mintStr);
const market = cfg.market ? new MeteoraMarket(conn, { mint, dbcConfig: new PublicKey(cfg.market.dbcConfig), dammPool: cfg.market.dammPool ? new PublicKey(cfg.market.dammPool) : undefined }) : null;

const LEDGER = dataPath(rt, "ledger.json");
const ROUNDS = dataPath(rt, "rounds.json");
let ledger: Ledger = loadLedger(LEDGER) ?? emptyLedger(cfg.network, mint.toBase58());
if (ledger.mint !== mint.toBase58()) throw new Error(`ledger is for mint ${ledger.mint}, not ${mint.toBase58()}: use another HASH_DATA_DIR or move ${LEDGER} aside`);
const rounds = readJson<RoundSummary[]>(ROUNDS, []);
const rules = DEFAULT_RULES;
const platform = new Set([signer.publicKey.toBase58(), devAddress]);
const explorer = (sig: string) => `https://solscan.io/tx/${sig}${cfg.network === "devnet" ? "?cluster=devnet" : ""}`;
const tokens = (b: bigint) => Number(b) / 10 ** cfg.decimals;
const short = (e: unknown) => (e as Error).message.split("\n")[0]!;

// Devnet stand-in for the no-market rehearsal: a "market" wallet trading with test traders.
const sim = cfg.simulate?.trades?.enabled ? (() => {
  const file = dataPath(rt, "sim-keys.json");
  const saved = readJson<{ market: number[]; traders: number[][] } | null>(file, null);
  const s = saved ?? { market: [...Keypair.generate().secretKey], traders: Array.from({ length: cfg.simulate!.trades!.traders }, () => [...Keypair.generate().secretKey]) };
  if (!saved) writeFileSync(file, JSON.stringify(s));
  const kp = (x: number[]) => Keypair.fromSecretKey(Uint8Array.from(x));
  return { market: kp(s.market), traders: s.traders.map(kp) };
})() : null;

// One thing at a time: collector runs and rounds both change the ledger.
let queue: Promise<unknown> = Promise.resolve();
const serial = (name: string, f: () => Promise<void>) => (queue = queue.then(f).catch(async (e) => {
  log(`${name} failed: ${short(e)}`);
  if (name === "round") await alerts.raise("round-failed", "critical", `round failed: ${short(e)}${rpcWatch.recent().length ? ` (RPC errors: ${rpcWatch.summary()})` : ""}`);
  else await alerts.raise(`${name}-failed`, "warning", `${name} failed: ${short(e)}`);
}).then(checkRpc));

async function checkRpc() {
  const n = rpcWatch.recent().length;
  if (n >= cfg.alerts.rpcErrorsPer10Min) await alerts.raise("rpc-errors", "warning", `${n} RPC errors in the last 10 minutes: ${rpcWatch.summary()}`);
  else if (n === 0) alerts.resolve("rpc-errors");
}

let lastCollect = Date.now() - cfg.collectorMinutes * 60_000;
let collectorFailures = 0;
async function collectTick() {
  const now = Date.now();
  const credit = (wallet: string, usd: number) => {
    ledger.minedSinceRound[wallet] = (ledger.minedSinceRound[wallet] ?? 0) + usd;
    day(ledger, now).minedUsd += usd;
  };
  let summary = "";
  if (!DRY) {
    const report = await runCollector(false);
    const wallets = walletsOf(report);
    for (const w of wallets) { credit(w.wallet, w.minedUsd); ledger.hoursInWindow[w.wallet] = w.hoursInWindow; }
    // What was credited, per coin, waits to be sold (`ctl sold` trues held-back mining up to the sale).
    for (const [coin, c] of Object.entries(report)) {
      const ws = (c as { wallets?: { minedCoins: number; minedUsd: number }[] } | null)?.wallets;
      if (!Array.isArray(ws)) continue;
      const u = (ledger.funding.unsold[coin] ??= { coins: 0, usd: 0 });
      for (const w of ws) { u.coins += w.minedCoins; u.usd += w.minedUsd; }
    }
    const errors = Object.entries(report).filter(([, v]) => v && typeof v === "object" && "error" in v).map(([k, v]) => `${k}: ${(v as { error: string }).error}`);
    collectorFailures = errors.length ? collectorFailures + 1 : 0;
    if (collectorFailures >= 3) await alerts.raise("collector", "warning", `collector failing ${collectorFailures} runs in a row: ${errors.join("; ")}`);
    else if (!collectorFailures) alerts.resolve("collector");
    for (const [coin, t] of Object.entries(trueUpsOf(report))) {
      if (t.flag) await alerts.raise(`trueup-${coin}`, "warning", `${coin} true-up: ${t.flag}`);
    }
    const ratios = Object.entries(trueUpsOf(report)).map(([c, t]) => `${c} x${t.ratio.toFixed(3)}`).join(", ");
    summary = `${wallets.flatMap((w) => w.gpus).length} GPU(s) mining, +$${wallets.reduce((a, w) => a + w.minedUsd, 0).toFixed(4)} mined${ratios ? ` (true-up ${ratios})` : ""}${errors.length ? `; ${errors.join("; ")}` : ""}`;
  }
  // Devnet stand-in: fake miners with a fixed USD rate, so the market buys have something to buy.
  const hours = (now - lastCollect) / 3_600_000;
  lastCollect = now;
  for (const m of cfg.simulate?.miners ?? []) {
    credit(m.wallet, m.usdPerHour * hours);
    ledger.hoursInWindow[m.wallet] = Math.max(ledger.hoursInWindow[m.wallet] ?? 0, 1);
    // As if mined in PRL at the assumed price, so `ctl sold` can be rehearsed.
    const u = (ledger.funding.unsold.PRL ??= { coins: 0, usd: 0 });
    u.coins += (m.usdPerHour * hours) / (cfg.simulate!.prlPriceUsd ?? 1.87);
    u.usd += m.usdPerHour * hours;
  }
  if (cfg.simulate?.miners?.length) summary += `${summary ? "; " : ""}${cfg.simulate.miners.length} simulated miner(s) credited $${(cfg.simulate.miners.reduce((a, m) => a + m.usdPerHour, 0) * hours).toFixed(4)}`;
  if (!DRY) saveLedger(LEDGER, ledger);
  if (summary) log(`collector: ${summary}`);
}

/**
 * What a confirmed buy put in the payout wallet, from the transaction itself. If it can't be read, the
 * swap's guaranteed minimum (the program refuses to fill below it): miners get at least that, and any
 * extra stays in the treasury. Never a balance difference: one failed read made that negative (Oct 17).
 */
async function boughtBy(signature: string, minimumOut: bigint): Promise<bigint> {
  for (let i = 0; i < 4; i++) {
    try {
      const d = await tokenDeltaOf(conn, signature, signer.publicKey, mint);
      if (d !== null && d > 0n) return d;
    } catch { /* RPC trouble: try again */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  log(`couldn't read what buy ${signature} returned; counting the guaranteed minimum ${tokens(minimumOut)} $HASH`);
  return minimumOut;
}

/** The no-market rehearsal's trading: the market wallet sells to traders, some sell back. */
async function simulateTrades(fee: { bps: number; max: bigint }, priceUsd: number): Promise<string[]> {
  const s = cfg.simulate!.trades!;
  const sigs: string[] = [];
  const marketBal = await tokenBalance(conn, sim!.market.publicKey, mint);
  const want = BigInt(s.marketTokens) * 10n ** BigInt(cfg.decimals);
  if (marketBal < want / 2n) {
    const r = await sendBatch(conn, signer, signer, mint, cfg.decimals, fee, [{ to: sim!.market.publicKey, amount: want - marketBal }], { netOfFee: false });
    sigs.push(...r.map((x) => x.signature));
  }
  const perRoundUsd = (s.dailyVolumeUsd * cfg.roundMinutes) / (24 * 60);
  const jitter = () => 0.5 + Math.random();
  const buyer = sim!.traders[Math.floor(Math.random() * sim!.traders.length)]!;
  sigs.push(...(await sendBatch(conn, signer, sim!.market, mint, cfg.decimals, fee, [{ to: buyer.publicKey, amount: usdToBaseUnits(perRoundUsd * 0.65 * jitter(), priceUsd, cfg.decimals) }], { netOfFee: false })).map((x) => x.signature));
  if (Math.random() < 0.5 && s.sellers > 0) {
    const seller = sim!.traders[sim!.traders.length - 1 - Math.floor(Math.random() * s.sellers)]!;
    const bal = await tokenBalance(conn, seller.publicKey, mint);
    const amount = [usdToBaseUnits(perRoundUsd * 0.7 * jitter(), priceUsd, cfg.decimals), bal / 3n].reduce((a, b) => (a < b ? a : b));
    if (amount > 0n) sigs.push(...(await sendBatch(conn, signer, seller, mint, cfg.decimals, fee, [{ to: sim!.market.publicKey, amount }], { netOfFee: false })).map((x) => x.signature));
  }
  return sigs;
}

/**
 * First start on a mint: replay its history into balances and hold clocks. With a Meteora market
 * the history is the launch itself, so its trading and tax count. In the no-market rehearsal the
 * history predates the loop: its tax is swept to the treasury and counting starts now.
 */
async function takeOver(l: Ledger, ctx: { price: PriceContext; pools: Set<string> }) {
  if (market) l.startedAt = 0;
  const found = await mintTransactionsSince(conn, mint, l.lastSignature, { pauseMs: cfg.rpcPauseMs });
  indexTransactions(l, found, { price: ctx.price, rules, platform, pools: ctx.pools });
  let swept = 0n;
  if (!market && !DRY) swept = (await harvestFees(conn, signer, mint, signer, signer.publicKey, l.tokenAccounts.map((a) => new PublicKey(a)))).harvested;
  if (!market) l.startedAt = Date.now();
  log(`took over: replayed ${found.length} past transactions (${Object.keys(l.wallets).length} wallets)${swept ? `; swept ${tokens(swept).toLocaleString()} $HASH of earlier tax to the treasury` : ""}`);
}

async function roundTick() {
  const kill = DRY ? null : killReason(rt.dataDir, rt.envKill);
  if (kill) {
    log(`${kill}: round skipped, nothing sent (\`ctl resume\` to release)`);
    await alerts.raise("kill-switch", "warning", `${kill}. Every send is blocked; rounds skip until \`ctl resume\`.`);
    return;
  }
  alerts.resolve("kill-switch");
  if (!DRY && existsSync(pauseFile(rt.dataDir))) { log(`paused (delete ${pauseFile(rt.dataDir)} to resume)`); return; }

  // A dry run works on a copy and never saves it.
  const l: Ledger = DRY ? structuredClone(ledger) : ledger;
  const now = Date.now();
  const notes: string[] = [];
  const txs: string[] = [];
  // Payouts sent last time but never confirmed (crash, stop, timeout): landed ones count as paid.
  if (l.owed.some((o) => o.inFlight)) {
    const r = await resolveInFlight(l, {
      statuses: async (sigs) => (await conn.getSignatureStatuses(sigs, { searchTransactionHistory: true })).value,
      blockHeight: () => conn.getBlockHeight("confirmed"),
    }, { now, decimals: cfg.decimals });
    if (!DRY) saveLedger(LEDGER, l);
    log(`unconfirmed payouts from last time: ${r.landed} had landed (recorded as paid${r.signatures.length ? `: ${r.signatures.map(explorer).join(", ")}` : ""}), ${r.retry} didn't and are paid this round`);
  }
  let lamports = BigInt(await conn.getBalance(signer.publicKey));
  if (Number(lamports) / LAMPORTS_PER_SOL < cfg.minTreasurySol) {
    await alerts.raise("float-low", "critical", `payout wallet ${signer.publicKey.toBase58()} has ${Number(lamports) / LAMPORTS_PER_SOL} SOL, below ${cfg.minTreasurySol}: rounds wait until it's funded`);
    return;
  }
  let fee = await transferFeeNow(conn, mint);

  // 0. The market: phase, price, and our curve trading fee.
  let ms: MarketState | null = market ? await market.state() : null;
  const sol = market || cfg.solUsd.source === "fixed" ? await solUsd(cfg.solUsd) : null;
  const priceUsd = ms ? ms.priceSol * sol!.usd : cfg.priceUsd!;
  if (!(priceUsd > 0)) throw new Error(`no $HASH price (${ms?.phase ?? "no market"})`);
  const levelUsd = recordPrice(l, now, priceUsd);
  const price: PriceContext = { priceUsd, decimals: cfg.decimals };
  const levelPrice: PriceContext = { priceUsd: levelUsd, decimals: cfg.decimals };
  const pools = new Set((ms?.poolOwners ?? []).map((k) => k.toBase58()));
  const excluded = new Set([...platform, ...pools, ...(cfg.excluded ?? []), ...(sim ? [sim.market.publicKey.toBase58()] : [])]);
  if (ms && l.marketPhase !== ms.phase) {
    if (l.marketPhase) await alerts.raise(`phase-${ms.phase}`, "info", `market phase ${l.marketPhase} → ${ms.phase}${ms.phase === "graduating" ? ": buys wait until the pool migrates to DAMM v2" : ""}`);
    l.marketPhase = ms.phase;
  }
  if (l.startedAt === Number.MAX_SAFE_INTEGER) await takeOver(l, { price: levelPrice, pools });

  if (ms && ms.partnerClaimableLamports >= BigInt(Math.round(cfg.funding.claimPartnerFeeMinSol * LAMPORTS_PER_SOL))) {
    const sols = Number(ms.partnerClaimableLamports) / LAMPORTS_PER_SOL;
    if (!ms.feeClaimer.equals(signer.publicKey)) notes.push(`${sols} SOL of curve trading fee waits for ${ms.feeClaimer.toBase58()} to claim (not this wallet)`);
    else if (DRY) notes.push(`would claim ${sols} SOL of curve trading fee`);
    else {
      try {
        const sig = await send(await market!.claimPartnerFeeTx(signer.publicKey), [signer]);
        txs.push(sig);
        l.funding.partnerFeesLamports = addBig(l.funding.partnerFeesLamports, ms.partnerClaimableLamports);
        l.funding.claims.push({ at: now, lamports: ms.partnerClaimableLamports.toString(), signature: sig });
        lamports = BigInt(await conn.getBalance(signer.publicKey));
        log(`claimed ${sols} SOL of curve trading fee into the float`);
      } catch (e) {
        await alerts.raise("claim-failed", "warning", `claiming the curve trading fee failed: ${short(e)}`);
      }
    }
  }

  // After graduation our locked DAMM v2 position earns the pool fee (SOL, and maybe some $HASH).
  if (ms?.phase === "damm") {
    const pf = await market!.dammFees(ms, signer.publicKey);
    if (pf.lamports >= BigInt(Math.round(cfg.funding.claimPartnerFeeMinSol * LAMPORTS_PER_SOL))) {
      const what = `${Number(pf.lamports) / LAMPORTS_PER_SOL} SOL${pf.tokens ? ` and ${tokens(pf.tokens)} $HASH` : ""} of pool fee`;
      if (DRY) notes.push(`would claim ${what}`);
      else {
        try {
          for (const p of pf.positions) {
            const sig = await send(await market!.claimDammFeeTx(ms, signer.publicKey, p), [signer]);
            txs.push(sig);
            l.funding.claims.push({ at: now, lamports: pf.lamports.toString(), tokens: pf.tokens.toString(), source: "pool", signature: sig });
          }
          l.funding.poolFeesLamports = addBig(l.funding.poolFeesLamports, pf.lamports);
          l.funding.poolFeesTokens = addBig(l.funding.poolFeesTokens, pf.tokens);
          lamports = BigInt(await conn.getBalance(signer.publicKey));
          log(`claimed ${what} into the float`);
        } catch (e) {
          await alerts.raise("claim-failed", "warning", `claiming the DAMM v2 pool fee failed: ${short(e)}`);
        }
      }
    }
  }

  if (sim && !DRY) txs.push(...await simulateTrades(fee, priceUsd));

  // 1. Index every mint transaction since last time: balances, hold clocks, trading volume.
  const found = await mintTransactionsSince(conn, mint, l.lastSignature, { pauseMs: cfg.rpcPauseMs });
  const volume = indexTransactions(l, found, { price: levelPrice, rules, platform, pools });

  // 2. Harvest the tax. Fees our own transactions paid go back to the treasury, not the pot.
  // Only the tax withdraw authority can harvest: the launch's partner (fee claimer) must be this wallet.
  const withdrawAuth = getTransferFeeConfig(await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID))?.withdrawWithheldAuthority ?? null;
  if (!withdrawAuth?.equals(signer.publicKey)) {
    if (!DRY) saveLedger(LEDGER, l);
    await alerts.raise("wrong-authority", "critical", `the tax withdraw authority is ${withdrawAuth?.toBase58() ?? "none"}, not this payout wallet (${signer.publicKey.toBase58()}): the tax can't be harvested, so no round runs. Launch with the payout wallet as --partner, or run the loop with that key.`);
    return;
  }
  const candidates = l.tokenAccounts.map((a) => new PublicKey(a));
  let harvested: bigint;
  if (DRY) harvested = await withheldTotal(conn, mint, candidates);
  else {
    const h = await harvestFees(conn, signer, mint, signer, signer.publicKey, candidates);
    txs.push(...h.signatures);
    harvested = h.harvested;
  }
  const ownBefore = BigInt(l.ownFeesUnharvested);
  const own = harvested < ownBefore ? harvested : ownBefore;
  l.ownFeesUnharvested = (ownBefore - own).toString();
  // Saved before anything else can fail: tax from a round that crashes is split next round.
  l.taxUnallocated = addBig(l.taxUnallocated, harvested - own);
  if (!DRY) saveLedger(LEDGER, l);
  const taxTokens = BigInt(l.taxUnallocated);
  // "Empty" means no tax from outside trading (fees on our own transfers always come back).
  l.emptyHarvestRounds = harvested - own === 0n ? l.emptyHarvestRounds + 1 : 0;
  if (l.emptyHarvestRounds >= cfg.alerts.emptyHarvestRounds) {
    await alerts.raise("harvest-empty", "warning", `the harvest has found no tax from trading for ${l.emptyHarvestRounds} rounds in a row (no trading, or the indexer is missing accounts)`);
  } else if (l.emptyHarvestRounds === 0) alerts.resolve("harvest-empty");

  // 3. The tax rate, by the public formula (on-chain ~4 days later). Fixed while on the curve.
  fee = await transferFeeNow(conn, mint);
  const decision = cfg.rate.adjust ? decideRate(l, { now, priceUsd, liveBps: fee.bps, scheduledBps: fee.scheduled?.bps }, cfg.rate, rules) : null;
  if (decision) {
    const authority = getTransferFeeConfig(await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID))?.transferFeeConfigAuthority ?? null;
    const what = `tax rate → ${decision.bps / 100}%: ${decision.reason}`;
    if (!authority) notes.push(`${what} (not set: the rate is locked)`);
    else if (authority.equals(signer.publicKey)) {
      if (DRY) notes.push(`would schedule ${what}`);
      else {
        const signature = await setTaxRate(conn, signer, mint, signer, decision.bps, fee.max);
        l.rateChanges.push({ at: now, bps: decision.bps, effectiveEpoch: fee.epoch + 2, reason: decision.reason, signature });
        txs.push(signature);
        log(`${what} (from epoch ${fee.epoch + 2})`);
      }
    } else if (rt.multisig && authority.equals(rt.multisig)) {
      const p = rateProposal({ mint, multisig: rt.multisig, bps: decision.bps, maxFee: fee.max, reason: decision.reason, now });
      if (DRY) notes.push(`would propose to the multisig: ${what}`);
      else {
        const file = dataPath(rt, "proposals", `${new Date(now).toISOString().replace(/[:.]/g, "-")}-tax-rate.json`);
        writeFileSync(file, JSON.stringify(p, null, 2));
        l.rateChanges.push({ at: now, bps: decision.bps, reason: decision.reason, proposed: file });
        await alerts.raise(`rate-proposal-${decision.bps}`, "info", `the formula wants ${what}. Proposal for the multisig: ${file}`);
      }
    } else notes.push(`${what} (not set: the fee authority is ${authority.toBase58()}${ms?.phase === "curve" ? ", the curve's, until graduation" : ""})`);
  }

  // 4. What the float can fund: SOL above the reserve, less sale proceeds kept for held-back mining.
  const reserve = BigInt(Math.round(cfg.funding.reserveSol * LAMPORTS_PER_SOL));
  const saleKept = market && sol ? lamportsForUsd(l.funding.saleBudgetUsd, sol.usd, fee.bps) : 0n;
  const floatLamports = lamports > reserve + saleKept ? lamports - reserve - saleKept : 0n;
  const floatUsd = sol ? (Number(floatLamports) / LAMPORTS_PER_SOL) * sol.usd : 0;
  // Buying X of mining costs X grossed up for the transfer fee, plus the pool's fee and price impact.
  const immediateBudgetUsd = market ? Math.min(cfg.buy.maxUsdPerRound, floatUsd * (1 - fee.bps / 10_000) * (1 - cfg.buy.maxCostBps / 10_000)) : Number.MAX_SAFE_INTEGER;

  const roundId = `${cfg.network}-${l.round + 1}`;
  const plan = planRound({
    ledger: l, now, roundId, taxTokens, rateBps: fee.bps, price, levelPrice, rules, excluded, dev: devAddress,
    payHolders: (l.round + 1) % Math.max(1, cfg.holderEveryRounds) === 0, floatAvailableUsd: immediateBudgetUsd,
    settlement: { mode: cfg.settlement.mode, minAgeMs: cfg.settlement.minAgeHours * 3_600_000, budgetUsd: l.funding.saleBudgetUsd, ratio: l.funding.saleRatio },
    minHolderPayoutUsd: cfg.minHolderPayoutUsd,
  });
  if (plan.payouts.length === 0 && taxTokens === 0n && plan.minedUsd === 0) {
    if (!DRY) saveLedger(LEDGER, l);
    log(`round skipped: nothing to pay (indexed ${found.length} tx, ${tokens(volume).toFixed(2)} $HASH traded${ms ? `, ${ms.phase}` : ""})`);
    return;
  }
  const totalUsd = plan.payouts.reduce((a, p) => a + p.usd, 0);
  if (totalUsd > cfg.maxPayoutUsdPerRound) {
    if (!DRY) {
      writeFileSync(pauseFile(rt.dataDir), `round ${roundId} wanted to pay $${totalUsd.toFixed(2)}, over the $${cfg.maxPayoutUsdPerRound} limit\n`);
      saveLedger(LEDGER, l);
    }
    await alerts.raise("round-too-big", "critical", `PAUSED: round ${roundId} wants to pay $${totalUsd.toFixed(2)}, over the $${cfg.maxPayoutUsdPerRound} limit. Check it, then delete ${pauseFile(rt.dataDir)}.`);
    return;
  }

  // 5. Buy the miners' $HASH: their mining value in SOL, grossed up for the transfer fee so they
  // receive the full amount (the withheld part returns to the treasury at the next harvest).
  let bought: bigint | null = null;
  let buyInfo: { lamports: string; quotedTokens: string; minimumTokens: string; costBps: number; phase: string; signature?: string } | undefined;
  if (plan.buyUsd > 0) {
    if (!market) bought = usdToBaseUnits(plan.buyUsd, priceUsd, cfg.decimals); // rehearsal: paid from treasury supply
    else if (ms!.phase === "graduating") {
      notes.push(`no buy: the curve is graduating ($${plan.buyUsd.toFixed(4)} of mining stays owed)`);
      await alerts.raise("graduating", "info", "the curve is full and waiting for migration to DAMM v2: miners' buys wait (owed) until it migrates");
    } else {
      const lamportsIn = lamportsForUsd(plan.buyUsd, sol!.usd, fee.bps);
      if (lamportsIn > lamports - reserve) {
        await alerts.raise("float-low", "critical", `the buy needs ${Number(lamportsIn) / 1e9} SOL but the float has ${Number(lamports - reserve) / 1e9} above the reserve: miners' mining stays owed`);
      } else {
        try {
          const q = await market.quoteBuy(ms!, lamportsIn, cfg.buy.slippageBps, fee.bps);
          buyInfo = { lamports: lamportsIn.toString(), quotedTokens: q.expectedOut.toString(), minimumTokens: q.minimumOut.toString(), costBps: q.costBps, phase: q.phase };
          if (q.costBps > cfg.buy.maxCostBps) {
            await alerts.raise("buy-cost", "warning", `buy refused: pool fee + price impact ${q.costBps / 100}% is over the ${cfg.buy.maxCostBps / 100}% limit ($${plan.buyUsd.toFixed(2)}); mining stays owed`);
          } else if (DRY) bought = q.expectedOut;
          else {
            const sig = await send(await market.buyTx(q, signer.publicKey), [signer]);
            bought = await boughtBy(sig, q.minimumOut);
            buyInfo.signature = sig;
            txs.push(sig);
            l.funding.spentLamports = addBig(l.funding.spentLamports, lamportsIn);
            l.funding.boughtTokens = addBig(l.funding.boughtTokens, bought);
            l.funding.buys.push({ at: now, round: l.round + 1, phase: q.phase, lamports: lamportsIn.toString(), tokens: bought.toString(), costBps: q.costBps, signature: sig });
            l.funding.buys = l.funding.buys.slice(-500);
            alerts.resolve("buy-failed");
            log(`bought ${tokens(bought).toLocaleString()} $HASH for ${Number(lamportsIn) / 1e9} SOL on the ${q.phase === "curve" ? "curve" : "DAMM v2 pool"} (quoted ${tokens(q.expectedOut).toLocaleString()}, cost ${q.costBps / 100}%)`);
          }
        } catch (e) {
          await alerts.raise("buy-failed", "warning", `market buy failed: ${short(e)}; miners' mining stays owed`);
        }
      }
    }
  }

  // 6. Pay, five transfers per transaction. A failed transaction's payouts are owed next round.
  const parts = payoutParts(plan.payouts, bought, (usd) => usdToBaseUnits(usd, priceUsd, cfg.decimals));
  const amounts = parts.map((x) => x.total);
  const need = amounts.reduce<bigint>((a, x) => a + (x ? grossUp(x, fee.bps, fee.max) : 0n), 0n);
  // A dry run didn't harvest or buy, so count what a real round would have had by now.
  // Only an alert: an RPC hiccup here must not fail a round whose buy has already landed.
  const held = await tokenBalance(conn, signer.publicKey, mint).catch(() => null);
  const have = held === null ? null : held + (DRY ? harvested + (market ? bought ?? 0n : 0n) : 0n);
  if (have !== null && need > have) await alerts.raise("tokens-low", "critical", `payouts need ${tokens(need)} $HASH but the payout wallet holds ${tokens(have)}`);
  const roundNo = l.round + 1;
  const sent: (bigint | undefined)[] = amounts.map((a) => (a === 0n ? 0n : undefined));
  const transfers: { t: Transfer; k: number }[] = amounts.flatMap((a, k) => (a && a > 0n ? [{ t: { to: new PublicKey(plan.payouts[k]!.address), amount: a }, k }] : []));
  let failedTx = 0;
  if (DRY) for (const { t, k } of transfers) sent[k] = t.amount;
  else {
    // Write-ahead: the whole round is recorded as owed before the first transfer; each one that
    // lands is cleared. A crash from here on leaves the unsent part owed with its tokens.
    const staged = stageRound(l, plan, { now, taxTokens, decimals: cfg.decimals, settlementMode: cfg.settlement.mode }, amounts, parts.map((x) => x.fromTax));
    amounts.forEach((a, k) => { if (a === 0n) recordSent(l, staged[k]!, 0n, { now, decimals: cfg.decimals }); });
    saveLedger(LEDGER, l);
    for (let i = 0; i < transfers.length; i += 5) {
      const group = transfers.slice(i, i + 5);
      try {
        const r = await sendBatch(conn, signer, signer, mint, cfg.decimals, fee, group.map((g) => g.t), {
          netOfFee: true, perTx: 5, priorityMicroLamports: cfg.priorityFeeMicroLamports,
          // Recorded before sending: if we never hear back, the next round checks whether it landed.
          onSigned: (tx) => { for (const g of group) staged[g.k]!.inFlight = tx; saveLedger(LEDGER, l); },
        });
        txs.push(...r.map((x) => x.signature));
        for (const [j, t] of r.flatMap((x) => x.transfers).entries()) {
          const k = group[j]!.k;
          sent[k] = t.amount;
          recordSent(l, staged[k]!, t.amount, { now, decimals: cfg.decimals });
        }
        saveLedger(LEDGER, l);
      } catch (e) {
        failedTx += 1;
        // Blocked by the kill switch: never sent. Anything else may have been sent: it keeps its
        // record and is checked on chain next round.
        if (e instanceof SendBlockedError) for (const g of group) delete staged[g.k]!.inFlight;
        log(`payout transaction failed (owed next round${group.some((g) => staged[g.k]!.inFlight) ? "; checked on chain first" : ""}): ${short(e)}`);
      }
    }
    if (failedTx) await alerts.raise("payout-failed", "warning", `${failedTx} payout transaction(s) failed; owed next round`);
    else alerts.resolve("payout-failed");
  }

  const summary: RoundSummary = {
    round: roundNo, at: new Date(now).toISOString(), rateBps: fee.bps, taxUsd: plan.taxUsd, minedUsd: plan.minedUsd,
    split: { devUsd: plan.split.devUsd, chestUsd: plan.split.chestUsd, holderUsd: plan.split.holderUsd },
    miners: plan.epoch.lines.length, holders: plan.holders?.lines.length ?? 0,
    paidTokens: sent.reduce<number>((a, s) => a + (s ? tokens(s) : 0), 0), transactions: txs,
  };
  const big = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v instanceof Set ? [...v] : v);
  const marketStatus: MarketStatus = {
    phase: ms?.phase ?? "none", priceSol: ms?.priceSol, solUsd: sol?.usd, curveProgress: ms?.progress,
    floatSol: Number(floatLamports) / LAMPORTS_PER_SOL, floatUsd,
  };
  const detail = { ...summary, priceUsd, levelPriceUsd: levelUsd, solUsd: sol, market: marketStatus, buy: buyInfo, bought, notes, plan, amounts, sent, transactions: txs.map(explorer) };

  if (DRY) {
    const file = dataPath(rt, "dry-run", `round-${roundNo}-${new Date(now).toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify(detail, big, 2));
    log(`round ${roundNo} (not sent): tax $${plan.taxUsd.toFixed(4)} at ${fee.bps / 100}%, mined $${plan.minedUsd.toFixed(4)}, buy $${plan.buyUsd.toFixed(4)}${buyInfo ? ` → ${tokens(BigInt(buyInfo.quotedTokens)).toLocaleString()} $HASH quoted` : ""}; would pay ${transfers.length} transfer(s), ${summary.paidTokens.toFixed(2)} $HASH. Report: ${file}`);
    for (const n of notes) log(`  ${n}`);
    return;
  }

  // 7. The public record.
  rounds.push(summary);
  writeFileSync(ROUNDS, JSON.stringify(rounds.slice(-500)));
  writeFileSync(dataPath(rt, "rounds", `round-${l.round}.json`), JSON.stringify(detail, big, 2));
  writeFileSync(dataPath(rt, "public.json"), JSON.stringify(publicRecord(l, { now, price, levelPrice, rules, excluded, explorer, rate: { bps: fee.bps, scheduled: fee.scheduled ? { bps: fee.scheduled.bps, epoch: fee.scheduled.epoch } : undefined }, rounds, market: marketStatus }), big, 2));

  // 8. Float check for the next rounds.
  if (market && floatUsd < cfg.alerts.floatLowUsd) await alerts.raise("float-low", "warning", `the SOL float is $${floatUsd.toFixed(2)} (${Number(floatLamports) / 1e9} SOL above the reserve), under $${cfg.alerts.floatLowUsd}: new mining is held back until it's topped up (curve fee claims or coin sales)`);
  else if (market) alerts.resolve("float-low");
  alerts.resolve("round-failed");

  const owed = l.owed.length ? `, ${l.owed.length} owed` : "";
  log(`round ${l.round}: tax $${plan.taxUsd.toFixed(4)} at ${fee.bps / 100}% (dev $${plan.split.devUsd.toFixed(4)}, miners $${plan.split.chestUsd.toFixed(4)}, holders $${plan.split.holderUsd.toFixed(4)}), mined $${plan.minedUsd.toFixed(4)}, ${plan.buyUsd > 0 ? (bought === null ? `buy of $${plan.buyUsd.toFixed(4)} not made` : `bought $${plan.buyUsd.toFixed(4)}`) : "nothing to buy"}; ${transfers.filter(({ k }) => sent[k] !== undefined).length} of ${transfers.length} transfer(s) sent (${plan.epoch.lines.length} miner(s), ${plan.holders?.lines.length ?? 0} holder(s)), ${summary.paidTokens.toFixed(2)} $HASH${owed}${ms ? ` [${ms.phase}, $${priceUsd.toPrecision(3)}]` : ""}`);
  for (const n of notes) log(`  ${n}`);
}

// A stray rejection (an SDK's background RPC call hitting a rate limit) must not stop the loop.
process.on("unhandledRejection", (e) => {
  log(`unhandled: ${short(e)}`);
  void alerts.raise("unhandled", "warning", `unhandled error: ${short(e)}`);
});
for (const w of rt.warnings) log(`warning: ${w}`);
log(`payout loop on ${cfg.network}: mint ${mint.toBase58()}, payout wallet ${signer.publicKey.toBase58()}${market ? `, DBC pool ${market.dbcPool.toBase58()}` : ", no market (rehearsal)"}`);
log(`collector every ${cfg.collectorMinutes} min, a round every ${cfg.roundMinutes} min; ${ledger.round} rounds so far; data in ${rt.dataDir}`);
await serial("collector", collectTick);
await serial("round", roundTick);
if (!ONCE) {
  setInterval(() => serial("collector", collectTick), cfg.collectorMinutes * 60_000);
  setInterval(() => serial("round", roundTick), cfg.roundMinutes * 60_000);
}
