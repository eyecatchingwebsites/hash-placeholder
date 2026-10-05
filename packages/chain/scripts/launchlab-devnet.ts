// Can we launch $HASH on Raydium LaunchLab with our tax? A devnet test of the whole route:
//   1. create our own LaunchLab platform, with our wallet as the transfer-fee authority
//   2. launch a Token-2022 token with a 5% transfer fee on a bonding curve (21M supply)
//   3. read the mint: who holds the fee config and withdraw authorities?
//   4. a test wallet buys and sells on the curve (does the tax apply to curve trades?)
//   5. collect the withheld tax to our wallet, and schedule a new rate
//   6. claim the platform and creator fees (SOL) that would pay miners at launch
// Each step is skipped if already done; state in packages/chain/data/launchlab-devnet.json.
//
//   npx tsx packages/chain/scripts/launchlab-devnet.ts
//
// Keys are throwaway devnet keypairs in packages/chain/data/ (gitignored). Never use them on mainnet.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getMint, getTransferFeeConfig, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  DEV_API_URLS, DEV_LAUNCHPAD_PROGRAM, getPdaLaunchpadConfigId, getPdaLaunchpadPoolId, getPdaLaunchpadVaultId, getPdaPlatformId,
  LaunchpadConfig, PlatformConfig, Raydium, TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import { ata, harvestFees, setTaxRate, tokenBalance, transferFeeNow } from "../src/token.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const DATA = here("../data");
