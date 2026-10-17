# Validation and release gates

## 70% confidence
- Confidence is an estimate, never a guarantee.
- Evaluate only predictions whose outcomes have fully matured.
- Record timestamp, market, timeframe, direction, estimated probability, model version, source, and eventual outcome.
- Report Brier score, log loss, calibration bins, observed win rate, sample size, and a Wilson confidence interval.
- Do not advertise 70% accuracy from a small sample. Require a pre-registered minimum sample and chronological out-of-sample evaluation.
- Never tune thresholds on the final holdout set.

## Data-quality gates
- Validate timestamps are parseable, ordered, and aligned to expected candle intervals.
- Detect missing intervals, duplicates, out-of-order bars, invalid OHLC, non-positive prices, stale candles, and provider errors.
- Record source time and receive time separately where available.
- Fail closed: degraded data means NO TRADE; never silently fill gaps or invent data.
- REST candle-close delays may make a feed unsuitable for 1-minute decisions.

## Regime-change detection
- Track rolling matured prediction outcomes and market feature distributions by asset/timeframe.
- Use a sequential change detector with explicit warm-up and alert thresholds.
- A trigger means degraded/needs-review, not proof of a regime change. Suppress signals pending walk-forward revalidation.

## Release gates
1. Unit tests pass for quality gates, probability calibration helpers, payout math, and regime alerts.
2. Provider timestamps and current market data are independently verified.
3. Walk-forward tests include realistic payout, expiry rules, and provider limitations.
4. Broker quote parity is verified before QxBroker OTC symbols are enabled.
5. Telegram START flow is tested end-to-end and webhook secret validation is active.
6. Live mode stays disabled until all gates pass.
