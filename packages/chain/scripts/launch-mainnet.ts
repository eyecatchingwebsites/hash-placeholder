// Launches $HASH on Meteora Dynamic Bonding Curve 0.2.2 with the decided settings (src/launch.ts):
//   1. the config (create_config2): 21M Token-2022 supply, 5% tax collected by the partner, the rate
//      authority handed to the partner at graduation, 25% of supply to the DAMM v2 pool, curve fee 20% → 1%
//      over 5 minutes, 0.25% pool fee after graduation
//   2. the pool and our 1% dev buy in one transaction (the dev buy pays the 1% floor, not the sniper fee)
//   3. checks: mint and freeze authority none, 5% tax live, dev bag in the dev wallet
// The graduation target is the one number left; the user picks it 24–48 h before launch.
//
//   npx tsx packages/chain/scripts/launch-mainnet.ts --cluster mainnet --graduation-sol 50 \
//     --launcher <launcher.json> --dev <dev.json> --partner <multisig or payout address> \
//     --name Hashcoin --symbol HASH --uri <metadata json url> --dry-run
//   ...then the same with --confirm-mainnet instead of --dry-run.
//
//   --cluster devnet|mainnet   --rpc <url> (or SOLANA_RPC; use a paid RPC on mainnet)
//   --launcher <keypair file>  pays rent and creates the pool (signs)
//   --dev <keypair file>       the public dev wallet that buys the 1% bag (signs)
//   --partner <pubkey>         fee claimer = tax withdraw authority = rate authority after graduation
//                              (devnet: defaults to the launcher)
//   --dry-run                  build and simulate, send nothing
//   --confirm-mainnet          required to send on mainnet
//   --rehearse                 devnet only: after launch, trade, graduate, migrate and check the
//                              authorities again (use a tiny --graduation-sol, e.g. 0.3)
//   --priority <microLamports> compute-unit price (default 100000 on mainnet, 0 on devnet)
// State (config, mint, transactions) goes to packages/chain/data/launch-<cluster>.json (gitignored).
// Keypair files stay wherever you keep them; nothing secret is written by this script.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { getMint, getTransferFeeConfig, NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { DAMM_V2_MIGRATION_FEE_ADDRESS, deriveDbcPoolAddress, DynamicBondingCurveClient, SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { LAUNCH, launchCurve, launchSummary, TRANSFER_FEE_PARAMETERS } from "../src/launch.js";
import { setTaxRate, tokenBalance, transferFeeNow } from "../src/token.js";

// ---------- Arguments ----------
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const fail = (msg: string): never => { console.error(`\n${msg}\n`); process.exit(1); };

const cluster = opt("cluster") ?? fail("--cluster devnet|mainnet is required");
if (cluster !== "devnet" && cluster !== "mainnet") fail("--cluster must be devnet or mainnet");
const mainnet = cluster === "mainnet";
const graduationSol = Number(opt("graduation-sol") ?? fail("--graduation-sol is required (the graduation target in SOL)"));
if (!(graduationSol > 0)) fail("--graduation-sol must be a positive number");
if (mainnet && (graduationSol < LAUNCH.mainnetGraduationSol.min || graduationSol > LAUNCH.mainnetGraduationSol.max))
  fail(`on mainnet --graduation-sol must be ${LAUNCH.mainnetGraduationSol.min}–${LAUNCH.mainnetGraduationSol.max}`);
const dryRun = flag("dry-run");
if (mainnet && !dryRun && !flag("confirm-mainnet")) fail("refusing to send on mainnet without --confirm-mainnet (try --dry-run first)");
const rehearse = flag("rehearse");
if (rehearse && mainnet) fail("--rehearse is for devnet only");
const name = opt("name") ?? (mainnet ? fail("--name is required on mainnet") : "Hashcoin Launch Test");
const symbol = opt("symbol") ?? (mainnet ? fail("--symbol is required on mainnet") : "HASHT");
const uri = opt("uri") ?? (mainnet ? fail("--uri (the token metadata JSON URL) is required on mainnet") : "https://example.com/hash.json");
const priority = Number(opt("priority") ?? (mainnet ? 100_000 : 0));

