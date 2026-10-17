# AstraTrade AI

A Telegram-first market scanner and signal-research service, separate from all other projects.

## Safety and evidence rules
- Never fabricate prices, candles, signals, confidence, or test results.
- A displayed confidence is a calibrated estimate, not a promise. Report observed hit rate, sample size, confidence interval, payout-adjusted expectancy, and evaluation window separately.
- Reject stale, incomplete, out-of-order, or inconsistent candles. Fail closed with `NO TRADE`.
- Use chronological walk-forward evaluation, prevent look-ahead leakage, and reserve an untouched final holdout.
- Account for payout and break-even win rate before a candidate can pass a trade gate.
- No automatic broker execution, private-session scraping, or authentication bypass.
- Twelve Data prices are not assumed to match QxBroker/Quotex quotes, especially OTC. Broker-price parity must be independently established before broker-specific signals can be enabled.

## Current verified deployment status (2026-10-17)
- Cloudflare Worker `astratrade-ai` responds at `/health`.
- Telegram webhook registration returned `ok: true`; Telegram `/start` and the START callback were observed working.
- The START callback currently runs a live Twelve Data candle-quality audit for up to eight configured FX symbols. The user-observed run returned `DATA_OK` for all eight, followed by `NO TRADE` because model calibration and broker quote parity are not verified.
- Cloudflare has secret bindings for `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `TWELVE_DATA_API_KEY`; secret values must never be pasted into chat or committed.
- An ephemeral webhook-registration route was removed after successful registration.
- `liveSignalsEnabled` intentionally remains false. Do not enable live signal output solely because candles pass quality checks.

## Research backtest
`src/backtest.ts` contains a conservative, deterministic technical-rule walk-forward baseline. It is for offline research only, not a probability-calibrated model or a claim of 70% accuracy. It reports hit rate, sample size, payout-adjusted expectancy, and loss streaks, and explicitly lists limitations. Tests cover chronology and insufficient sample handling.

## Acceptance gates before enabling signals
1. Typecheck and all automated tests pass in CI.
2. Run the baseline on sufficient historical candles for each intended market/timeframe; document data source, period, sample size, hit rate, confidence interval, payout, expectancy, and drawdown.
3. Select parameters only on a training period; evaluate on a separate chronological validation period; retain an untouched final holdout.
4. Test realistic payout and expiry assumptions, ties/refunds, data gaps, and execution delays.
5. Obtain a legitimate broker-compatible quote feed or manually collect permitted contemporaneous reference observations; never assume OTC parity.
6. Run a timestamped shadow-signal log against the actual intended instrument, mature every outcome, and report hit rate with uncertainty. Disable on data-quality or regime degradation.
7. Only then consider any real-money use, with explicit user control and no automatic execution.

## Local development
1. Install Node.js 22+ and pnpm.
2. Run `pnpm install`.
3. Copy `.dev.vars.example` to `.dev.vars` and provide secrets locally. Never commit tokens or API keys.
4. Run `pnpm typecheck` and `pnpm test`.
5. Deploy only after provider, Telegram webhook, and end-to-end tests pass.
