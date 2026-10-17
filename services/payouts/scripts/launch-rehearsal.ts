// Launch-day dress rehearsal on devnet: the real launch script (packages/chain/scripts/launch-mainnet.ts),
// the payout loop in its mainnet setup, the local API and the collector on live Kryptex data, together.
// This script only does the parts a launch day gets from outside: throwaway keys, devnet SOL, traders
// trading, the curve filling up and migrating, a webhook to receive alerts, and the miner's check-in.
// Everything lives in packages/chain/data/rehearsal/ (gitignored). Devnet only. Runbook: docs/LAUNCH-RUNBOOK.md.
//
//   npx tsx services/payouts/scripts/launch-rehearsal.ts keys                 throwaway keys (launcher, dev, payout, traders, multisig stand-in)
//   npx tsx services/payouts/scripts/launch-rehearsal.ts fund <keypair>...    move devnet SOL from old throwaway wallets to the plan's amounts
//   npx tsx services/payouts/scripts/launch-rehearsal.ts config               loop config + env.sh from the launch state (after launch-mainnet.ts)
//   npx tsx services/payouts/scripts/launch-rehearsal.ts webhook              test endpoint for HASH_ALERT_WEBHOOK (port 8798, logs to webhook.log)
//   npx tsx services/payouts/scripts/launch-rehearsal.ts register <api>       the miner's check-in on the local API (records worker → wallet; MINER_WALLET, MINER_RIG)
//   npx tsx services/payouts/scripts/launch-rehearsal.ts trade [n]            n rounds of trader buys and a sell on whichever pool trades
//   npx tsx services/payouts/scripts/launch-rehearsal.ts graduate [buyout]    fill the curve, then migrate to DAMM v2 ("buyout": stop before migrating)
//   npx tsx services/payouts/scripts/launch-rehearsal.ts reset-rate <bps>       the payout wallet schedules a rate itself (to test proposals after the handover)
//   npx tsx services/payouts/scripts/launch-rehearsal.ts execute <proposal>   sign a rate proposal with the multisig stand-in (checks it is executable)
//   npx tsx services/payouts/scripts/launch-rehearsal.ts balances
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { DAMM_V2_MIGRATION_FEE_ADDRESS, DynamicBondingCurveClient, SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, SwapMode as DammSwapMode } from "@meteora-ag/cp-amm-sdk";
import BN from "bn.js";
import { MeteoraMarket, setTaxRate, tokenBalance, transferFeeNow } from "@hashcoin/chain";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const CHAIN_DATA = here("../../../packages/chain/data").replace(/\\/g, "/");
const DIR = `${CHAIN_DATA}/rehearsal`;
mkdirSync(DIR, { recursive: true });
const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
if (/mainnet/.test(RPC)) throw new Error("devnet only");
const conn = new Connection(RPC, "confirmed");
const dbc = new DynamicBondingCurveClient(conn, "confirmed");

const readJson = <T>(path: string, fallback: T): T => { try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; } };
const keyFile = (name: string) => `${DIR}/${name}.json`;
function key(name: string): Keypair {
  const f = keyFile(name);
  if (!existsSync(f)) writeFileSync(f, JSON.stringify([...Keypair.generate().secretKey]));
  return Keypair.fromSecretKey(Uint8Array.from(readJson<number[]>(f, [])));
}
const launcher = key("launcher");
const dev = key("dev");
const payout = key("payout"); // the partner: fee claimer, tax withdraw authority, rate authority after graduation
const multisig = key("multisig-standin"); // a plain key standing in for the Squads vault
const traders = [key("trader-0"), key("trader-1"), key("trader-2")];
// SOL each wallet should hold (the plan for a 0.08 SOL graduation target).
const PLAN: [Keypair, number][] = [[launcher, 0.022], [dev, 0.012], [payout, 0.05], [multisig, 0.002], [traders[0]!, 0.09], [traders[1]!, 0.02], [traders[2]!, 0.02]];

const launchState = () => readJson<{ mint?: string; config?: string; graduationSol?: number }>(`${CHAIN_DATA}/launch-devnet.json`, {});
const tx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
const send = (t: Transaction, signers: Keypair[]) => sendAndConfirmTransaction(conn, t, signers, { commitment: "confirmed" });
const sol = async (k: PublicKey) => (await conn.getBalance(k)) / LAMPORTS_PER_SOL;
const stamp = () => new Date().toISOString().slice(11, 19);
/** Every transaction this script sends, with its time, for the rehearsal record. */
const record = (what: string, sig: string) => { appendFileSync(`${DIR}/transactions.log`, `${new Date().toISOString()} ${what} ${tx(sig)}\n`); console.log(`${stamp()} ${what} ${tx(sig)}`); };

