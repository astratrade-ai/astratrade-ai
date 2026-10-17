import type { Candle } from "./quality";

export interface ProviderResult {
  symbol: string;
  candles: Candle[];
  source: "twelvedata";
  receivedAt: number;
  sourceStatus: string;
}

interface TwelveDataResponse {
  status?: string;
  message?: string;
  code?: number;
  meta?: { symbol?: string; interval?: string; currency_base?: string; currency_quote?: string };
  values?: Array<{ datetime?: string; open?: string; high?: string; low?: string; close?: string; volume?: string }>;
}

/** Fetch candles from the authorized Twelve Data REST API. Never infer missing values. */
export async function fetchTwelveDataCandles(
  symbol: string,
  interval: string,
  apiKey: string,
  outputsize = 100,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderResult> {
  if (!apiKey.trim()) throw new Error("Twelve Data API key is missing");
  if (!symbol.trim()) throw new Error("Market symbol is required");
  if (!["1min", "5min", "15min", "30min", "1h", "4h", "1day"].includes(interval)) {
    throw new Error("Unsupported candle interval");
  }
  if (!Number.isInteger(outputsize) || outputsize < 30 || outputsize > 5000) {
    throw new Error("outputsize must be between 30 and 5000");
  }
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(outputsize));
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("apikey", apiKey);
  const response = await fetchImpl(url.toString(), { method: "GET", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Twelve Data HTTP " + response.status);
  const body = await response.json() as TwelveDataResponse;
  if (body.status === "error" || !Array.isArray(body.values)) {
    throw new Error("Twelve Data response rejected: " + String(body.message ?? body.code ?? "missing values"));
  }
  const candles: Candle[] = body.values.map((v) => {
    const timestamp = Date.parse(v.datetime ?? "");
    return {
      timestamp,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      ...(v.volume !== undefined ? { volume: Number(v.volume) } : {})
    };
  }).sort((a, b) => a.timestamp - b.timestamp);
  return {
    symbol: body.meta?.symbol ?? symbol,
    candles,
    source: "twelvedata",
    receivedAt: Date.now(),
    sourceStatus: body.status ?? "ok"
  };
}