const readKeypair = (path: string | undefined, what: string) => {
  if (!path) fail(`--${what} <keypair file> is required`);
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path!, "utf8")) as number[])); }
  catch { return fail(`could not read the ${what} keypair from ${path}`); }
};
const launcher = readKeypair(opt("launcher"), "launcher");
const dev = readKeypair(opt("dev"), "dev");
const partnerArg = opt("partner");
const partner = partnerArg ? new PublicKey(partnerArg) : mainnet ? fail("--partner <pubkey> is required on mainnet") : launcher.publicKey;
if (rehearse && !partner.equals(launcher.publicKey)) fail("--rehearse needs the partner to be the launcher (omit --partner on devnet)");
if (dev.publicKey.equals(launcher.publicKey)) fail("use a separate dev wallet: the dev bag must sit in its own public wallet");

const rpc = opt("rpc") ?? process.env.SOLANA_RPC ?? (mainnet ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com");
if (mainnet && rpc.includes("api.mainnet-beta.solana.com")) console.warn("warning: the public mainnet RPC is rate-limited; pass --rpc or SOLANA_RPC (e.g. Helius) for the real launch");
const conn = new Connection(rpc, "confirmed");
const client = new DynamicBondingCurveClient(conn, "confirmed");

// ---------- State ----------
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const stateFile = here(`../data/launch-${cluster}.json`);
type State = { graduationSol?: number; config?: string; configTx?: string; mint?: string; pool?: string; poolTx?: string; [k: string]: unknown };
const state: State = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, "utf8")) as State) : {};
const save = () => { if (!dryRun) writeFileSync(stateFile, JSON.stringify(state, null, 2)); };
const explorer = (sig: string) => `https://solscan.io/tx/${sig}${mainnet ? "" : "?cluster=devnet"}`;
const sol = async (k: PublicKey) => (await conn.getBalance(k)) / LAMPORTS_PER_SOL;

// Never launch twice: with a saved launch, only --rehearse (resume the devnet rehearsal) or --fresh (devnet) go on.
if (state.mint) {
  if (mainnet) fail(`already launched: mint ${state.mint} (state in ${stateFile}). Not launching twice.`);
  if (!rehearse && !flag("fresh")) fail(`devnet state already has a launch (mint ${state.mint}); pass --rehearse to continue its rehearsal or --fresh to start a new one`);
}
if (flag("fresh") && !mainnet) for (const k of Object.keys(state)) delete state[k];
if (state.config && state.graduationSol !== graduationSol) fail(`the saved config uses a ${state.graduationSol} SOL target; start --fresh (devnet) or remove ${stateFile}`);

// Priority fee, unless the SDK already set one.
function withPriority(t: Transaction) {
  if (priority > 0 && !t.instructions.some((i) => i.programId.equals(ComputeBudgetProgram.programId)))
    t.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }));
  return t;
}
// Who pays. A dry run with an unfunded launcher simulates with a stand-in: a wallet that recently used the
// Meteora program (nothing is signed or sent; it only lets the program check our config).
let payer: PublicKey;
async function standInPayer(): Promise<PublicKey> {
  const sigs = await conn.getSignaturesForAddress(new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"), { limit: 25 });
  for (const x of sigs) {
    try {
      // Plain JSON-RPC: web3.js 1.x rejects transaction versions above 0.
      const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [x.signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }] }) });
      const key = ((await res.json()) as { result?: { transaction?: { message?: { accountKeys?: string[] } } } }).result?.transaction?.message?.accountKeys?.[0];
      if (key && (await conn.getBalance(new PublicKey(key))) > 0.5 * LAMPORTS_PER_SOL) return new PublicKey(key);
    } catch { /* try the next one */ }
  }
  return fail("no stand-in payer found for the dry run");
}
async function sendOrSimulate(label: string, t: Transaction, signers: Keypair[]) {
  withPriority(t);
  t.feePayer = payer;
  t.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  if (dryRun) {
    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: t.recentBlockhash, instructions: t.instructions }).compileToV0Message();
    const r = await conn.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true });
    const err = r.value.err ? `FAILED ${JSON.stringify(r.value.err)}\n    ${(r.value.logs ?? []).filter((l) => /rror|failed/.test(l)).join("\n    ")}` : `ok (${r.value.unitsConsumed} compute units)`;
    console.log(`   [dry run] ${label}: ${err}`);
    return null;
  }
  const sig = await sendAndConfirmTransaction(conn, t, signers, { commitment: "confirmed" });
  console.log(`   ${label}: ${explorer(sig)}`);
  return sig;
}

