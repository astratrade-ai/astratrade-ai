export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
export interface QualityIssue {
  code: "EMPTY"|"INVALID_TIMESTAMP"|"MISALIGNED_TIMESTAMP"|"OUT_OF_ORDER"|"DUPLICATE"|"GAP"|"INVALID_OHLC"|"INVALID_PRICE"|"STALE";
  detail: string;
}
export interface QualityReport {
  ok: boolean; issues: QualityIssue[]; candleCount: number;
  latestTimestamp: number|null; ageMs: number|null;
}
export function inspectCandles(candles: Candle[], intervalMs: number, nowMs: number, maxAgeMs: number): QualityReport {
  const issues: QualityIssue[] = [];
  if (!candles.length) {
    issues.push({code:"EMPTY",detail:"Provider returned no candles."});
    return {ok:false,issues,candleCount:0,latestTimestamp:null,ageMs:null};
  }
  if (!Number.isFinite(intervalMs)||intervalMs<=0||!Number.isFinite(nowMs)||maxAgeMs<0) throw new Error("Invalid quality-check configuration");
  let previous: Candle|undefined;
  for (const c of candles) {
    if (!Number.isFinite(c.timestamp)||c.timestamp<=0) { issues.push({code:"INVALID_TIMESTAMP",detail:"Invalid candle timestamp."}); continue; }
    if (Math.abs(c.timestamp % intervalMs) > 1000 && Math.abs(c.timestamp % intervalMs - intervalMs) > 1000) issues.push({code:"MISALIGNED_TIMESTAMP",detail:"Candle timestamp is not aligned to the expected interval."});
    if (![c.open,c.high,c.low,c.close].every(Number.isFinite)) { issues.push({code:"INVALID_PRICE",detail:"OHLC contains non-finite price."}); continue; }
    if ([c.open,c.high,c.low,c.close].some(p=>p<=0)) issues.push({code:"INVALID_PRICE",detail:"OHLC prices must be positive."});
    if (c.high<Math.max(c.open,c.close,c.low)||c.low>Math.min(c.open,c.close,c.high)) issues.push({code:"INVALID_OHLC",detail:"Impossible OHLC relationship."});
    if (previous) {
      const delta=c.timestamp-previous.timestamp;
      if (delta===0) issues.push({code:"DUPLICATE",detail:"Duplicate candle timestamp."});
      else if (delta<0) issues.push({code:"OUT_OF_ORDER",detail:"Candles are not sorted by time."});
      else if (delta>intervalMs*1.5) issues.push({code:"GAP",detail:"Missing candle interval(s); delta="+delta+"ms."});
    }
    previous=c;
  }
  const validTimes=candles.map(c=>c.timestamp).filter(Number.isFinite);
  const latestTimestamp=validTimes.length?Math.max(...validTimes):null;
  const ageMs=latestTimestamp===null?null:nowMs-latestTimestamp;
  if (ageMs===null||ageMs < -intervalMs) issues.push({code:"INVALID_TIMESTAMP",detail:"Latest candle timestamp is in the future."});
  else if (ageMs>maxAgeMs) issues.push({code:"STALE",detail:"Latest candle is stale; age="+ageMs+"ms."});
  return {ok:issues.length===0,issues,candleCount:candles.length,latestTimestamp,ageMs};
}
