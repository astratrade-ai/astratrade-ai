import { describe, expect, it } from "vitest";
import { fetchTwelveDataCandles } from "../src/provider";

describe("Twelve Data adapter", () => {
  it("maps candles and orders them chronologically", async () => {
    const mockFetch: typeof fetch = async () => new Response(JSON.stringify({
      status: "ok",
      meta: { symbol: "EUR/USD", interval: "1min" },
      values: [
        { datetime: "2026-10-17 10:01:00", open: "1.1", high: "1.2", low: "1.0", close: "1.15" },
        { datetime: "2026-10-17 10:00:00", open: "1.0", high: "1.2", low: "0.9", close: "1.1" }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
    const result = await fetchTwelveDataCandles("EUR/USD", "1min", "test-key", 30, mockFetch);
    expect(result.candles).toHaveLength(2);
    expect(result.candles[0].timestamp).toBeLessThan(result.candles[1].timestamp);
    expect(result.candles[0].close).toBe(1.1);
  });
  it("rejects empty credentials and invalid intervals", async () => {
    await expect(fetchTwelveDataCandles("EUR/USD", "1min", "")).rejects.toThrow("API key");
    await expect(fetchTwelveDataCandles("EUR/USD", "2min", "x")).rejects.toThrow("interval");
  });
  it("includes Twelve Data's structured HTTP 404 detail for diagnosis", async () => {
    const mockFetch: typeof fetch = async () => new Response(JSON.stringify({
      status: "error", code: 404, message: "Symbol not found: EUR/USD"
    }), { status: 404, headers: { "content-type": "application/json" } });
    await expect(fetchTwelveDataCandles("EUR/USD", "1min", "x", 30, mockFetch))
      .rejects.toThrow("Twelve Data HTTP 404: Symbol not found: EUR/USD");
  });
  it("rejects provider errors rather than inventing candles", async () => {
    const mockFetch: typeof fetch = async () => new Response(JSON.stringify({ status: "error", message: "API credits exhausted" }), { status: 200 });
    await expect(fetchTwelveDataCandles("EUR/USD", "1min", "x", 30, mockFetch)).rejects.toThrow("credits exhausted");
  });
});
