// The $HASH market on Meteora: the Dynamic Bonding Curve (DBC) until graduation, then the DAMM v2
// pool it migrates to. Finds which phase the token is in, prices it, quotes and builds SOL → $HASH
// buys with a slippage floor, and claims our partner trading fee (SOL) from the curve.
// Every send goes through the caller (and the connection's kill-switch guard): nothing here signs.
import { type Connection, PublicKey, type Transaction } from "@solana/web3.js";
import { calculateEpochFee, getMint, getTransferFeeConfig, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  DAMM_V2_MIGRATION_FEE_ADDRESS, deriveDammV2PoolAddress, deriveDbcPoolAddress, deriveDbcPoolAuthority, DynamicBondingCurveClient,
  getCurrentPoint as dbcCurrentPoint, getSwapQuoteTransferFees, SwapMode as DbcSwapMode,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, derivePoolAuthority as dammPoolAuthority, getCurrentPoint as dammCurrentPoint, getPriceFromSqrtPrice, getUnClaimLpFee, SwapMode as DammSwapMode } from "@meteora-ag/cp-amm-sdk";
import BN from "bn.js";

/**
 * curve: trading on the bonding curve. graduating: the curve is full, migration to DAMM v2 hasn't
 * happened yet (nobody can trade). damm: graduated, trading on the DAMM v2 pool.
 */
export type MarketPhase = "curve" | "graduating" | "damm";

export interface MeteoraMarketRef {
  mint: PublicKey;
  /** The DBC config the token launched with (the pool address is derived from it). */
  dbcConfig: PublicKey;
  /** Override for the DAMM v2 pool; otherwise derived from the config's migration fee option. */
  dammPool?: PublicKey;
}

export interface MarketState {
  phase: MarketPhase;
  dbcPool: PublicKey;
  dammPool?: PublicKey;
  /** SOL per whole $HASH at the pool's current price (before fees). */
  priceSol: number;
  decimals: number;
  /** Our unclaimed partner trading fee on the curve, in lamports. */
  partnerClaimableLamports: bigint;
  feeClaimer: PublicKey;
  /** Wallets that own the pool vaults: never holders, never miners, their transfers aren't trades. */
  poolOwners: PublicKey[];
  /** Curve progress toward graduation, 0-1 (1 once graduated). */
  progress: number;
}

export interface BuyQuote {
  phase: "curve" | "damm";
  pool: PublicKey;
  lamportsIn: bigint;
  /** Tokens we'd receive, after the pool fee and the Token-2022 transfer fee on the way out. */
  expectedOut: bigint;
  /** Slippage floor: the swap fails rather than deliver less than this. */
  minimumOut: bigint;
  /**
   * How much worse than the spot price the buy fills, after allowing for the transfer fee: the pool's
   * trading fee plus price impact, in bps.
   */
  costBps: number;
}

const U64_MAX = new BN("18446744073709551615");
const bn = (x: bigint) => new BN(x.toString());
const big = (x: BN) => BigInt(x.toString());

export class MeteoraMarket {
  readonly dbc: DynamicBondingCurveClient;
  readonly damm: CpAmm;
  readonly dbcPool: PublicKey;

  constructor(readonly conn: Connection, readonly ref: MeteoraMarketRef) {
    this.dbc = new DynamicBondingCurveClient(conn, "confirmed");
    this.damm = new CpAmm(conn);
    this.dbcPool = deriveDbcPoolAddress(NATIVE_MINT, ref.mint, ref.dbcConfig);
  }