const conn = new Connection(process.env.SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
const PROGRAM = DEV_LAUNCHPAD_PROGRAM;
const DECIMALS = 6;
const SUPPLY = new BN(21_000_000).mul(new BN(10).pow(new BN(DECIMALS)));
const FEE_BPS = 500;

const readJson = <T>(path: string, fallback: T): T => { try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; } };
const keys = readJson<{ admin: number[]; buyer: number[] }>(`${DATA}/launchlab-keys.json`, { admin: [], buyer: [] });
const admin = Keypair.fromSecretKey(Uint8Array.from(keys.admin));
const buyer = Keypair.fromSecretKey(Uint8Array.from(keys.buyer));
const stateFile = `${DATA}/launchlab-devnet.json`;
const state = readJson<Record<string, unknown>>(stateFile, {});
const save = () => writeFileSync(stateFile, JSON.stringify(state, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
const sol = async (k: PublicKey) => (await conn.getBalance(k)) / LAMPORTS_PER_SOL;
const tx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;

const load = (owner: Keypair) => Raydium.load({
  owner, connection: conn, cluster: "devnet", disableFeatureCheck: true, disableLoadToken: true, blockhashCommitment: "finalized",
  urlConfigs: {
    ...DEV_API_URLS, BASE_HOST: "https://api-v3-devnet.raydium.io", OWNER_BASE_HOST: "https://owner-v1-devnet.raydium.io",
    SWAP_HOST: "https://transaction-v1-devnet.raydium.io", CPMM_LOCK: "https://dynamic-ipfs-devnet.raydium.io/lock/cpmm/position",
  },
});

async function main() {
  console.log(`admin ${admin.publicKey.toBase58()} (${await sol(admin.publicKey)} SOL), buyer ${buyer.publicKey.toBase58()} (${await sol(buyer.publicKey)} SOL)`);
  if ((await sol(admin.publicKey)) < 0.1) throw new Error(`fund the admin with devnet SOL first: ${admin.publicKey.toBase58()} (https://faucet.solana.com)`);
  const raydium = await load(admin);

  // 1. Our platform. One per admin wallet; its transfer-fee authority is the wallet we name here.
  const platformId = getPdaPlatformId(PROGRAM, admin.publicKey).publicKey;
  if (!(await conn.getAccountInfo(platformId))) {
    const cpmm = (await (await fetch("https://api-v3-devnet.raydium.io/main/cpmm-config")).json()) as { data: { id: string; index: number }[] };
    const { execute } = await raydium.launchpad.createPlatformConfig({
      programId: PROGRAM, platformAdmin: admin.publicKey, platformClaimFeeWallet: admin.publicKey, platformLockNftWallet: admin.publicKey,
      platformVestingWallet: admin.publicKey, cpConfigId: new PublicKey(cpmm.data.find((c) => c.index === 0)!.id),
      transferFeeExtensionAuth: admin.publicKey,
      creatorFeeRate: new BN(5000), feeRate: new BN(5000), // test values: 0.5% each (rates are per 1,000,000)
      migrateCpLockNftScale: { platformScale: new BN(0), creatorScale: new BN(0), burnScale: new BN(1_000_000) }, // burn all LP at graduation
      name: "Hashcoin (devnet test)", web: "https://example.com", img: "https://example.com/logo.png", txVersion: TxVersion.V0,
    });
    const r = await execute({ sendAndConfirm: true });
    state.platform = { id: platformId.toBase58(), tx: tx(r.txId) };
    save();
    console.log(`1. platform created ${platformId.toBase58()}\n   ${tx(r.txId)}`);
  } else console.log(`1. platform exists ${platformId.toBase58()}`);
  const platform = PlatformConfig.decode((await conn.getAccountInfo(platformId))!.data);
  console.log(`   platform fee ${platform.feeRate.toString()} / creator fee ${platform.creatorFeeRate.toString()} (per 1e6)`);

  // 2. The launch: Token-2022, 5% transfer fee, 21M supply on the SOL curve.
  const configId = getPdaLaunchpadConfigId(PROGRAM, NATIVE_MINT, 0, 0).publicKey;
  const configInfo = LaunchpadConfig.decode((await conn.getAccountInfo(configId))!.data);
  if (!state.mint) {
    const mint = Keypair.generate();
    const { execute } = await raydium.launchpad.createLaunchpad({
      programId: PROGRAM, platformId, mintA: mint.publicKey, decimals: DECIMALS, name: "Hashcoin Test", symbol: "HASHT",
      uri: "https://example.com/hash.json", migrateType: "cpmm", configId, configInfo, mintBDecimals: 9, mintBProgram: TOKEN_PROGRAM_ID,
      txVersion: TxVersion.V0, slippage: new BN(100), buyAmount: new BN(0), createOnly: true, extraSigners: [mint],
      transferFeeExtensionParams: { transferFeeBasePoints: FEE_BPS, maxinumFee: SUPPLY },
      supply: SUPPLY, totalSellA: SUPPLY.muln(7931).divn(10000), totalFundRaisingB: new BN(85 * LAMPORTS_PER_SOL),
    });
    const r = await execute({ sequentially: true });
    state.mint = mint.publicKey.toBase58();
    state.launchTx = r.txIds.map(tx);
    save();
    console.log(`2. launched ${mint.publicKey.toBase58()}\n   ${tx(r.txIds[0]!)}`);
  } else console.log(`2. launched earlier: ${state.mint as string}`);
  const mintA = new PublicKey(state.mint as string);
  const poolId = getPdaLaunchpadPoolId(PROGRAM, mintA, NATIVE_MINT).publicKey;
  const vaultA = getPdaLaunchpadVaultId(PROGRAM, poolId, mintA).publicKey;

  // 3. Who holds the tax?
  const info = await getMint(conn, mintA, "confirmed", TOKEN_2022_PROGRAM_ID);
  const fee = getTransferFeeConfig(info)!;
  const live = await transferFeeNow(conn, mintA);
  state.authorities = {
    feeConfig: fee.transferFeeConfigAuthority.toBase58(), withdraw: fee.withdrawWithheldAuthority.toBase58(),
    mint: info.mintAuthority?.toBase58() ?? null, freeze: info.freezeAuthority?.toBase58() ?? null, liveBps: live.bps, supply: info.supply,
  };
  save();
  const ours = (k: PublicKey) => (k.equals(admin.publicKey) ? "OURS" : k.toBase58());
  console.log(`3. fee ${live.bps} bps; config authority ${ours(fee.transferFeeConfigAuthority)}, withdraw authority ${ours(fee.withdrawWithheldAuthority)}; mint authority ${info.mintAuthority?.toBase58() ?? "none"}, freeze ${info.freezeAuthority?.toBase58() ?? "none"}; supply ${Number(info.supply) / 1e6}`);

  // 4. A buyer trades on the curve.
  if ((await sol(buyer.publicKey)) < 0.03) {
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: buyer.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })), [admin]);
    console.log(`   funded buyer 0.05 SOL ${tx(sig)}`);
  }
  const rb = await load(buyer);
  const poolInfo = await rb.launchpad.getRpcPoolInfo({ poolId });
  const buy = await rb.launchpad.buyToken({
    programId: PROGRAM, mintA, mintAProgram: TOKEN_2022_PROGRAM_ID, poolInfo, configInfo: poolInfo.configInfo, platformFeeRate: platform.feeRate,
    txVersion: TxVersion.V0, buyAmount: new BN(0.02 * LAMPORTS_PER_SOL), slippage: new BN(500),
  });
  const bought = await buy.execute({ sendAndConfirm: true });
  const held = await tokenBalance(conn, buyer.publicKey, mintA);
  console.log(`4. buyer bought for 0.02 SOL → holds ${Number(held) / 1e6} ${tx(bought.txId)}`);
  const sell = await rb.launchpad.sellToken({
    programId: PROGRAM, mintA, mintAProgram: TOKEN_2022_PROGRAM_ID, poolInfo: await rb.launchpad.getRpcPoolInfo({ poolId }), configInfo: poolInfo.configInfo,
    platformFeeRate: platform.feeRate, txVersion: TxVersion.V0, sellAmount: new BN((held / 2n).toString()), slippage: new BN(500),
  });
  const sold = await sell.execute({ sendAndConfirm: true });
  console.log(`   buyer sold half ${tx(sold.txId)}`);

  // 5. Collect the tax and schedule a new rate.
  const candidates = [ata(buyer.publicKey, mintA), ata(admin.publicKey, mintA), vaultA];
  const h = await harvestFees(conn, admin, mintA, admin, admin.publicKey, candidates);
  console.log(`5. tax collected to our wallet: ${Number(h.harvested) / 1e6} HASHT ${h.signatures.map(tx).join(" ")}`);
  const rateSig = await setTaxRate(conn, admin, mintA, admin, 275, BigInt(SUPPLY.toString()));
  const after = await transferFeeNow(conn, mintA);
  console.log(`   rate change scheduled: ${after.scheduled?.bps ?? after.bps} bps from epoch ${after.scheduled?.epoch ?? "now"} ${tx(rateSig)}`);

  // 6. Platform and creator fees (SOL): what would pay miners on launch day.
  const before = await sol(admin.publicKey);
  const results: Record<string, string> = {};
  for (const [name, run] of [
    ["platform", () => raydium.launchpad.claimPlatformFee({ programId: PROGRAM, platformId, platformClaimFeeWallet: admin.publicKey, poolId, txVersion: TxVersion.V0 })],
    ["creator", () => raydium.launchpad.claimCreatorFee({ programId: PROGRAM, mintB: NATIVE_MINT, txVersion: TxVersion.V0 })],
  ] as const) {
    try { const r = await (await run()).execute({ sendAndConfirm: true }); results[name] = tx(r.txId); } catch (e) { results[name] = `failed: ${(e as Error).message.split("\n")[0]}`; }
  }
  console.log(`6. fees claimed: ${JSON.stringify(results)}; admin SOL ${before} → ${await sol(admin.publicKey)}`);
  Object.assign(state, { trades: { buy: tx(bought.txId), sell: tx(sold.txId) }, taxCollected: Number(h.harvested) / 1e6, rateChange: tx(rateSig), fees: results });
  save();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
