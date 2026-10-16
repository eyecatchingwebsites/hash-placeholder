// The $HASH launch on Meteora Dynamic Bonding Curve 0.2.2: one place for every launch setting, and the
// numbers they imply (start and graduation market cap, the dev buy's cost). Used by
// scripts/launch-mainnet.ts and checked by test/launch.test.ts. Decided Oct 16, 2026 (docs/PROJECT.md §2):
// everything here except the graduation target, which the user picks 24–48 h before launch.
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  ActivationType, BaseFeeMode, buildCurve, CollectFeeMode, getPriceFromSqrtPrice, getQuoteFromOutputAmount, MigratedCollectFeeMode,
  MigratedTransferFeeAuthorityOption, MigrationFeeOption, MigrationOption, PROTOCOL_FEE_PERCENT, TokenAuthorityOption, TokenDecimal, TokenType,
  TransferFeeWithheldAuthority, validateConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export const LAUNCH = {
  supply: 21_000_000,
  decimals: 6,
  /** The tax while on the curve. Fixed until graduation; after it our formula sets 2–5%. */
  taxBps: 500,
  /** Share of supply moved into the DAMM v2 pool at graduation (the rest is sold on the curve). */
  percentToPool: 25,
  /** Curve fee: starts at 20% against snipers and falls linearly to 1% over the first 5 minutes. */
  curveFee: { startBps: 2000, endBps: 100, periods: 60, seconds: 300 },
  /** DAMM v2 pool fee after graduation, paid to us in SOL (compoundingFeeBps 0). */
  poolFeeBps: 25,
  /** Our 1% dev bag, bought openly as the first swap (net of the tax). */
  devBuyTokens: 210_000,
  /** Graduation targets allowed on mainnet, in SOL (the plan is 40–85, picked from the X campaign). */
  mainnetGraduationSol: { min: 20, max: 200 },
} as const;

export type LaunchConfig = ReturnType<typeof buildCurve>;

/** The curve and fee parameters for a graduation target, ready to spread into createConfig2. */
export function launchCurve(graduationSol: number): LaunchConfig {
  if (!(graduationSol > 0)) throw new Error("graduation target must be a positive number of SOL");
  const f = LAUNCH.curveFee;
  return buildCurve({
    token: {
      tokenType: TokenType.Token2022, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: TokenDecimal.NINE,
      tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: LAUNCH.supply, leftover: 0,
    },
    fee: {
      baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: f.startBps, endingFeeBps: f.endBps, numberOfPeriod: f.periods, totalDuration: f.seconds } },
      dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 0, poolCreationFee: 0,
      // Our own opening buy (in the pool-creation transaction) pays the 1% floor, not the 20% sniper fee.
      enableFirstSwapWithMinFee: true,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.Compounding, dynamicFee: 0, poolFeeBps: LAUNCH.poolFeeBps, compoundingFeeBps: 0 },
    },
    liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 100, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 0, creatorLiquidityPercentage: 0 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp, percentageSupplyOnMigration: LAUNCH.percentToPool, migrationQuoteThreshold: graduationSol,
  });
}

/** The tax settings for createConfig2: we collect the tax, and the rate authority comes to us at graduation. */
export const TRANSFER_FEE_PARAMETERS = {
  transferFeeBasisPoints: LAUNCH.taxBps,
  withheldAuthority: TransferFeeWithheldAuthority.Partner,
  migratedTransferFeeAuthorityOption: MigratedTransferFeeAuthorityOption.Partner,
};

const lamportsToSol = (x: BN) => Number(x.toString()) / 1e9;

/** What a graduation target means: market caps in SOL, and the SOL our dev buy needs. */
export function launchSummary(graduationSol: number, curve = launchCurve(graduationSol)) {
  // Meteora's own checks (throws on anything the program would reject), with our tax settings.
  validateConfigParameters({ ...curve, leftoverReceiver: PublicKey.unique() }, { transferFeeParameters: TRANSFER_FEE_PARAMETERS }); // any non-default receiver
  const price = (sqrt: BN) => Number(getPriceFromSqrtPrice(sqrt, LAUNCH.decimals, 9));
  const last = curve.curve.filter((p) => !p.sqrtPrice.isZero()).at(-1)!;
  const startPrice = price(curve.sqrtStartPrice), endPrice = price(last.sqrtPrice);
  // The dev buy: exact-out for the bag we keep (the quote adds the 5% tax on top), at the first-swap 1% fee.
  const q = getQuoteFromOutputAmount({
    config: curve, swapBaseForQuote: false, amountOut: new BN(LAUNCH.devBuyTokens).mul(new BN(10).pow(new BN(LAUNCH.decimals))),
    slippageBps: 100, eligibleForFirstSwapWithMinFee: true, baseTransferFeeBasisPoints: LAUNCH.taxBps,
  });
  return {
    graduationSol,
    startMarketCapSol: startPrice * LAUNCH.supply,
    graduationMarketCapSol: endPrice * LAUNCH.supply,
    priceRiseOverCurve: endPrice / startPrice,
    devBuy: {
      tokensKept: LAUNCH.devBuyTokens, tokensBought: Number(q.outputAmount.toString()) / 10 ** LAUNCH.decimals,
      lamports: q.includedFeeInputAmount, sol: lamportsToSol(q.includedFeeInputAmount),
    },
    curveFeeToUsPercent: (LAUNCH.curveFee.endBps / 100) * (1 - PROTOCOL_FEE_PERCENT / 100),
  };
}