  /** Read both pools and say where trading happens now. */
  async state(): Promise<MarketState> {
    const [vp, cfg, mint] = await Promise.all([
      this.dbc.state.getPool(this.dbcPool), this.dbc.state.getPoolConfig(this.ref.dbcConfig), getMint(this.conn, this.ref.mint, "confirmed", TOKEN_2022_PROGRAM_ID),
    ]);
    if (!vp || !cfg) throw new Error(`no DBC pool ${this.dbcPool.toBase58()} for config ${this.ref.dbcConfig.toBase58()}`);
    const p = vp.poolState;
    const decimals = mint.decimals;
    const quoteDecimals = 9;
    const owners = [deriveDbcPoolAuthority(), dammPoolAuthority()];
    const partnerClaimableLamports = big(p.partnerQuoteFee);
    if (Number(p.isMigrated) === 0) {
      const threshold = Number(cfg.migrationQuoteThreshold.toString());
      const progress = threshold > 0 ? Math.min(1, Number(p.quoteReserve.toString()) / threshold) : 0;
      // The curve stops trading once it holds the threshold; migration is a separate transaction.
      const phase: MarketPhase = progress >= 1 || Number(p.migrationProgress) > 0 ? "graduating" : "curve";
      return { phase, dbcPool: this.dbcPool, priceSol: sqrtPriceToPrice(big(p.sqrtPrice), decimals, quoteDecimals), decimals, partnerClaimableLamports, feeClaimer: cfg.feeClaimer, poolOwners: owners, progress };
    }
    const dammPool = this.ref.dammPool ?? deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[Number(cfg.migrationFeeOption)]!, this.ref.mint, NATIVE_MINT);
    const ps = await this.damm.fetchPoolState(dammPool);
    const aIsHash = ps.tokenAMint.equals(this.ref.mint);
    const ab = getPriceFromSqrtPrice(ps.sqrtPrice, aIsHash ? decimals : quoteDecimals, aIsHash ? quoteDecimals : decimals).toNumber();
    return { phase: "damm", dbcPool: this.dbcPool, dammPool, priceSol: aIsHash ? ab : 1 / ab, decimals, partnerClaimableLamports, feeClaimer: cfg.feeClaimer, poolOwners: owners, progress: 1 };
  }

  /**
   * Quote a SOL → $HASH buy of `lamportsIn`, with a slippage floor of `slippageBps`. `transferFeeBps`
   * is the $HASH tax in force, so the cost figure counts only the pool's fee and price impact.
   */
  async quoteBuy(s: MarketState, lamportsIn: bigint, slippageBps: number, transferFeeBps: number): Promise<BuyQuote> {
    if (lamportsIn <= 0n) throw new Error("nothing to buy");
    const spotOut = (Number(lamportsIn) / 1e9 / s.priceSol) * 10 ** s.decimals * (1 - transferFeeBps / 10_000);
    const costBps = (out: bigint) => Math.round(10_000 * (1 - Number(out) / spotOut));
    if (s.phase === "curve") {
      const [vp, cfg] = await Promise.all([this.dbc.state.getPool(this.dbcPool), this.dbc.state.getPoolConfig(this.ref.dbcConfig)]);
      const currentPoint = await dbcCurrentPoint(this.conn, cfg!.activationType);
      const q = this.dbc.pool.swapQuote2({
        virtualPool: vp!, config: cfg!, swapBaseForQuote: false, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint,
        slippageBps, swapMode: DbcSwapMode.ExactIn, amountIn: bn(lamportsIn),
        ...(await getSwapQuoteTransferFees(this.conn, cfg!, { baseMint: this.ref.mint })),
      });
      const out = big(q.excludedTransferFeeAmountOut);
      return { phase: "curve", pool: this.dbcPool, lamportsIn, expectedOut: out, minimumOut: big(q.minimumAmountOut ?? new BN(0)), costBps: costBps(out) };
    }
    if (s.phase === "damm") {
      const ps = await this.damm.fetchPoolState(s.dammPool!);
      const [hashMint, solMint, { epoch }] = await Promise.all([
        getMint(this.conn, this.ref.mint, "confirmed", TOKEN_2022_PROGRAM_ID), getMint(this.conn, NATIVE_MINT, "confirmed", TOKEN_PROGRAM_ID), this.conn.getEpochInfo("confirmed"),
      ]);
      const currentPoint = await dammCurrentPoint(this.conn, ps.activationType);
      const aIsHash = ps.tokenAMint.equals(this.ref.mint);
      const q = this.damm.getQuote2({
        // In basis points (despite the name): checked against the SDK's minimumAmountOut.
        inputTokenMint: NATIVE_MINT, slippage: slippageBps, currentPoint, poolState: ps,
        inputTokenInfo: { mint: solMint, currentEpoch: epoch }, outputTokenInfo: { mint: hashMint, currentEpoch: epoch },
        tokenADecimal: aIsHash ? s.decimals : 9, tokenBDecimal: aIsHash ? 9 : s.decimals, hasReferral: false,
        swapMode: DammSwapMode.ExactIn, amountIn: bn(lamportsIn),
      });
      // outputAmount is before the Token-2022 fee withheld on the way out; what we keep is less.
      const out = big(q.outputAmount) - calculateEpochFee(getTransferFeeConfig(hashMint)!, BigInt(epoch), big(q.outputAmount));
      return { phase: "damm", pool: s.dammPool!, lamportsIn, expectedOut: out, minimumOut: big(q.minimumAmountOut ?? new BN(0)), costBps: costBps(out) };
    }
    throw new Error("the curve is graduating: no trading until migration to DAMM v2");
  }

  /** The buy transaction for a quote: `owner` pays SOL (wrapped for the swap) and receives $HASH. */
  async buyTx(q: BuyQuote, owner: PublicKey): Promise<Transaction> {
    if (q.phase === "curve") {
      return this.dbc.pool.swap2({
        owner, payer: owner, pool: q.pool, swapBaseForQuote: false, referralTokenAccount: null,
        swapMode: DbcSwapMode.ExactIn, amountIn: bn(q.lamportsIn), minimumAmountOut: bn(q.minimumOut),
      });
    }
    const ps = await this.damm.fetchPoolState(q.pool);
    return this.damm.swap2({
      payer: owner, pool: q.pool, inputTokenMint: NATIVE_MINT, outputTokenMint: this.ref.mint,
      tokenAMint: ps.tokenAMint, tokenBMint: ps.tokenBMint, tokenAVault: ps.tokenAVault, tokenBVault: ps.tokenBVault,
      tokenAProgram: ps.tokenAMint.equals(this.ref.mint) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      tokenBProgram: ps.tokenBMint.equals(this.ref.mint) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      referralTokenAccount: null, poolState: ps,
      swapMode: DammSwapMode.ExactIn, amountIn: bn(q.lamportsIn), minimumAmountOut: bn(q.minimumOut),
    });
  }

  /**
   * After graduation: the pool fee our locked DAMM v2 position(s) have earned and not claimed yet
   * (the partner's position, 100% permanently locked at migration), in lamports and in $HASH.
   */
  async dammFees(s: MarketState, owner: PublicKey): Promise<{ lamports: bigint; tokens: bigint; positions: { position: PublicKey; positionNftAccount: PublicKey }[] }> {
    if (s.phase !== "damm" || !s.dammPool) return { lamports: 0n, tokens: 0n, positions: [] };
    const [ps, mine] = await Promise.all([this.damm.fetchPoolState(s.dammPool), this.damm.getUserPositionByPool(s.dammPool, owner)]);
    const aIsHash = ps.tokenAMint.equals(this.ref.mint);
    let lamports = 0n, tokens = 0n;
    const positions: { position: PublicKey; positionNftAccount: PublicKey }[] = [];
    for (const p of mine) {
      const f = getUnClaimLpFee(ps, p.positionState);
      const sol = big(aIsHash ? f.feeTokenB : f.feeTokenA), hash = big(aIsHash ? f.feeTokenA : f.feeTokenB);
      if (sol > 0n || hash > 0n) positions.push({ position: p.position, positionNftAccount: p.positionNftAccount });
      lamports += sol;
      tokens += hash;
    }
    return { lamports, tokens, positions };
  }

  /** Claim the pool fee of one of our DAMM v2 positions to `owner` (SOL unwrapped). `owner` signs. */
  async claimDammFeeTx(s: MarketState, owner: PublicKey, p: { position: PublicKey; positionNftAccount: PublicKey }): Promise<Transaction> {
    const ps = await this.damm.fetchPoolState(s.dammPool!);
    const program = (m: PublicKey) => (m.equals(this.ref.mint) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);
    return this.damm.claimPositionFee2({
      owner, receiver: owner, feePayer: owner, pool: s.dammPool!, position: p.position, positionNftAccount: p.positionNftAccount,
      tokenAMint: ps.tokenAMint, tokenBMint: ps.tokenBMint, tokenAVault: ps.tokenAVault, tokenBVault: ps.tokenBVault,
      tokenAProgram: program(ps.tokenAMint), tokenBProgram: program(ps.tokenBMint),
    });
  }

  /** Claim our partner trading fee (SOL) from the curve pool. `feeClaimer` must sign. */
  claimPartnerFeeTx(feeClaimer: PublicKey): Promise<Transaction> {
    return this.dbc.partner.claimPartnerTradingFee({ pool: this.dbcPool, feeClaimer, payer: feeClaimer, maxBaseAmount: new BN(0), maxQuoteAmount: U64_MAX });
  }
}

/** Price (quote per whole base token) from a Q64.64 square-root price. */
export function sqrtPriceToPrice(sqrtPriceX64: bigint, baseDecimals: number, quoteDecimals: number): number {
  const s = Number(sqrtPriceX64) / 2 ** 64;
  return s * s * 10 ** (baseDecimals - quoteDecimals);
}

/**
 * SOL to spend so that, after the transfer fee withheld on the bought tokens, we end up with
 * `usd` worth at the current price: the "little extra" that keeps miners whole (the withheld part
 * comes back to the treasury at the next harvest).
 */
export function lamportsForUsd(usd: number, solUsd: number, feeBps: number): bigint {
  if (!(usd > 0) || !(solUsd > 0)) return 0n;
  return BigInt(Math.ceil(((usd / solUsd) * 1e9) / (1 - feeBps / 10_000)));
}
