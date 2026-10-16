// Devnet rehearsal of the mainnet payout loop on a real Meteora market: a token launched like
// packages/chain/scripts/meteora-devnet.ts (DBC 0.2.2, Token-2022, 5% tax, partner = our payout
// wallet, rate authority ours after graduation), throwaway traders trading on it, then graduation
// to DAMM v2. Everything lives in services/payouts/data/devnet-meteora/ (gitignored). Devnet only.
//
//   npx tsx services/payouts/scripts/devnet-meteora.ts setup      throwaway keys, devnet SOL (faucet, or FUNDER_KEYPAIR)
//   npx tsx services/payouts/scripts/devnet-meteora.ts launch     config + pool; writes the loop's config file
//   npx tsx services/payouts/scripts/devnet-meteora.ts trade [n]  n rounds of trader buys and sells on the current pool
//   npx tsx services/payouts/scripts/devnet-meteora.ts graduate [buyout]   buy out the curve, migrate to DAMM v2 ("buyout": stop before migrating)
//   npx tsx services/payouts/scripts/devnet-meteora.ts balances
//
// Then run the loop against it:
//   HASH_PAYOUTS_CONFIG=services/payouts/data/devnet-meteora/payouts.json HASH_DATA_DIR=services/payouts/data/devnet-meteora/loop \
//   HASH_KEYPAIR=services/payouts/data/devnet-meteora/payout.json HASH_DEV_WALLET=<dev> npx tsx services/payouts/src/main.ts --once
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ActivationType, BaseFeeMode, buildCurve, CollectFeeMode, DAMM_V2_MIGRATION_FEE_ADDRESS, DynamicBondingCurveClient, MigratedCollectFeeMode,
  MigratedTransferFeeAuthorityOption, MigrationFeeOption, MigrationOption, SwapMode, TokenAuthorityOption, TokenDecimal, TokenType, TransferFeeWithheldAuthority,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, SwapMode as DammSwapMode } from "@meteora-ag/cp-amm-sdk";
import BN from "bn.js";
import { MeteoraMarket, tokenBalance } from "@hashcoin/chain";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const DIR = here("../data/devnet-meteora");
mkdirSync(DIR, { recursive: true });
const conn = new Connection(process.env.SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
const dbc = new DynamicBondingCurveClient(conn, "confirmed");
const TARGET_SOL = 0.12; // graduation target for the rehearsal (mainnet: far higher)
const SUPPLY = 21_000_000;

const readJson = <T>(path: string, fallback: T): T => { try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; } };
const keyFile = (name: string) => `${DIR}/${name}.json`;
function key(name: string): Keypair {
  const f = keyFile(name);
  if (!existsSync(f)) writeFileSync(f, JSON.stringify([...Keypair.generate().secretKey]));
  return Keypair.fromSecretKey(Uint8Array.from(readJson<number[]>(f, [])));
}
const payout = key("payout"); // partner / fee claimer / tax withdraw authority / payout wallet
const dev = key("dev");
const standInMultisig = key("multisig-standin"); // a plain key standing in for the Squads vault
const traders = [key("trader-0"), key("trader-1"), key("trader-2")];
const miners = [key("miner-0"), key("miner-1")];
const stateFile = `${DIR}/state.json`;
const state = readJson<{ config?: string; mint?: string; pool?: string; txs: Record<string, string> }>(stateFile, { txs: {} });
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
const tx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
const send = (t: Transaction, signers: Keypair[]) => sendAndConfirmTransaction(conn, t, signers, { commitment: "confirmed" });
const sol = async (k: PublicKey) => (await conn.getBalance(k)) / LAMPORTS_PER_SOL;

async function fund(to: PublicKey, want: number, funder: Keypair | null) {
  const have = await sol(to);
  if (have >= want) return;
  try {
    const sig = await conn.requestAirdrop(to, Math.round((want - have) * LAMPORTS_PER_SOL));
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`  airdropped ${want - have} SOL to ${to.toBase58()}`);
    return;
  } catch (e) {
    if (!funder) throw new Error(`faucet refused (${(e as Error).message.split("\n")[0]}); set FUNDER_KEYPAIR to a devnet keypair file with SOL`);
  }
  await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: funder!.publicKey, toPubkey: to, lamports: Math.round((want - have) * LAMPORTS_PER_SOL) })), [funder!]);
  console.log(`  sent ${(want - have).toFixed(4)} SOL to ${to.toBase58()} from ${funder!.publicKey.toBase58()}`);
}

