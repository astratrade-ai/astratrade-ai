import { describe, expect, it, vi } from "vitest";
import { fetchOTCUsage, fetchOTCVenues, fetchOTCSymbols, fetchOTCCandles } from "./otcharts";

function response(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}
describe("OTCharts provider failures fail closed", () => {
  it.each([401, 402, 403, 429, 502])("preserves HTTP %i for diagnostics", async status => {
    const f = response(status, { error: "test failure" });
    await expect(fetchOTCUsage("test-key", f)).rejects.toThrow("OTCharts HTTP " + status);
  });
  it("does not treat malformed candle JSON as usable candle data", async () => {
    const f = response(200, { symbol: "EURUSD_otc", candles: [{time:"bad",open:1,high:1,low:1,close:1}] });
    const data = await fetchOTCCandles("EURUSD_otc", 60, "test-key", 80, f);
    expect(data.candles[0].timestamp).toBeNaN();
  });
  it("returns empty catalogue rather than inventing instruments", async () => {
    const f = response(200, { symbols: null });
    await expect(fetchOTCSymbols("test-key", "quotex", f)).resolves.toEqual([]);
  });
  it("can mock usage, venues and candles independently", async () => {
    const usage = response(200, { requests: { remaining: 0 } });
    const venues = response(403, { error: "book denied" });
    await expect(fetchOTCUsage("test-key", usage)).resolves.toMatchObject({ requests: { remaining: 0 } });
    await expect(fetchOTCVenues("test-key", venues)).rejects.toThrow("HTTP 403");
  });
});
