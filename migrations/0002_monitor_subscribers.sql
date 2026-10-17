-- Persist Telegram chats that explicitly opt in to autonomous scans.
CREATE TABLE IF NOT EXISTS monitor_subscribers (
  chat_id TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  last_scan_at TEXT,
  last_signal_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_monitor_active ON monitor_subscribers(active);
