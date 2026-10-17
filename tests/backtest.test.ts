import { describe, expect, it } from "vitest";
import { walkForwardBacktest } from "../src/backtest";
import type { Candle } from "../src/quality";

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 1 + i * 0.0001 + Math.sin(i / 4) * 0.0003;
    const open = i === 0 ? close : 1 + (i - 1) * 0.0001 + Math.sin((i - 1) / 4) * 0.0003;
    return { timestamp: 1_700_000_000_000 + i * 60_000, open, close, high: Math.max(open, close) + 0.0001, low: Math.min(open, close) - 0.0001 };
  });
}
const config = { horizonBars: 3, warmupBars: 40, minimumAgreement: 2 as const, minimumSamples: 5, payoutRate: 0.8 };

describe("walkForwardBacktest", () => {
  it("uses only valid chronological candles and returns an honest research report", () => {
    const report = walkForwardBacktest(candles(200), config);
    expect(report.candles).toBe(200);
    expect(report.status).toBe("RESEARCH_ONLY");
    expect(report.trades).toBeGreaterThan(0);
    expect(report.hitRate).toBeGreaterThanOrEqual(0);
    expect(report.hitRate).toBeLessThanOrEqual(1);
    expect(report.limitations.length).toBeGreaterThan(0);
  });
  it("fails closed on out-of-order candles", () => {
    const data = candles(100);
    [data[50], data[51]] = [data[51], data[50]];
    expect(() => walkForwardBacktest(data, config)).toThrow(/chronological/);
  });
  it("reports insufficient samples rather than claiming validation", () => {
    const report = walkForwardBacktest(candles(50), { ...config, minimumSamples: 1000 });
    expect(report.status).toBe("INSUFFICIENT_DATA");
  });
});