function market() {
  const s = launchState();
  if (!s.mint || !s.config) throw new Error("no launch yet: run packages/chain/scripts/launch-mainnet.ts --cluster devnet first");
  return new MeteoraMarket(conn, { mint: new PublicKey(s.mint), dbcConfig: new PublicKey(s.config) });
}

async function keys() {
  for (const [name, file, k] of [["launcher", "launcher", launcher], ["dev", "dev", dev], ["payout (partner)", "payout", payout], ["multisig stand-in", "multisig-standin", multisig], ...traders.map((t, i) => [`trader-${i}`, `trader-${i}`, t] as const)] as const)
    console.log(`${name.padEnd(18)} ${k.publicKey.toBase58()}  ${keyFile(file)}`);
}

/** Move SOL from old throwaway wallets (keypair files, or JSON objects of them) to the plan. */
async function fund(files: string[]) {
  const funders: Keypair[] = [];
  for (const f of files) {
    const j = readJson<unknown>(f, null);
    const isKey = (x: unknown): x is number[] => Array.isArray(x) && x.length === 64 && typeof x[0] === "number";
    for (const x of isKey(j) ? [j] : j && typeof j === "object" ? Object.values(j) : []) if (isKey(x)) funders.push(Keypair.fromSecretKey(Uint8Array.from(x)));
  }
  for (const [k, want] of PLAN) {
    let short = Math.round((want - (await sol(k.publicKey))) * LAMPORTS_PER_SOL);
    for (const f of funders) {
      if (short <= 0) break;
      const spare = (await conn.getBalance(f.publicKey)) - 5000;
      if (spare <= 0 || f.publicKey.equals(k.publicKey)) continue;
      // A wallet drained to zero is fine (no rent-exempt minimum for a plain system account at 0).
      const lamports = Math.min(short, spare);
      record(`fund ${lamports / 1e9} SOL ${f.publicKey.toBase58().slice(0, 6)} → ${k.publicKey.toBase58().slice(0, 6)}`, await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: f.publicKey, toPubkey: k.publicKey, lamports })), [f]));
      short -= lamports;
    }
    if (short > 0) console.log(`${k.publicKey.toBase58()} still short ${short / 1e9} SOL`);
  }
  await balances();
}

/** The loop's config (mainnet settings, devnet scale) and the environment for every process. */
async function config() {
  const s = launchState();
  if (!s.mint || !s.config) throw new Error("no launch yet");
  const base = readJson<Record<string, unknown>>(here("../config/payouts.mainnet.example.json"), {});
  const cfg = {
    ...base,
    _note: "Launch dress rehearsal (devnet): payouts.mainnet.example.json with the market from the launch, scaled to a 0.08 SOL curve. Written by services/payouts/scripts/launch-rehearsal.ts.",
    network: "devnet",
    rpcPauseMs: 300, collectorMinutes: 1, roundMinutes: 3, holderEveryRounds: 2,
    market: { mint: s.mint, dbcConfig: s.config },
    // Devnet scale: the 0.08 SOL curve stands in for a 50 SOL one. At $25,000 per SOL its market cap in
    // dollars is mainnet-sized, so holder levels ($50/$500/$2,500), the formula and every USD limit
    // see launch-like numbers. Mainnet reads the live price.
    solUsd: { source: "fixed", fixed: 25_000, min: 20, max: 100_000 },
    buy: { slippageBps: 200, maxCostBps: 400, maxUsdPerRound: 250 },
    funding: { reserveSol: 0.03, claimPartnerFeeMinSol: 0.0002 },
    rate: { adjust: true, lookbackDays: 2, minIntervalHours: 0.05 },
    minHolderPayoutUsd: 0.05, maxPayoutUsdPerRound: 2500, minTreasurySol: 0.02, priorityFeeMicroLamports: 20000,
    alerts: { emptyHarvestRounds: 3, floatLowUsd: 25, rpcErrorsPer10Min: 20, repeatMinutes: 30 },
  };
  writeFileSync(`${DIR}/payouts.json`, JSON.stringify(cfg, null, 2));
  const env = {
    HASH_PAYOUTS_CONFIG: `${DIR}/payouts.json`, HASH_DATA_DIR: `${DIR}/loop`, HASH_KEYPAIR: keyFile("payout"), HASH_RPC_URL: RPC,
    HASH_DEV_WALLET: dev.publicKey.toBase58(), HASH_ALERT_WEBHOOK: "http://127.0.0.1:8798/alert",
    HASH_COLLECTOR_DATA: `${DIR}/collector`, HASH_WORKER_REGISTRY: `${DIR}/workers.json`, HASH_PUBLIC_RECORD: `${DIR}/loop/public.json`,
  };
  writeFileSync(`${DIR}/env.sh`, Object.entries(env).map(([k, v]) => `export ${k}=${v}`).join("\n") + "\n");
  console.log(`loop config ${DIR}/payouts.json; environment: source ${DIR}/env.sh`);
}

