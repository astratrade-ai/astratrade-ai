export interface RegimeState { count:number; meanLoss:number; cumulative:number; minimum:number; degraded:boolean; }
export function initialRegimeState():RegimeState { return {count:0,meanLoss:0,cumulative:0,minimum:0,degraded:false}; }
/** Page-Hinkley-style monitor over matured binary prediction losses (0 correct, 1 incorrect). Alert primitive, not proof. */
export function updateRegime(state:RegimeState,loss:number,delta=0.01,threshold=5,warmup=30):RegimeState {
  if (!Number.isFinite(loss)||loss<0||loss>1) throw new Error("loss must be within [0,1]");
  if (delta<0||threshold<=0||warmup<1) throw new Error("Invalid detector settings");
  const count=state.count+1,meanLoss=state.meanLoss+(loss-state.meanLoss)/count;
  const cumulative=state.cumulative+loss-state.meanLoss-delta,minimum=Math.min(state.minimum,cumulative);
  return {count,meanLoss,cumulative,minimum,degraded:state.degraded||(count>=warmup&&cumulative-minimum>threshold)};
}
