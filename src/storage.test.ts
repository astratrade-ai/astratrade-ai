import { describe, expect, it, vi } from "vitest";
import { getOutcomeSummary, recordSignal, resolveSignal, type D1DatabaseLike, type D1Statement } from "./storage";

function mockDb(opts: { changes?: number; summary?: unknown; fail?: boolean } = {}) {
  const calls: Array<{sql:string;values:unknown[]}> = [];
  const db: D1DatabaseLike = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const stmt: D1Statement = {
        bind(...v) { values = v; return stmt; },
        async run() {
          calls.push({sql,values});
          if (opts.fail) return {success:false};
          return {success:true,meta:{changes:opts.changes ?? 1}};
        },
        async first<T>() { calls.push({sql,values}); return (opts.summary ?? null) as T | null; },
        async all<T>() { calls.push({sql,values}); return {success:true,results:[] as T[]}; }
      };
      return stmt;
    },
    async batch() { return []; }
  };
  return {db,calls};
}
describe("signal outcome storage primitives", () => {
  it("persists a signal and a CREATED event", async () => {
    const {db,calls}=mockDb();
    await recordSignal(db,{id:"sig-1",createdAt:"2026-10-17T12:00:00.000Z",symbol:"EURUSD_otc",direction:"UP",timeframeSeconds:60,entryCandleTime:1792238400000,strategyVersion:"test-v1"});
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("INSERT INTO signals");
    expect(calls[1].sql).toContain("INSERT INTO signal_events");
  });
  it("rejects invalid signal input", async () => {
    const {db}=mockDb();
    await expect(recordSignal(db,{id:"",createdAt:"",symbol:"",direction:"UP",timeframeSeconds:60,entryCandleTime:0,strategyVersion:"x"})).rejects.toThrow("Invalid signal");
  });
  it("resolves only a pending signal once", async () => {
    const {db,calls}=mockDb({changes:0});
    await expect(resolveSignal(db,"sig-1","WIN",1.2,"test-price")).resolves.toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("status='PENDING'");
  });
  it("returns persisted summary", async () => {
    const summary={resolved_total:10,wins:6,losses:4,voids:0,win_rate_percent:60};
    const {db}=mockDb({summary});
    await expect(getOutcomeSummary(db)).resolves.toEqual(summary);
  });
  it("returns empty summary when there are no records", async () => {
    const {db}=mockDb();
    await expect(getOutcomeSummary(db)).resolves.toEqual({resolved_total:0,wins:0,losses:0,voids:0,win_rate_percent:null});
  });
});
