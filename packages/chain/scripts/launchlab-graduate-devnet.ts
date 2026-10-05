// Does a Token-2022 $HASH with a 5% tax graduate from the LaunchLab curve into a Raydium CPMM pool,
// and does the tax keep working there? Devnet allows a tiny graduation target (mainnet needs 24+ SOL).
//   1. launch a second test token on our platform with a 0.2 SOL target
//   2. a buyer buys past the target, so the curve completes
//   3. wait for Raydium's migration to a CPMM pool, then check the tax still applies and is ours to collect
//
//   npx tsx packages/chain/scripts/launchlab-graduate-devnet.ts
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getMint, getTransferFeeConfig, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  DEV_API_URLS, DEV_LAUNCHPAD_PROGRAM, getPdaLaunchpadConfigId, getPdaLaunchpadPoolId, getPdaPlatformId, LaunchpadConfig, PlatformConfig,
  Raydium, TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const DATA = here("../data");
const conn = new Connection(process.env.SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
const PROGRAM = DEV_LAUNCHPAD_PROGRAM;
const SUPPLY = new BN(21_000_000).mul(new BN(1_000_000));
const TARGET = new BN(0.2 * LAMPORTS_PER_SOL);
const readJson = <T>(path: string, fallback: T): T => { try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; } };
const keys = readJson<{ admin: number[]; buyer: number[] }>(`${DATA}/launchlab-keys.json`, { admin: [], buyer: [] });
const admin = Keypair.fromSecretKey(Uint8Array.from(keys.admin));
const buyer = Keypair.fromSecretKey(Uint8Array.from(keys.buyer));
const stateFile = `${DATA}/launchlab-graduate-devnet.json`;
const state = readJson<Record<string, unknown>>(stateFile, {});
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
const tx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const load = (owner: Keypair) => Raydium.load({
  owner, connection: conn, cluster: "devnet", disableFeatureCheck: true, disableLoadToken: true, blockhashCommitment: "finalized",
  urlConfigs: {
    ...DEV_API_URLS, BASE_HOST: "https://api-v3-devnet.raydium.io", OWNER_BASE_HOST: "https://owner-v1-devnet.raydium.io",
    SWAP_HOST: "https://transaction-v1-devnet.raydium.io", CPMM_LOCK: "https://dynamic-ipfs-devnet.raydium.io/lock/cpmm/position",
  },
});

async function main() {
  const raydium = await load(admin);
  const platformId = getPdaPlatformId(PROGRAM, admin.publicKey).publicKey;
  const platform = PlatformConfig.decode((await conn.getAccountInfo(platformId))!.data);
  const configId = getPdaLaunchpadConfigId(PROGRAM, NATIVE_MINT, 0, 0).publicKey;
  const configInfo = LaunchpadConfig.decode((await conn.getAccountInfo(configId))!.data);

  if (!state.mint) {
    const mint = Keypair.generate();
    const { execute } = await raydium.launchpad.createLaunchpad({
      programId: PROGRAM, platformId, mintA: mint.publicKey, decimals: 6, name: "Hashcoin Grad Test", symbol: "HASHG",
      uri: "https://example.com/hash.json", migrateType: "cpmm", configId, configInfo, mintBDecimals: 9, mintBProgram: TOKEN_PROGRAM_ID,
      txVersion: TxVersion.V0, slippage: new BN(100), buyAmount: new BN(0), createOnly: true, extraSigners: [mint],
      transferFeeExtensionParams: { transferFeeBasePoints: 500, maxinumFee: SUPPLY },
      supply: SUPPLY, totalSellA: SUPPLY.muln(7931).divn(10000), totalFundRaisingB: TARGET,
    });
    const r = await execute({ sequentially: true });
    state.mint = mint.publicKey.toBase58();
    state.launchTx = tx(r.txIds[0]!);
    save();
    console.log(`1. launched ${state.mint as string} with a 0.2 SOL target ${state.launchTx as string}`);
  }
  const mintA = new PublicKey(state.mint as string);
  const poolId = getPdaLaunchpadPoolId(PROGRAM, mintA, NATIVE_MINT).publicKey;

  if (!state.buyTx) {
    if ((await conn.getBalance(buyer.publicKey)) < 0.3 * LAMPORTS_PER_SOL) {
      await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: buyer.publicKey, lamports: 0.3 * LAMPORTS_PER_SOL })), [admin]);
    }
    const rb = await load(buyer);
    const poolInfo = await rb.launchpad.getRpcPoolInfo({ poolId });
    const { execute } = await rb.launchpad.buyToken({
      programId: PROGRAM, mintA, mintAProgram: TOKEN_2022_PROGRAM_ID, poolInfo, configInfo: poolInfo.configInfo, platformFeeRate: platform.feeRate,
      txVersion: TxVersion.V0, buyAmount: new BN(0.25 * LAMPORTS_PER_SOL), slippage: new BN(1000),
    });
    const r = await execute({ sendAndConfirm: true });
    state.buyTx = tx(r.txId);
    save();
    console.log(`2. bought for 0.25 SOL (past the target) ${state.buyTx as string}`);
  }

  // 3. Status 0 = trading, 1 = curve complete (waiting for migration), 2 = migrated.
  for (let i = 0; i < 40; i++) {
    const p = await raydium.launchpad.getRpcPoolInfo({ poolId });
    console.log(`3. pool status ${p.status} (raised ${Number(p.realB.toString()) / LAMPORTS_PER_SOL} of ${Number(p.totalFundRaisingB.toString()) / LAMPORTS_PER_SOL} SOL)`);
    state.status = p.status;
    save();
    if (p.status === 2) break;
    await sleep(30_000);
  }
  const fee = getTransferFeeConfig(await getMint(conn, mintA, "confirmed", TOKEN_2022_PROGRAM_ID))!;
  console.log(`   after: fee ${fee.newerTransferFee.transferFeeBasisPoints} bps, withdraw authority ${fee.withdrawWithheldAuthority.equals(admin.publicKey) ? "OURS" : fee.withdrawWithheldAuthority.toBase58()}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
