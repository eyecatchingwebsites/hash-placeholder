// The launch route: Meteora Dynamic Bonding Curve 0.2.2 with a Token-2022 tax (live on mainnet since
// Oct 16, 2026; devnet runs the same program). Uses Meteora's released SDK 2.0.0 from npm.
//   1. config (create_config2): 21M Token-2022 supply, 5% tax, tax collected by us (Partner),
//      and the rate authority handed to us at graduation (MigratedTransferFeeAuthorityOption.Partner)
//   2. the pool (the token launches), and who holds which authority while on the curve
//   3. a buyer buys and sells; we collect the tax; can we change the rate on the curve?
//   4. buy past the graduation target, migrate to DAMM v2, and check the authorities again
//   5. can we change the rate after graduation? claim our trading fees (SOL)
// Each step is skipped once done; state in packages/chain/data/meteora-devnet.json.
//
//   npx tsx packages/chain/scripts/meteora-devnet.ts
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction } from "@solana/web3.js";
import { getMint, getTransferFeeConfig, NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  ActivationType, BaseFeeMode, buildCurve, CollectFeeMode, DAMM_V2_MIGRATION_FEE_ADDRESS, deriveDbcPoolAddress, DynamicBondingCurveClient,
  MigratedCollectFeeMode, MigratedTransferFeeAuthorityOption, MigrationFeeOption, MigrationOption, SwapMode, TokenAuthorityOption, TokenDecimal, TokenType,
  TransferFeeWithheldAuthority,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { ata, harvestFees, setTaxRate, tokenBalance, transferFeeNow } from "../src/token.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const DATA = here("../data");
const conn = new Connection(process.env.SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
const client = new DynamicBondingCurveClient(conn, "confirmed");
const SUPPLY = 21_000_000;
const TARGET_SOL = 0.3; // graduation target for the test; mainnet will be far higher

const readJson = <T>(path: string, fallback: T): T => { try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; } };
// Throwaway devnet wallets from the LaunchLab test: `admin` acts as partner and creator (us), `buyer` as a trader.
const keys = readJson<{ admin: number[]; buyer: number[] }>(`${DATA}/launchlab-keys.json`, { admin: [], buyer: [] });
const us = Keypair.fromSecretKey(Uint8Array.from(keys.admin));
const buyer = Keypair.fromSecretKey(Uint8Array.from(keys.buyer));
const stateFile = `${DATA}/meteora-devnet.json`;
const state = readJson<Record<string, unknown>>(stateFile, {});
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
const tx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
const send = (t: Transaction, signers: Keypair[]) => sendAndConfirmTransaction(conn, t, signers, { commitment: "confirmed" });
const sol = async (k: PublicKey) => (await conn.getBalance(k)) / LAMPORTS_PER_SOL;
const short = (k: PublicKey) => (k.equals(us.publicKey) ? "OURS" : k.toBase58());

async function authorities(mint: PublicKey) {
  const info = await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const fee = getTransferFeeConfig(info)!;
  return { config: short(fee.transferFeeConfigAuthority), withdraw: short(fee.withdrawWithheldAuthority), mint: info.mintAuthority?.toBase58() ?? "none", freeze: info.freezeAuthority?.toBase58() ?? "none", bps: (await transferFeeNow(conn, mint)).bps };
}

async function tryRate(mint: PublicKey, bps: number): Promise<string> {
  try { return tx(await setTaxRate(conn, us, mint, us, bps, BigInt("18446744073709551615"))); }
  catch (e) { return `refused: ${((e as { logs?: string[] }).logs ?? []).find((l) => l.includes("Error")) ?? (e as Error).message.split("\n")[0]}`; }
}

async function swap(owner: Keypair, pool: PublicKey, sell: boolean, amountIn: BN) {
  const t = await client.pool.swap({ owner: owner.publicKey, pool, amountIn, minimumAmountOut: new BN(0), swapBaseForQuote: sell, referralTokenAccount: null, payer: owner.publicKey });
  return tx(await send(t, [owner]));
}

async function main() {
  console.log(`us ${us.publicKey.toBase58()} (${await sol(us.publicKey)} SOL), buyer ${buyer.publicKey.toBase58()} (${await sol(buyer.publicKey)} SOL)`);

  // 1. Config with the tax.
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
    const t = await client.partner.createConfig2({
      payer: us.publicKey, config: config.publicKey, feeClaimer: us.publicKey, leftoverReceiver: us.publicKey, quoteMint: NATIVE_MINT, ...curve,
      transferFeeParameters: { transferFeeBasisPoints: 500, withheldAuthority: TransferFeeWithheldAuthority.Partner, migratedTransferFeeAuthorityOption: MigratedTransferFeeAuthorityOption.Partner },
    });
    const sig = await send(t, [us, config]);
    Object.assign(state, { config: config.publicKey.toBase58(), configTx: tx(sig) });
    save();
    console.log(`1. config ${state.config as string} (5% tax, withheld: Partner, after graduation: Partner) ${tx(sig)}`);
  } else console.log(`1. config ${state.config as string}`);
  const config = new PublicKey(state.config as string);

  // 2. The launch.
  if (!state.mint) {
    const mint = Keypair.generate();
    const t = await client.creator.createPool({ baseMint: mint.publicKey, config, name: "Hashcoin Meteora Test", symbol: "HASHM", uri: "https://example.com/hash.json", payer: us.publicKey, poolCreator: us.publicKey });
    const sig = await send(t, [us, mint]);
    Object.assign(state, { mint: mint.publicKey.toBase58(), poolTx: tx(sig) });
    save();
    console.log(`2. launched ${mint.publicKey.toBase58()} ${tx(sig)}`);
  }
  const mint = new PublicKey(state.mint as string);
  const pool = deriveDbcPoolAddress(NATIVE_MINT, mint, config);
  state.onCurve = await authorities(mint);
  save();
  console.log(`   on the curve: ${JSON.stringify(state.onCurve)}`);

  // 3. Trade, collect the tax, try a rate change while on the curve.
  if ((await sol(buyer.publicKey)) < TARGET_SOL + 0.1) {
    await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: us.publicKey, toPubkey: buyer.publicKey, lamports: Math.round((TARGET_SOL + 0.15) * LAMPORTS_PER_SOL) })), [us]);
  }
  if (!state.buyTx) {
    state.buyTx = await swap(buyer, pool, false, new BN(0.05 * LAMPORTS_PER_SOL));
    save();
    const held = await tokenBalance(conn, buyer.publicKey, mint);
    state.sellTx = await swap(buyer, pool, true, new BN((held / 2n).toString()));
    save();
  }
  console.log(`3. buy ${state.buyTx as string}\n   sell ${state.sellTx as string}`);
  const pre = await harvestFees(conn, us, mint, us, us.publicKey, [ata(buyer.publicKey, mint), ata(us.publicKey, mint)]);
  const vaults = (await client.state.getPool(pool))!.poolState;
  const fromVault = await harvestFees(conn, us, mint, us, us.publicKey, [vaults.baseVault]);
  state.taxCollectedOnCurve = (Number(pre.harvested + fromVault.harvested) / 1e6) + Number(state.taxCollectedOnCurve ?? 0);
  state.rateChangeOnCurve = await tryRate(mint, 275);
  save();
  console.log(`   tax collected: ${state.taxCollectedOnCurve as number} HASHM; rate change on the curve: ${state.rateChangeOnCurve as string}`);

  // 4. Graduate: buy past the target, then migrate to DAMM v2.
  let p = (await client.state.getPool(pool))!.poolState;
  if (!state.gradBuyTx && Number(p.quoteReserve.toString()) < TARGET_SOL * LAMPORTS_PER_SOL) {
    // Partial fill: buys whatever is left on the curve and refunds the rest.
    const t = await client.pool.swap2({ owner: buyer.publicKey, pool, swapBaseForQuote: false, referralTokenAccount: null, payer: buyer.publicKey, swapMode: SwapMode.PartialFill, amountIn: new BN(Math.round((TARGET_SOL + 0.05) * LAMPORTS_PER_SOL)), minimumAmountOut: new BN(0) });
    state.gradBuyTx = tx(await send(t, [buyer]));
    save();
    p = (await client.state.getPool(pool))!.poolState;
  }
  console.log(`4. raised ${Number(p.quoteReserve.toString()) / LAMPORTS_PER_SOL} SOL, migration progress ${p.migrationProgress}, isMigrated ${p.isMigrated}`);
  if (!p.isMigrated && !state.migrateTx) {
    try {
      const m = await client.migration.migrateToDammV2({ payer: us.publicKey, pool, dammConfig: DAMM_V2_MIGRATION_FEE_ADDRESS[6]! });
      state.migrateTx = tx(await send(m.transaction, [us, m.firstPositionNftKeypair, m.secondPositionNftKeypair]));
    } catch (e) {
      state.migrateTx = `failed: ${((e as { logs?: string[] }).logs ?? []).filter((l) => /rror/.test(l)).join(" | ") || (e as Error).message.split("\n")[0]}`;
    }
    save();
  }
  console.log(`   migrate: ${state.migrateTx as string}`);

  // 5. After graduation.
  state.afterGraduation = await authorities(mint);
  save();
  console.log(`5. after graduation: ${JSON.stringify(state.afterGraduation)}`);
  if (!String(state.rateChangeAfter ?? "").startsWith("https")) state.rateChangeAfter = await tryRate(mint, 275);
  try {
    const t = await client.partner.claimPartnerTradingFee({ pool, feeClaimer: us.publicKey, payer: us.publicKey, maxBaseAmount: new BN(0), maxQuoteAmount: new BN("18446744073709551615") });
    state.feeClaim = tx(await send(t, [us]));
  } catch (e) { state.feeClaim = `failed: ${(e as Error).message.split("\n")[0]}`; }
  save();
  console.log(`   rate change after graduation: ${state.rateChangeAfter as string}\n   our trading fee claim: ${state.feeClaim as string}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