async function setup() {
  const funder = process.env.FUNDER_KEYPAIR ? Keypair.fromSecretKey(Uint8Array.from(readJson<number[]>(process.env.FUNDER_KEYPAIR, []))) : null;
  if (funder) console.log(`funder ${funder.publicKey.toBase58()}: ${await sol(funder.publicKey)} SOL`);
  await fund(payout.publicKey, 0.2, funder);
  for (const t of traders) await fund(t.publicKey, 0.03, funder);
  await fund(traders[0]!.publicKey, TARGET_SOL + 0.08, funder); // the graduation buyer
  await balances();
}

async function launch() {
  if (!state.config) {
    const curve = buildCurve({
      token: { tokenType: TokenType.Token2022, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: TokenDecimal.NINE, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: SUPPLY, leftover: 0 },
      fee: {
        baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 } },
        dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 0, poolCreationFee: 0, enableFirstSwapWithMinFee: false,
      },
      migration: {
        migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.Customizable,
        migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
        migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.Compounding, dynamicFee: 0, poolFeeBps: 100, compoundingFeeBps: 0 },
      },
      liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 100, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 0, creatorLiquidityPercentage: 0 },
      lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
      activationType: ActivationType.Timestamp, percentageSupplyOnMigration: 20, migrationQuoteThreshold: TARGET_SOL,
    });
    const config = Keypair.generate();
    const t = await dbc.partner.createConfig2({
      payer: payout.publicKey, config: config.publicKey, feeClaimer: payout.publicKey, leftoverReceiver: payout.publicKey, quoteMint: NATIVE_MINT, ...curve,
      transferFeeParameters: { transferFeeBasisPoints: 500, withheldAuthority: TransferFeeWithheldAuthority.Partner, migratedTransferFeeAuthorityOption: MigratedTransferFeeAuthorityOption.Partner },
    });
    state.txs.config = tx(await send(t, [payout, config]));
    state.config = config.publicKey.toBase58();
    save();
    console.log(`config ${state.config} ${state.txs.config}`);
  }
  if (!state.mint) {
    const mint = Keypair.generate();
    const t = await dbc.creator.createPool({ baseMint: mint.publicKey, config: new PublicKey(state.config), name: "Hashcoin Payout Rehearsal", symbol: "HASHP", uri: "https://example.com/hash.json", payer: payout.publicKey, poolCreator: payout.publicKey });
    state.txs.pool = tx(await send(t, [payout, mint]));
    state.mint = mint.publicKey.toBase58();
    save();
    console.log(`launched ${state.mint} ${state.txs.pool}`);
  }
  // The loop's config for this market (devnet stand-ins: two simulated miners).
  const base = readJson<Record<string, unknown>>(here("../config/payouts.json"), {});
  const cfg = {
    ...base,
    _note: "Generated by services/payouts/scripts/devnet-meteora.ts for the devnet rehearsal on a real Meteora market.",
    network: "devnet", rpc: "https://api.devnet.solana.com", rpcPauseMs: 400, collectorMinutes: 1, roundMinutes: 3,
    market: { mint: state.mint, dbcConfig: state.config },
    priceUsd: undefined,
    solUsd: { source: "live", min: 5, max: 5000 },
    buy: { slippageBps: 300, maxCostBps: 400, maxUsdPerRound: 5 },
    funding: { reserveSol: 0.02, claimPartnerFeeMinSol: 0.0001 },
    settlement: { mode: "sales", minAgeHours: 0.05 },
    maxPayoutUsdPerRound: 50,
    minTreasurySol: 0.01,
    priorityFeeMicroLamports: 1000,
    alerts: { emptyHarvestRounds: 2, floatLowUsd: 1, rpcErrorsPer10Min: 5, repeatMinutes: 30 },
    simulate: { miners: miners.map((m, i) => ({ wallet: m.publicKey.toBase58(), usdPerHour: i === 0 ? 0.6 : 0.2 })), prlPriceUsd: 1.87 },
  };
  writeFileSync(`${DIR}/payouts.json`, JSON.stringify(cfg, null, 2));
  console.log(`loop config: ${DIR}/payouts.json\ndev wallet: ${dev.publicKey.toBase58()}\nstand-in multisig: ${standInMultisig.publicKey.toBase58()}`);
}

