import type { Candle } from "./quality";

export interface BacktestConfig {
  horizonBars: number;
  warmupBars: number;
  minimumAgreement: number;
  minimumSamples: number;
  payoutRate: number;
}
export interface BacktestTrade {
  signalTimestamp: number;
  expiryTimestamp: number;
  direction: "UP" | "DOWN";
  entry: number;
  exit: number;
  won: boolean;
  score: number;
}
export interface BacktestReport {
  status: "INSUFFICIENT_DATA" | "RESEARCH_ONLY";
  candles: number;
  trades: number;
  wins: number;
  losses: number;
  hitRate: number | null;
  breakEvenRate: number;
  expectancyPerUnitStake: number | null;
  maxLossStreak: number;
  tradesDetail: BacktestTrade[];
  limitations: string[];
}

const ema = (xs: number[], period: number): number => {
  const alpha = 2 / (period + 1);
  let value = xs[0] ?? 0;
  for (let i = 1; i < xs.length; i++) value = alpha * xs[i] + (1 - alpha) * value;
  return value;
};
const rsi = (xs: number[], period = 14): number | null => {
  if (xs.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = xs.length - period; i < xs.length; i++) {
    const delta = xs[i] - xs[i - 1];
    if (delta > 0) gains += delta; else losses -= delta;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
};

/** A deliberately conservative research baseline. Never treats this backtest as a calibrated live signal. */
export function walkForwardBacktest(candles: Candle[], config: BacktestConfig): BacktestReport {
  if (!Number.isInteger(config.horizonBars) || config.horizonBars < 1 ||
      !Number.isInteger(config.warmupBars) || config.warmupBars < 40 ||
      !Number.isInteger(config.minimumAgreement) || config.minimumAgreement < 2 || config.minimumAgreement > 3 ||
      !Number.isInteger(config.minimumSamples) || config.minimumSamples < 1 ||
      !Number.isFinite(config.payoutRate) || config.payoutRate <= 0) {
    throw new Error("Invalid backtest configuration");
  }
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.timestamp,c.open,c.high,c.low,c.close].every(Number.isFinite) || c.timestamp <= 0 ||
      [c.open,c.high,c.low,c.close].some(p => p <= 0) ||
      c.high < Math.max(c.open,c.close,c.low) || c.low > Math.min(c.open,c.close,c.high) ||
      (i > 0 && c.timestamp <= candles[i-1].timestamp)) {
      throw new Error("Candles must be valid, positive, and strictly chronological");
    }
  }
  const trades: BacktestTrade[] = [];
  let lossStreak = 0, maxLossStreak = 0;
  const lastIndex = candles.length - config.horizonBars;
  for (let i = config.warmupBars; i < lastIndex; i++) {
    // Only candles through i are used to construct this decision.
    const history = candles.slice(0, i + 1);
    const closes = history.map(c => c.close);
    const fast = ema(closes.slice(-20), 8);
    const slow = ema(closes.slice(-40), 21);
    const momentum = closes[closes.length - 1] / closes[closes.length - 6] - 1;
    const r = rsi(closes);
    if (r === null) continue;
    const votes = [
      fast > slow ? 1 : fast < slow ? -1 : 0,
      momentum > 0 ? 1 : momentum < 0 ? -1 : 0,
      r >= 52 ? 1 : r <= 48 ? -1 : 0
    ];
    const up = votes.filter(v => v === 1).length;
    const down = votes.filter(v => v === -1).length;
    const direction = up >= config.minimumAgreement ? "UP" : down >= config.minimumAgreement ? "DOWN" : null;
    if (!direction) continue;
    const entry = candles[i].close;
    const exit = candles[i + config.horizonBars].close;
    if (exit === entry) continue; // flat outcomes are not counted as wins
    const won = direction === "UP" ? exit > entry : exit < entry;
    const trade: BacktestTrade = {
      signalTimestamp: candles[i].timestamp,
      expiryTimestamp: candles[i + config.horizonBars].timestamp,
      direction, entry, exit, won,
      score: Math.max(up, down) / 3
    };
    trades.push(trade);
    lossStreak = won ? 0 : lossStreak + 1;
    maxLossStreak = Math.max(maxLossStreak, lossStreak);
  }
  const wins = trades.filter(t => t.won).length;
  const losses = trades.length - wins;
  const hitRate = trades.length ? wins / trades.length : null;
  const breakEvenRate = 1 / (1 + config.payoutRate);
  return {
    status: trades.length >= config.minimumSamples ? "RESEARCH_ONLY" : "INSUFFICIENT_DATA",
    candles: candles.length, trades: trades.length, wins, losses, hitRate, breakEvenRate,
    expectancyPerUnitStake: hitRate === null ? null : hitRate * config.payoutRate - (1 - hitRate),
    maxLossStreak, tradesDetail: trades,
    limitations: [
      "Research baseline only; not a calibrated probability model.",
      "Third-party candles may not match QxBroker/Quotex OTC quotes.",
      "No spread, payout changes, latency, ties/refunds, or execution slippage are simulated.",
      "Overlapping expiry windows can make observations dependent.",
      "A separate untouched chronological holdout and live shadow sample are required before signal release."
    ]
  };
}
