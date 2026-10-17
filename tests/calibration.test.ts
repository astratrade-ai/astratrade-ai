import { describe, expect, it } from "vitest";
import { estimateProbability, formatSignalMessage } from "../src/calibration";
import type { OutcomeSample } from "../src/calibration";

function samples(n: number, wins: number, bucket = "EUR/USD|M15|UP"): OutcomeSample[] {
  return Array.from({ length: n }, (_, i) => ({
    bucket, won: i < wins, outOfSample: true, signalId: "sig-" + i
  }));
}
describe("probability calibration", () => {
  it("does not invent a percentage for a small sample", () => {
    const result = estimateProbability(samples(25, 20), "EUR/USD|M15|UP", 100);
    expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.probability).toBeNull();
  });
  it("reports empirical rate and uncertainty from matured out-of-sample outcomes", () => {
    const result = estimateProbability(samples(100, 70), "EUR/USD|M15|UP", 100);
    expect(result.status).toBe("CALIBRATED_ESTIMATE");
    expect(result.probability).toBeCloseTo(0.7);
    expect(result.interval95?.low).toBeLessThan(0.7);
    expect(result.interval95?.high).toBeGreaterThan(0.7);
    expect(result.conservativeProbability).toBe(result.interval95?.low);
  });
  it("ignores training/in-sample outcomes", () => {
    const data = samples(100, 100).map(s => ({ ...s, outOfSample: false }));
    expect(estimateProbability(data, "EUR/USD|M15|UP", 100).status).toBe("INSUFFICIENT_EVIDENCE");
  });
  it("rejects duplicate outcomes and blocks uncalibrated signal messages", () => {
    const dup = samples(100, 70);
    dup[1] = { ...dup[1], signalId: dup[0].signalId };
    expect(() => estimateProbability(dup, "EUR/USD|M15|UP", 100)).toThrow(/Duplicate/);
    const estimate = estimateProbability([], "x", 1);
    expect(() => formatSignalMessage({
      symbol:"EUR/USD", timeframe:"M15", direction:"UP", expiry:"15 min",
      entryReference:1.1, payoutRate:0.8, estimate, reasons:["momentum"]
    })).toThrow(/without sufficient/);
  });
});