/** A stand-in for the Discord/Slack webhook: logs every alert it receives. */
function webhook() {
  createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      appendFileSync(`${DIR}/webhook.log`, `${new Date().toISOString()} ${body}\n`);
      console.log(`${stamp()} ${body}`);
      res.writeHead(204).end();
    });
  }).listen(8798, "127.0.0.1", () => console.log("alert webhook on http://127.0.0.1:8798/alert"));
}

/** The desktop app's check-in for the user's test rig, so the API records its pool worker → wallet. */
async function register(api: string) {
  // The test rig's own wallet and rig id (the app's settings), so the worker id matches the one mining on Kryptex.
  const wallet = process.env.MINER_WALLET, rigId = process.env.MINER_RIG;
  if (!wallet || !rigId) throw new Error("set MINER_WALLET and MINER_RIG to the test rig's wallet and rig id (the desktop app's settings)");
  const body = { wallet, rigId, gpus: [{ index: 0, name: process.env.MINER_GPU ?? "NVIDIA GeForce RTX 4070 SUPER" }] };
  const res = await fetch(`${api}/v1/assignments`, { method: "POST", body: JSON.stringify(body) });
  const j = (await res.json()) as { results: { reason: string; assignment: { payload: string } | null }[] };
  for (const r of j.results) {
    const a = r.assignment ? (JSON.parse(r.assignment.payload) as { coin: string; pool: { user: string } }) : null;
    console.log(`${body.wallet} / ${body.rigId}: ${a ? `${a.coin} as ${a.pool.user}` : "no assignment"} (${r.reason})`);
  }
}

async function trade(rounds: number) {
  const m = market();
  const mint = m.ref.mint;
  const damm = new CpAmm(conn);
  for (let r = 0; r < rounds; r++) {
    const s = await m.state();
    if (s.phase === "graduating") { console.log("the curve is full: graduate first"); return; }
    for (const [i, t] of traders.entries()) {
      const buy = BigInt(Math.round((0.002 + 0.001 * i) * LAMPORTS_PER_SOL));
      if ((await conn.getBalance(t.publicKey)) < Number(buy) + 0.004 * LAMPORTS_PER_SOL) { console.log(`trader ${i}: not enough SOL, skipped`); continue; }
      const q = await m.quoteBuy(s, buy, 1000, 500);
      await new Promise((r) => setTimeout(r, 1500)); // the public devnet RPC rate-limits bursts
      record(`${s.phase}: trader ${i} bought ${(Number(q.expectedOut) / 1e6).toFixed(0)} $HASH for ${Number(buy) / 1e9} SOL (pool cost ${q.costBps / 100}%)`, await send(await m.buyTx(q, t.publicKey), [t]));
    }
    // One trader sells a third of its bag (its hold clock takes the hit; the others hold).
    await new Promise((r) => setTimeout(r, 1500));
    const seller = traders[2]!;
    const bag = await tokenBalance(conn, seller.publicKey, mint);
    if (bag === 0n) continue;
    const amountIn = new BN((bag / 3n).toString());
    let t: Transaction;
    if (s.phase === "curve") {
      t = await dbc.pool.swap2({ owner: seller.publicKey, payer: seller.publicKey, pool: s.dbcPool, swapBaseForQuote: true, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn, minimumAmountOut: new BN(0) });
    } else {
      const ps = await damm.fetchPoolState(s.dammPool!);
      t = await damm.swap2({
        payer: seller.publicKey, pool: s.dammPool!, inputTokenMint: mint, outputTokenMint: NATIVE_MINT,
        tokenAMint: ps.tokenAMint, tokenBMint: ps.tokenBMint, tokenAVault: ps.tokenAVault, tokenBVault: ps.tokenBVault,
        tokenAProgram: ps.tokenAMint.equals(NATIVE_MINT) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID, tokenBProgram: ps.tokenBMint.equals(NATIVE_MINT) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID,
        referralTokenAccount: null, poolState: ps, swapMode: DammSwapMode.ExactIn, amountIn, minimumAmountOut: new BN(0),
      });
    }
    record(`${s.phase}: trader 2 sold ${(Number(bag / 3n) / 1e6).toFixed(0)} $HASH`, await send(t, [seller]));
  }
}

