import type { Candle } from "./quality";
export type Direction = "UP"|"DOWN";
export interface SignalCandidate { symbol:string; timeframe:string; direction:Direction; probability:number; reasons:string[]; }
export interface GateResult { allowed:boolean; reason:string; breakEvenProbability:number; }
export function breakEvenProbability(payoutRate:number):number {
  if (!Number.isFinite(payoutRate)||payoutRate<=0) throw new Error("payoutRate must be > 0");
  return 1/(1+payoutRate);
}
export function gateCandidate(c:SignalCandidate,payoutRate:number,dataQualityOk:boolean,regimeStable:boolean,minProbability=0.70,margin=0.03):GateResult {
  const be=breakEvenProbability(payoutRate);
  if (!dataQualityOk) return {allowed:false,reason:"NO TRADE: data quality failed",breakEvenProbability:be};
  if (!regimeStable) return {allowed:false,reason:"NO TRADE: regime change needs review",breakEvenProbability:be};
  if (!Number.isFinite(c.probability)||c.probability<0||c.probability>1) return {allowed:false,reason:"NO TRADE: invalid probability estimate",breakEvenProbability:be};
  if (c.probability<minProbability) return {allowed:false,reason:"NO TRADE: confidence below threshold",breakEvenProbability:be};
  if (c.probability<be+margin) return {allowed:false,reason:"NO TRADE: edge below payout-adjusted margin",breakEvenProbability:be};
  return {allowed:true,reason:"Passed configured gates; profitability is not guaranteed",breakEvenProbability:be};
}
export function simpleFeatures(candles:Candle[]):{momentum:number;volatility:number;emaFast:number;emaSlow:number}|null {
  if (candles.length<30) return null;
  const closes=candles.map(c=>c.close);
  if (closes.some(p=>!Number.isFinite(p)||p<=0)) return null;
  const ema=(values:number[],period:number)=>{const a=2/(period+1);return values.slice(1).reduce((prev,v)=>a*v+(1-a)*prev,values[0]);};
  const last=closes[closes.length-1];
  const returns=closes.slice(1).map((v,i)=>Math.log(v/closes[i]));
  const mean=returns.reduce((a,b)=>a+b,0)/returns.length;
  const volatility=Math.sqrt(returns.reduce((s,r)=>s+(r-mean)**2,0)/returns.length);
  return {momentum:last/closes[closes.length-6]-1,volatility,emaFast:ema(closes.slice(-12),5),emaSlow:ema(closes.slice(-26),12)};
}
export function wilsonInterval(wins:number,total:number,z=1.96):{low:number;high:number} {
  if (!Number.isInteger(wins)||!Number.isInteger(total)||total<=0||wins<0||wins>total) throw new Error("Invalid win/total counts");
  const p=wins/total,z2=z*z,den=1+z2/total,center=(p+z2/(2*total))/den;
  const radius=z*Math.sqrt((p*(1-p)+z2/(4*total))/total)/den;
  return {low:Math.max(0,center-radius),high:Math.min(1,center+radius)};
}
