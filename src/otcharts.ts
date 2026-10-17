import type { Candle } from "./quality";

export interface OTCSymbol {
  symbol: string;
  name?: string;
  open?: boolean | null;
  payout?: number | null;
  isOtc?: boolean;
}
export interface OTCCandleResult {
  symbol: string;
  candles: Candle[];
  interval?: string;
  gaps?: { runs?: number; missingBars?: number };
  open?: boolean;
}
export interface OTCUsage {
  plan?: string;
  planName?: string;
  books?: string[];
  requests?: { used?: number; quota?: number; remaining?: number; per?: string; resets?: number };
}
async function getJson<T>(url: string, key: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Authorization: "Bearer " + key, Accept: "application/json", "User-Agent": "AstraTrade-AI/0.1" }
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "upstream request failed";
    throw new Error("OTCharts HTTP " + response.status + ": " + detail);
  }
  return body as T;
}
const API = "https://otcharts.com";
export async function fetchOTCUsage(key: string, fetchImpl: typeof fetch = fetch): Promise<OTCUsage> {
  return getJson<OTCUsage>(API + "/v1/usage", key, fetchImpl);
}
export async function fetchOTCVenues(key: string, fetchImpl: typeof fetch = fetch): Promise<{venues:Array<{id:string;open:boolean;timeframes?:number[]}>}> {
  return getJson(API + "/v1/venues", key, fetchImpl);
}
export async function fetchOTCSymbols(key: string, venue = "quotex", fetchImpl: typeof fetch = fetch): Promise<OTCSymbol[]> {
  const url = new URL(API + "/v1/symbols");
  url.searchParams.set("venue", venue);
  const body = await getJson<{symbols?:OTCSymbol[]}>(url.toString(), key, fetchImpl);
  return Array.isArray(body.symbols) ? body.symbols : [];
}
export async function fetchOTCCandles(symbol: string, timeframeSeconds: number, key: string, limit = 80, fetchImpl: typeof fetch = fetch): Promise<OTCCandleResult> {
  const url = new URL(API + "/v1/candles");
  url.searchParams.set("venue", "quotex");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("tf", String(timeframeSeconds));
  url.searchParams.set("limit", String(limit));
  const body = await getJson<{symbol?:string;candles?:Array<{time?:number;open?:number;high?:number;low?:number;close?:number;volume?:number}>;gaps?:{runs?:number;missingBars?:number};open?:boolean}>(url.toString(), key, fetchImpl);
  const candles: Candle[] = (Array.isArray(body.candles) ? body.candles : []).map(c => ({
    timestamp: Number(c.time) * 1000,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    ...(c.volume !== undefined ? {volume:Number(c.volume)} : {})
  })).sort((a,b)=>a.timestamp-b.timestamp);
  return {symbol:body.symbol ?? symbol,candles,gaps:body.gaps,open:body.open};
}