async function main() {
  if (rehearse && state.mint) {
    console.log(`Resuming the devnet rehearsal for ${state.mint}`);
    return rehearsal(new PublicKey(state.mint), new PublicKey(state.pool!));
  }
  // ---------- 0. What this launch means ----------
  const curve = launchCurve(graduationSol);
  const s = launchSummary(graduationSol, curve);
  console.log(`Launching $HASH on ${cluster}${dryRun ? " (DRY RUN: nothing is sent)" : ""}`);
  console.log(`  graduation target ${graduationSol} SOL, ${LAUNCH.percentToPool}% of supply to the pool`);
  console.log(`  start market cap ${s.startMarketCapSol.toFixed(1)} SOL, at graduation ${s.graduationMarketCapSol.toFixed(1)} SOL (price x${s.priceRiseOverCurve.toFixed(1)} over the curve)`);
  console.log(`  tax ${LAUNCH.taxBps / 100}% (fixed on the curve); curve fee ${LAUNCH.curveFee.startBps / 100}% → ${LAUNCH.curveFee.endBps / 100}% over ${LAUNCH.curveFee.seconds / 60} min (we keep ${s.curveFeeToUsPercent}% after Meteora's cut); pool fee after graduation ${LAUNCH.poolFeeBps / 100}%`);
  console.log(`  dev buy: ${s.devBuy.tokensKept.toLocaleString("en-US")} $HASH kept (${s.devBuy.tokensBought.toFixed(0)} bought before the tax) for ~${s.devBuy.sol.toFixed(4)} SOL`);
  console.log(`  launcher ${launcher.publicKey.toBase58()} (${await sol(launcher.publicKey)} SOL)`);
  console.log(`  dev      ${dev.publicKey.toBase58()} (${await sol(dev.publicKey)} SOL)`);
  console.log(`  partner  ${partner.toBase58()} (fee claimer, tax withdraw authority, rate authority after graduation)`);
  const devNeeds = s.devBuy.sol * 1.03 + 0.01;
  const short: string[] = [];
  if ((await sol(dev.publicKey)) < devNeeds) short.push(`the dev wallet needs about ${devNeeds.toFixed(3)} SOL for the bag, fees and its token account`);
  if ((await sol(launcher.publicKey)) < 0.08) short.push("the launcher needs about 0.08 SOL for rent and fees");
  if (short.length && !dryRun) fail(short.join("\n"));
  for (const m of short) console.log(`  NOTE: ${m}`);
  payer = launcher.publicKey;
  if (dryRun && (await sol(launcher.publicKey)) < 0.08) {
    payer = await standInPayer();
    console.log(`  dry run: simulating with stand-in payer ${payer.toBase58()} (nothing is signed or sent)`);
  }

  // ---------- 1. Config ----------
  let config: PublicKey;
  if (state.config) {
    config = new PublicKey(state.config);
    console.log(`1. config ${config.toBase58()} (already created)`);
  } else {
    const kp = Keypair.generate();
    config = kp.publicKey;
    const t = await client.partner.createConfig2({
      payer, config, feeClaimer: partner, leftoverReceiver: partner, quoteMint: NATIVE_MINT, ...curve,
      transferFeeParameters: TRANSFER_FEE_PARAMETERS,
    });
    console.log(`1. config ${config.toBase58()}`);
    const sig = await sendOrSimulate("create config", t, [launcher, kp]);
    if (sig) { Object.assign(state, { graduationSol, config: config.toBase58(), configTx: explorer(sig) }); save(); }
  }
  if (dryRun && !state.config) {
    console.log("2. pool + dev buy: can't be simulated until the config exists on chain; the devnet rehearsal covers it.");
    return;
  }

  // ---------- 2. Pool and dev buy, one transaction ----------
  const mintKp = Keypair.generate();
  const t = await client.creator.createPoolWithFirstBuy({
    createPoolParam: { baseMint: mintKp.publicKey, config, name, symbol, uri, payer: launcher.publicKey, poolCreator: launcher.publicKey },
    firstBuyParam: {
      buyer: dev.publicKey, buyAmount: new BN(Math.ceil(s.devBuy.sol * 1.01 * LAMPORTS_PER_SOL)),
      minimumAmountOut: new BN(Math.floor(LAUNCH.devBuyTokens * 0.97)).mul(new BN(10).pow(new BN(LAUNCH.decimals))), referralTokenAccount: null,
    },
  });
  console.log(`2. launch ${mintKp.publicKey.toBase58()} with the dev buy`);
  const sig = await sendOrSimulate("create pool + dev buy", t, [launcher, mintKp, dev]);
  if (!sig) return;
  const mint = mintKp.publicKey, pool = deriveDbcPoolAddress(NATIVE_MINT, mint, config);
  Object.assign(state, { mint: mint.toBase58(), pool: pool.toBase58(), poolTx: explorer(sig) });
  save();

  // ---------- 3. Checks ----------
  const info = await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const fee = getTransferFeeConfig(info)!;
  const checks = {
    supply: Number(info.supply) / 10 ** LAUNCH.decimals,
    mintAuthority: info.mintAuthority?.toBase58() ?? "none",
    freezeAuthority: info.freezeAuthority?.toBase58() ?? "none",
    taxBps: (await transferFeeNow(conn, mint)).bps,
    taxWithdrawAuthority: fee.withdrawWithheldAuthority?.toBase58() ?? "none",
    devBag: Number(await tokenBalance(conn, dev.publicKey, mint)) / 10 ** LAUNCH.decimals,
  };
  state.checks = checks;
  save();
  const ok = checks.supply === LAUNCH.supply && checks.mintAuthority === "none" && checks.freezeAuthority === "none" && checks.taxBps === LAUNCH.taxBps
    && checks.taxWithdrawAuthority === partner.toBase58() && checks.devBag >= LAUNCH.devBuyTokens * 0.97;
  console.log(`3. checks ${ok ? "PASSED" : "FAILED"}: ${JSON.stringify(checks)}`);
  console.log(`\n   CONTRACT ADDRESS: ${mint.toBase58()}\n   pool: ${pool.toBase58()}`);
  if (!ok) process.exitCode = 1;

  if (rehearse) await rehearsal(mint, pool);
}

