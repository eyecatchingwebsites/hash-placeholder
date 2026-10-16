import { describe, expect, it } from "vitest";
import { LAUNCH, launchCurve, launchSummary, TRANSFER_FEE_PARAMETERS } from "../src/launch.js";

describe("launch settings", () => {
  it("pass Meteora's own config checks with our tax settings", () => {
    for (const g of [20, 40, 50, 85, 200]) expect(() => launchSummary(g)).not.toThrow();
  });

  it("put 25% of supply in the pool: graduation market cap = target / 25%, price x9 over the curve", () => {
    const s = launchSummary(50);
    expect(s.graduationMarketCapSol).toBeCloseTo(200, 0);
    expect(s.startMarketCapSol).toBeCloseTo(22.2, 1);
    expect(s.priceRiseOverCurve).toBeCloseTo(9, 1);
  });

  it("keep the tax, fees and supply as decided", () => {
    const c = launchCurve(50);
    expect(TRANSFER_FEE_PARAMETERS.transferFeeBasisPoints).toBe(500);
    expect(c.tokenSupply?.preMigrationTokenSupply.toString()).toBe(String(LAUNCH.supply * 10 ** LAUNCH.decimals));
    expect(c.tokenSupply?.postMigrationTokenSupply.toString()).toBe(c.tokenSupply?.preMigrationTokenSupply.toString());
    expect(c.migratedPoolFee.poolFeeBps).toBe(25);
    expect(c.enableFirstSwapWithMinFee).toBe(true);
    expect(c.partnerPermanentLockedLiquidityPercentage).toBe(100);
  });

  it("price our 1% dev bag after the 5% tax", () => {
    const s = launchSummary(50);
    expect(s.devBuy.tokensKept).toBe(210_000);
    expect(s.devBuy.tokensBought).toBeCloseTo(210_000 / 0.95, 0);
    expect(s.devBuy.sol).toBeGreaterThan(0.2);
    expect(s.devBuy.sol).toBeLessThan(0.3);
  });

  it("refuse a non-positive target", () => {
    expect(() => launchCurve(0)).toThrow();
  });
});
