-- AstraTrade AI signal/outcome ledger. Apply with Wrangler D1 migrations or Cloudflare D1 query.
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('UP','DOWN')),
  timeframe_seconds INTEGER NOT NULL CHECK(timeframe_seconds IN (30,60,300)),
  entry_price REAL,
  entry_candle_time INTEGER NOT NULL,
  strategy_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','WIN','LOSS','VOID')),
  resolved_at TEXT,
  exit_price REAL,
  outcome_source TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_signals_pending ON signals(status, entry_candle_time);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);
CREATE TABLE IF NOT EXISTS signal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id TEXT NOT NULL REFERENCES signals(id),
  event_at TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('CREATED','RESOLVED','CORRECTED','VOIDED')),
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_signal_events_signal ON signal_events(signal_id, event_at);
CREATE VIEW IF NOT EXISTS signal_outcome_summary AS
SELECT COUNT(*) AS resolved_total,
       SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN status='LOSS' THEN 1 ELSE 0 END) AS losses,
       SUM(CASE WHEN status='VOID' THEN 1 ELSE 0 END) AS voids,
       ROUND(100.0 * SUM(CASE WHEN status='WIN' THEN 1 ELSE 0 END) /
         NULLIF(SUM(CASE WHEN status IN ('WIN','LOSS') THEN 1 ELSE 0 END),0), 2) AS win_rate_percent
FROM signals WHERE status IN ('WIN','LOSS','VOID');
