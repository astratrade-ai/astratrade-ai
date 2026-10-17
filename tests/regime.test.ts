import {describe,expect,it} from "vitest";
import {initialRegimeState,updateRegime} from "../src/regime";
describe("regime monitor",()=>{
 it("does not alert before warmup",()=>{let s=initialRegimeState();for(let i=0;i<10;i++)s=updateRegime(s,1,0.01,0.1,30);expect(s.degraded).toBe(false);});
 it("rejects invalid losses",()=>expect(()=>updateRegime(initialRegimeState(),2)).toThrow());
 it("flags a sustained degradation after warmup",()=>{let s=initialRegimeState();for(let i=0;i<50;i++)s=updateRegime(s,1,0,0.1,1);expect(s.degraded).toBe(true);});
});