// ---------- Devnet only: trade, graduate, migrate, check the authorities after ----------
async function rehearsal(mint: PublicKey, pool: PublicKey) {
  console.log("\nRehearsal (devnet): trades, graduation, migration (each step is skipped once done)");
  const step = async (key: string, run: () => Promise<string>) => {
    if (!state[key]) { state[key] = await run(); save(); }
    console.log(`   ${key}: ${state[key] as string}`);
  };
  const refusal = (e: unknown) => `refused: ${((e as { logs?: string[] }).logs ?? []).find((l) => l.includes("Error")) ?? (e as Error).message.split("\n")[0]}`;
  await step("rehearsalBuy", async () => {
    const t = await client.pool.swap({ owner: launcher.publicKey, pool, amountIn: new BN(0.02 * LAMPORTS_PER_SOL), minimumAmountOut: new BN(0), swapBaseForQuote: false, referralTokenAccount: null, payer: launcher.publicKey });
    return explorer(await sendAndConfirmTransaction(conn, t, [launcher]));
  });
  await step("rehearsalSell", async () => {
    const held = await tokenBalance(conn, launcher.publicKey, mint);
    const t = await client.pool.swap({ owner: launcher.publicKey, pool, amountIn: new BN((held / 2n).toString()), minimumAmountOut: new BN(0), swapBaseForQuote: true, referralTokenAccount: null, payer: launcher.publicKey });
    return explorer(await sendAndConfirmTransaction(conn, t, [launcher]));
  });
  await step("rateChangeOnCurve", async () => {
    try { return `ACCEPTED (unexpected) ${explorer(await setTaxRate(conn, launcher, mint, launcher, 275, BigInt("18446744073709551615")))}`; }
    catch (e) { return `${refusal(e)} (expected: the rate is fixed on the curve)`; }
  });
  // Buy until the target is reached; early on, the 20% sniper fee eats part of each buy.
  const threshold = Math.round(graduationSol * LAMPORTS_PER_SOL);
  for (let i = 0; i < 4; i++) {
    const p = (await client.state.getPool(pool))!.poolState;
    const raised = Number(p.quoteReserve.toString());
    if (raised >= threshold || p.isMigrated) break;
    const amountIn = new BN(Math.round((threshold - raised) * 1.35 + 0.01 * LAMPORTS_PER_SOL));
    const t = await client.pool.swap2({ owner: launcher.publicKey, pool, swapBaseForQuote: false, referralTokenAccount: null, payer: launcher.publicKey, swapMode: SwapMode.PartialFill, amountIn, minimumAmountOut: new BN(0) });
    console.log(`   graduation buy: ${explorer(await sendAndConfirmTransaction(conn, t, [launcher]))}`);
  }
  const p = (await client.state.getPool(pool))!.poolState;
  console.log(`   raised ${Number(p.quoteReserve.toString()) / LAMPORTS_PER_SOL} of ${graduationSol} SOL`);
  if (!p.isMigrated) await step("rehearsalMigrate", async () => {
    const m = await client.migration.migrateToDammV2({ payer: launcher.publicKey, pool, dammConfig: DAMM_V2_MIGRATION_FEE_ADDRESS[6]! });
    return explorer(await sendAndConfirmTransaction(conn, m.transaction, [launcher, m.firstPositionNftKeypair, m.secondPositionNftKeypair]));
  });
  const fee = getTransferFeeConfig(await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID))!;
  state.afterGraduation = { rateAuthority: fee.transferFeeConfigAuthority?.toBase58() ?? "none", withdrawAuthority: fee.withdrawWithheldAuthority?.toBase58() ?? "none", partner: partner.toBase58() };
  save();
  console.log(`   afterGraduation: ${JSON.stringify(state.afterGraduation)}`);
  await step("rateChangeAfter", async () => {
    try { return explorer(await setTaxRate(conn, launcher, mint, launcher, 275, BigInt("18446744073709551615"))); } catch (e) { return refusal(e); }
  });
  await step("curveFeeClaim", async () => {
    try {
      const t = await client.partner.claimPartnerTradingFee({ pool, feeClaimer: launcher.publicKey, payer: launcher.publicKey, maxBaseAmount: new BN(0), maxQuoteAmount: new BN("18446744073709551615") });
      return explorer(await sendAndConfirmTransaction(conn, t, [launcher]));
    } catch (e) { return refusal(e); }
  });
  const ok = state.afterGraduation && (state.afterGraduation as { rateAuthority: string }).rateAuthority === partner.toBase58()
    && String(state.rateChangeAfter).startsWith("https") && String(state.curveFeeClaim).startsWith("https") && String(state.rateChangeOnCurve).startsWith("refused");
  console.log(`\nRehearsal ${ok ? "PASSED" : "FAILED"}`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