async function graduate(buyoutOnly: boolean) {
  const m = market();
  const target = launchState().graduationSol ?? 0.08;
  let s = await m.state();
  if (s.phase === "curve") {
    const buyer = traders[0]!;
    // What's left to raise, plus the 1% curve fee and a margin (a partial fill refunds the rest).
    const raised = Number((await dbc.state.getPool(s.dbcPool))!.poolState.quoteReserve.toString()) / LAMPORTS_PER_SOL;
    const amountIn = new BN(Math.round(Math.min((target - raised) * 1.03 + 0.001, (await sol(buyer.publicKey)) - 0.018) * LAMPORTS_PER_SOL));
    const t = await dbc.pool.swap2({ owner: buyer.publicKey, payer: buyer.publicKey, pool: s.dbcPool, swapBaseForQuote: false, referralTokenAccount: null, swapMode: SwapMode.PartialFill, amountIn, minimumAmountOut: new BN(0) });
    record(`graduation buy: trader 0 fills the curve (up to ${Number(amountIn.toString()) / 1e9} SOL, partial fill)`, await send(t, [buyer]));
    s = await m.state();
    console.log(`phase ${s.phase}, curve ${(100 * s.progress).toFixed(1)}%`);
  }
  if (s.phase === "graduating" && !buyoutOnly) {
    // On mainnet Meteora's migration keeper does this; it is permissionless, so a trader pays here.
    const mg = await dbc.migration.migrateToDammV2({ payer: traders[0]!.publicKey, pool: s.dbcPool, dammConfig: DAMM_V2_MIGRATION_FEE_ADDRESS[6]! });
    record("migration to DAMM v2", await send(mg.transaction, [traders[0]!, mg.firstPositionNftKeypair, mg.secondPositionNftKeypair]));
  }
  s = await m.state();
  console.log(`phase ${s.phase}${s.dammPool ? `, DAMM v2 pool ${s.dammPool.toBase58()}` : ""}, ${s.priceSol} SOL per $HASH`);
}

/**
 * Rehearsal only: the payout wallet (rate authority after graduation, before the handover) schedules
 * `bps` itself, so after the handover the formula disagrees again and the loop writes a proposal.
 */
async function resetRate(bps: number) {
  const fee = await transferFeeNow(conn, market().ref.mint);
  record(`payout wallet schedules the tax at ${bps / 100}% (rehearsal reset)`, await setTaxRate(conn, payout, market().ref.mint, payout, bps, fee.max));
}

/** Sign a proposal file's instruction with the multisig stand-in: proves the proposal executes as written. */
async function execute(file: string) {
  const p = readJson<{ what: string; instruction: { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; dataBase64: string } } | null>(file, null);
  if (!p) throw new Error(`can't read ${file}`);
  const ix = new TransactionInstruction({
    programId: new PublicKey(p.instruction.programId), data: Buffer.from(p.instruction.dataBase64, "base64"),
    keys: p.instruction.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  });
  record(`multisig stand-in executes the proposal: ${p.what}`, await send(new Transaction().add(ix), [multisig]));
}

async function balances() {
  const mintStr = launchState().mint;
  const mint = mintStr ? new PublicKey(mintStr) : null;
  const show = async (name: string, k: PublicKey) => console.log(`${name.padEnd(18)} ${k.toBase58()}  ${(await sol(k)).toFixed(5)} SOL${mint ? `  ${(Number(await tokenBalance(conn, k, mint)) / 1e6).toLocaleString("en-US")} $HASH` : ""}`);
  await show("launcher", launcher.publicKey);
  await show("dev", dev.publicKey);
  await show("payout (partner)", payout.publicKey);
  await show("multisig stand-in", multisig.publicKey);
  for (const [i, t] of traders.entries()) await show(`trader-${i}`, t.publicKey);
  if (process.env.MINER_WALLET) await show("miner wallet", new PublicKey(process.env.MINER_WALLET));
}

const [cmd, ...args] = process.argv.slice(2);
const run: Record<string, () => Promise<void> | void> = {
  keys, fund: () => fund(args), config, webhook, register: () => register(args[0] ?? "http://127.0.0.1:8788"),
  trade: () => trade(Number(args[0] ?? 1)), graduate: () => graduate(args[0] === "buyout"), "reset-rate": () => resetRate(Number(args[0])), execute: () => execute(args[0] ?? ""), balances,
};
if (!run[cmd ?? ""]) { console.log(`commands: ${Object.keys(run).join(" | ")}`); process.exit(1); }
await run[cmd!]!();
