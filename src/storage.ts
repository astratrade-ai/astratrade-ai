export type SignalDirection = "UP" | "DOWN";
export type SignalStatus = "PENDING" | "WIN" | "LOSS" | "VOID";
export interface SignalRecord {
  id: string;
  createdAt: string;
  symbol: string;
  direction: SignalDirection;
  timeframeSeconds: 30 | 60 | 300;
  entryPrice?: number | null;
  entryCandleTime: number;
  strategyVersion: string;
}
export interface OutcomeSummary {
  resolved_total: number;
  wins: number;
  losses: number;
  voids: number;
  win_rate_percent: number | null;
}
export interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  run<T = unknown>(): Promise<{ success: boolean; results?: T[]; meta?: { changes?: number } }>;
  first<T = unknown>(): Promise<T | null>;
}
export interface D1DatabaseLike {
  prepare(query: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<Array<{ success: boolean; results?: T[] }>>;
}
export async function recordSignal(db: D1DatabaseLike, signal: SignalRecord): Promise<void> {
  if (!signal.id || !signal.symbol || !Number.isFinite(signal.entryCandleTime)) throw new Error("Invalid signal record");
  const now = new Date().toISOString();
  const details = JSON.stringify({symbol:signal.symbol,direction:signal.direction,timeframeSeconds:signal.timeframeSeconds,strategyVersion:signal.strategyVersion});
  const result = await db.prepare(
    "INSERT INTO signals (id,created_at,symbol,direction,timeframe_seconds,entry_price,entry_candle_time,strategy_version,status) VALUES (?,?,?,?,?,?,?,?, 'PENDING')"
  ).bind(signal.id,signal.createdAt,signal.symbol,signal.direction,signal.timeframeSeconds,signal.entryPrice ?? null,signal.entryCandleTime,signal.strategyVersion).run();
  if (!result.success) throw new Error("Could not persist signal");
  const event = await db.prepare("INSERT INTO signal_events (signal_id,event_at,event_type,details_json) VALUES (?,?,?,?)")
    .bind(signal.id,now,"CREATED",details).run();
  if (!event.success) throw new Error("Could not persist signal event");
}
export async function resolveSignal(db: D1DatabaseLike, id: string, status: Exclude<SignalStatus,"PENDING">, exitPrice: number, source: string): Promise<boolean> {
  if (!id || !Number.isFinite(exitPrice) || !source.trim()) throw new Error("Invalid outcome");
  const now = new Date().toISOString();
  const update = await db.prepare("UPDATE signals SET status=?,resolved_at=?,exit_price=?,outcome_source=? WHERE id=? AND status='PENDING'")
    .bind(status,now,exitPrice,source,id).run();
  const changes = update.meta?.changes ?? 0;
  if (!update.success) throw new Error("Could not resolve signal");
  if (changes === 0) return false;
  const event = await db.prepare("INSERT INTO signal_events (signal_id,event_at,event_type,details_json) VALUES (?,?,?,?)")
    .bind(id,now,status === "VOID" ? "VOIDED" : "RESOLVED",JSON.stringify({status,exitPrice,source})).run();
  if (!event.success) throw new Error("Could not persist outcome event");
  return true;
}
export async function getOutcomeSummary(db: D1DatabaseLike): Promise<OutcomeSummary> {
  const row = await db.prepare("SELECT resolved_total,wins,losses,voids,win_rate_percent FROM signal_outcome_summary").first<OutcomeSummary>();
  return row ?? {resolved_total:0,wins:0,losses:0,voids:0,win_rate_percent:null};
}
