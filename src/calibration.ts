import { wilsonInterval } from "./analysis";

export interface OutcomeSample {
  /** Unique setup bucket, e.g. symbol|timeframe|direction|regime|setupVersion */
  bucket: string;
  won: boolean;
  /** Must be true only for a matured, out-of-sample observation. */
  outOfSample: boolean;
  /** Stable signal ID prevents duplicate outcomes from being counted twice upstream. */
  signalId: string;
}
export interface ProbabilityEstimate {
  status: "CALIBRATED_ESTIMATE" | "INSUFFICIENT_EVIDENCE";
  bucket: string;
  wins: number;
  losses: number;
  samples: number;
  probability: number | null;
  interval95: { low: number; high: number } | null;
  /** Conservative one-sided proxy: lower end of the two-sided 95% Wilson interval. */
  conservativeProbability: number | null;
  note: string;
}

/**
 * Estimates a setup-specific historical hit rate from matured out-of-sample results.
 * It does not manufacture a probability from indicator scores. The caller must
 * supply deduplicated, correctly matured outcomes from a chronological evaluation.
 */
export function estimateProbability(
  samples: OutcomeSample[],
  bucket: string,
  minimumSamples = 100
): ProbabilityEstimate {
  if (!bucket.trim()) throw new Error("bucket is required");
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1) throw new Error("minimumSamples must be positive");
  const eligible = samples.filter(s => s.bucket === bucket && s.outOfSample && s.signalId.trim());
  const seen = new Set<string>();
  for (const s of eligible) {
    if (seen.has(s.signalId)) throw new Error("Duplicate signalId in calibration samples");
    seen.add(s.signalId);
  }
  const wins = eligible.filter(s => s.won).length;
  const losses = eligible.length - wins;
  const n = eligible.length;
  if (n < minimumSamples) {
    return {
      status: "INSUFFICIENT_EVIDENCE", bucket, wins, losses, samples: n,
      probability: null, interval95: null, conservativeProbability: null,
      note: "Not enough matured out-of-sample outcomes; do not display a win-probability percentage."
    };
  }
  const probability = wins / n;
  const interval95 = wilsonInterval(wins, n);
  return {
    status: "CALIBRATED_ESTIMATE", bucket, wins, losses, samples: n,
    probability, interval95, conservativeProbability: interval95.low,
    note: "Historical out-of-sample hit rate, not a guarantee; use the interval and current-regime checks."
  };
}

export interface SignalMessageInput {
  symbol: string;
  timeframe: string;
  direction: "UP" | "DOWN";
  expiry: string;
  entryReference: number;
  payoutRate: number | null;
  estimate: ProbabilityEstimate;
  reasons: string[];
}
export function formatSignalMessage(s: SignalMessageInput): string {
  if (s.estimate.status !== "CALIBRATED_ESTIMATE" || s.estimate.probability === null ||
      s.estimate.interval95 === null || s.estimate.conservativeProbability === null) {
    throw new Error("Cannot publish a signal without sufficient calibrated evidence");
  }
  const pct = (x: number) => (x * 100).toFixed(1) + "%";
  const payout = s.payoutRate === null ? "unknown" : pct(s.payoutRate);
  return [
    "AstraTrade AI — RESEARCH-VALIDATED SIGNAL",
    "Market: " + s.symbol,
    "Timeframe: " + s.timeframe,
    "Direction: " + s.direction,
    "Expiry: " + s.expiry,
    "Entry reference: " + s.entryReference,
    "Estimated historical hit rate: " + pct(s.estimate.probability),
    "95% uncertainty interval: " + pct(s.estimate.interval95.low) + "–" + pct(s.estimate.interval95.high),
    "Conservative estimate (interval lower bound): " + pct(s.estimate.conservativeProbability),
    "Matured out-of-sample signals: " + s.estimate.samples + " (wins " + s.estimate.wins + ", losses " + s.estimate.losses + ")",
    "Payout rate: " + payout,
    "Analysis: " + s.reasons.join("; "),
    "Important: historical estimate, not a guarantee. Check live quote parity and payout before acting."
  ].join("\n");
}
