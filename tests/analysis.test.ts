import {describe,expect,it} from "vitest";
import {breakEvenProbability,gateCandidate,wilsonInterval} from "../src/analysis";
const candidate={symbol:"EUR/USD",timeframe:"1m",direction:"UP" as const,probability:0.75,reasons:["unit test"]};
describe("signal gate and confidence statistics",()=>{
 it("computes payout break-even probability",()=>expect(breakEvenProbability(0.8)).toBeCloseTo(0.555555,5));
 it("blocks bad data",()=>expect(gateCandidate(candidate,0.8,false,true).allowed).toBe(false));
 it("blocks unstable regime",()=>expect(gateCandidate(candidate,0.8,true,false).allowed).toBe(false));
 it("blocks low confidence",()=>expect(gateCandidate({...candidate,probability:0.62},0.8,true,true).allowed).toBe(false));
 it("allows a candidate passing all configured gates",()=>expect(gateCandidate(candidate,0.8,true,true).allowed).toBe(true));
 it("reports uncertainty around observed win rate",()=>{const ci=wilsonInterval(70,100);expect(ci.low).toBeLessThan(0.7);expect(ci.high).toBeGreaterThan(0.7);});
});