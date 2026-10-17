import {describe,expect,it} from "vitest";
import {inspectCandles} from "../src/quality";
const c=(timestamp:number,open=1,high=1.2,low=0.9,close=1.1)=>({timestamp,open,high,low,close});
describe("inspectCandles",()=>{
 it("accepts sorted fresh candles",()=>expect(inspectCandles([c(1000),c(2000)],1000,2500,2000).ok).toBe(true));
 it("rejects timestamps not aligned to the interval",()=>expect(inspectCandles([c(1500)],1000,1600,5000).issues.some(x=>x.code==="MISALIGNED_TIMESTAMP")).toBe(true));
 it("rejects missing intervals",()=>expect(inspectCandles([c(1000),c(4000)],1000,4500,5000).issues.some(x=>x.code==="GAP")).toBe(true));
 it("rejects duplicates",()=>expect(inspectCandles([c(1000),c(1000)],1000,1500,5000).issues.some(x=>x.code==="DUPLICATE")).toBe(true));
 it("rejects out-of-order candles",()=>expect(inspectCandles([c(2000),c(1000)],1000,2500,5000).issues.some(x=>x.code==="OUT_OF_ORDER")).toBe(true));
 it("rejects impossible OHLC and nonpositive prices",()=>{const r=inspectCandles([c(1000,2,1,3,-1)],1000,1500,5000);expect(r.ok).toBe(false);expect(r.issues.some(x=>x.code==="INVALID_OHLC")).toBe(true);expect(r.issues.some(x=>x.code==="INVALID_PRICE")).toBe(true);});
 it("rejects stale candles",()=>expect(inspectCandles([c(1000)],1000,10000,1000).issues.some(x=>x.code==="STALE")).toBe(true));
 it("rejects empty provider responses",()=>expect(inspectCandles([],1000,1000,1000).ok).toBe(false));
});