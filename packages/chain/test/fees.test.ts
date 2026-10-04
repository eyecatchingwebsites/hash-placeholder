import { describe, expect, it } from "vitest";
import { chunk, grossUp, transferFee, usdToBaseUnits } from "../src/fees.js";

const MAX = 10n ** 18n;

describe("transfer fee maths", () => {
  it("5% rounded up, capped at the max fee", () => {
    expect(transferFee(1000n, 500, MAX)).toBe(50n);
    expect(transferFee(1001n, 500, MAX)).toBe(51n); // 50.05 → 51
    expect(transferFee(1000n, 500, 7n)).toBe(7n);
    expect(transferFee(0n, 500, MAX)).toBe(0n);
  });

  it("grossing up lands the recipient on exactly the net amount or one unit over", () => {
    for (const net of [1n, 19n, 950n, 1_000_000n, 123_456_789n]) {
      const sent = grossUp(net, 500, MAX);
      const received = sent - transferFee(sent, 500, MAX);
      expect(received >= net).toBe(true);
      expect(received - net <= 1n).toBe(true);
    }
    expect(grossUp(950n, 500, MAX)).toBe(1000n);
  });

  it("stops grossing up once the fee hits its cap", () => {
    expect(grossUp(1_000_000n, 500, 100n)).toBe(1_000_100n);
  });

  it("chunks payouts into transactions and converts USD to base units", () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(usdToBaseUnits(1.5, 0.001, 6)).toBe(1_500_000_000n); // 1,500 tokens
    expect(usdToBaseUnits(0, 0.001, 6)).toBe(0n);
  });
});