async function trade(rounds: number) {
  const market = new MeteoraMarket(conn, { mint: new PublicKey(state.mint!), dbcConfig: new PublicKey(state.config!) });
  const damm = new CpAmm(conn);
  for (let r = 0; r < rounds; r++) {
    const s = await market.state();
    if (s.phase === "graduating" && arg !== "buyout") { console.log("curve is full: graduate first"); return; }
    for (const [i, t] of traders.entries()) {
      const buy = BigInt(Math.round((0.002 + 0.002 * i) * LAMPORTS_PER_SOL));
      if ((await conn.getBalance(t.publicKey)) < Number(buy) + 0.006 * LAMPORTS_PER_SOL) { console.log(`  trader ${i}: not enough SOL, skipped`); continue; }
      const q = await market.quoteBuy(s, buy, 500, 500);
      const sig = await send(await market.buyTx(q, t.publicKey), [t]);
      console.log(`  ${s.phase}: trader ${i} bought ${Number(q.expectedOut) / 1e6} for ${Number(buy) / 1e9} SOL ${tx(sig)}`);
    }
    // The last funded trader sells a third of its bag (its hold clock takes the hit; the others hold).
    const sols = await Promise.all(traders.map((t) => conn.getBalance(t.publicKey)));
    const sellerIndex = sols.reduce((best, bal, i) => (bal > 0.006 * LAMPORTS_PER_SOL ? i : best), 0);
    const seller = traders[sellerIndex]!;
    const bag = await tokenBalance(conn, seller.publicKey, new PublicKey(state.mint!));
    if (bag > 0n) {
      const amountIn = new BN((bag / 3n).toString());
      let t: Transaction;
      if (s.phase === "curve") {
        t = await dbc.pool.swap2({ owner: seller.publicKey, payer: seller.publicKey, pool: s.dbcPool, swapBaseForQuote: true, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn, minimumAmountOut: new BN(0) });
      } else {
        const ps = await damm.fetchPoolState(s.dammPool!);
        t = await damm.swap2({
          payer: seller.publicKey, pool: s.dammPool!, inputTokenMint: new PublicKey(state.mint!), outputTokenMint: NATIVE_MINT,
          tokenAMint: ps.tokenAMint, tokenBMint: ps.tokenBMint, tokenAVault: ps.tokenAVault, tokenBVault: ps.tokenBVault,
          tokenAProgram: ps.tokenAMint.equals(NATIVE_MINT) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID, tokenBProgram: ps.tokenBMint.equals(NATIVE_MINT) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID,
          referralTokenAccount: null, poolState: ps, swapMode: DammSwapMode.ExactIn, amountIn, minimumAmountOut: new BN(0),
        });
      }
      console.log(`  ${s.phase}: trader ${sellerIndex} sold ${Number(bag / 3n) / 1e6} ${tx(await send(t, [seller]))}`);
    }
  }
}

async function graduate() {
  const market = new MeteoraMarket(conn, { mint: new PublicKey(state.mint!), dbcConfig: new PublicKey(state.config!) });
  let s = await market.state();
  if (s.phase === "curve") {
    const buyer = traders[0]!;
    const t = await dbc.pool.swap2({ owner: buyer.publicKey, payer: buyer.publicKey, pool: s.dbcPool, swapBaseForQuote: false, referralTokenAccount: null, swapMode: SwapMode.PartialFill, amountIn: new BN(Math.round((TARGET_SOL + 0.015) * LAMPORTS_PER_SOL)), minimumAmountOut: new BN(0) });
    state.txs.gradBuy = tx(await send(t, [buyer]));
    save();
    console.log(`bought out the curve ${state.txs.gradBuy}`);
    s = await market.state();
  }
  if (s.phase === "graduating" && arg !== "buyout") {
    const m = await dbc.migration.migrateToDammV2({ payer: payout.publicKey, pool: s.dbcPool, dammConfig: DAMM_V2_MIGRATION_FEE_ADDRESS[6]! });
    state.txs.migrate = tx(await send(m.transaction, [payout, m.firstPositionNftKeypair, m.secondPositionNftKeypair]));
    save();
    console.log(`migrated to DAMM v2 ${state.txs.migrate}`);
  }
  s = await market.state();
  console.log(`phase ${s.phase}, DAMM v2 pool ${s.dammPool?.toBase58()}, ${s.priceSol} SOL per token`);
}

async function balances() {
  const mint = state.mint ? new PublicKey(state.mint) : null;
  const show = async (name: string, k: PublicKey) => console.log(`${name.padEnd(18)} ${k.toBase58()}  ${(await sol(k)).toFixed(5)} SOL${mint ? `  ${(Number(await tokenBalance(conn, k, mint)) / 1e6).toLocaleString()} tokens` : ""}`);
  await show("payout", payout.publicKey);
  await show("dev", dev.publicKey);
  for (const [i, t] of traders.entries()) await show(`trader-${i}`, t.publicKey);
  for (const [i, m] of miners.entries()) await show(`miner-${i} (sim)`, m.publicKey);
  await show("multisig stand-in", standInMultisig.publicKey);
}

const [cmd, arg] = process.argv.slice(2);
const run: Record<string, () => Promise<void>> = { setup, launch, trade: () => trade(Number(arg ?? 1)), graduate, balances };
if (!run[cmd ?? ""]) { console.log("commands: setup | launch | trade [n] | graduate | balances"); process.exit(1); }
await run[cmd!]!();
