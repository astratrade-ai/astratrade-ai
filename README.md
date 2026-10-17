# AstraTrade AI

A Telegram-first market scanner and signal research service, separate from all other projects.

## Non-negotiable principles
- Never fabricate prices, candles, signals, confidence, or test results.
- A displayed 70% confidence is a calibrated estimate, not a promise. Report observed hit rate, sample size, confidence interval, and evaluation window separately.
- Reject stale, out-of-order, incomplete, or inconsistent candles. Fail closed with NO TRADE.
- Detect degradation in recent outcomes and market features; warn and suspend signals when validation degrades.
- Use chronological walk-forward evaluation, prevent look-ahead leakage, and preserve a final untouched holdout.
- Account for payout and break-even win rate before a candidate can pass the trade gate.
- No automatic broker execution. No private-session scraping or authentication bypass.
- Third-party prices are not assumed to match QxBroker/Quotex OTC quotes. Broker compatibility must be separately verified before OTC signals are enabled.

## Current stage
Initial architecture and deterministic quality gates. Live market coverage, broker quote equivalence, calibrated 70% claims, and production Telegram delivery are NOT verified yet.

## Setup
1. Install Node.js 22+ and pnpm.
2. Run `pnpm install`.
3. Copy `.dev.vars.example` to `.dev.vars` and provide secrets locally. Never commit tokens or API keys.
4. Run `pnpm test` and `pnpm typecheck`.
5. Deploy only after provider, Telegram webhook, and end-to-end tests pass.

See `docs/VALIDATION.md` for acceptance criteria.
