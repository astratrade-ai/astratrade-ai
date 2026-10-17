import { inspectCandles } from "./quality";
import { fetchTwelveDataCandles } from "./provider";
import type { Candle } from "./quality";
import { gateCandidate, simpleFeatures, type SignalCandidate } from "./analysis";
import { initialRegimeState, updateRegime } from "./regime";
interface Env { TELEGRAM_BOT_TOKEN?:string; TELEGRAM_WEBHOOK_SECRET?:string; TWELVE_DATA_API_KEY?:string; TWELVE_DATA_SYMBOLS?:string; FINNHUB_API_KEY?:string; APP_ENV?:string; }
interface TelegramUpdate { message?:{chat:{id:number};text?:string}; callback_query?:{id:string;data?:string;message?:{chat:{id:number}}}; }
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
async function telegram(env:Env,method:string,payload:Record<string,unknown>):Promise<void>{
  if(!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram bot token not configured");
  const r=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  if(!r.ok) throw new Error("Telegram API returned HTTP "+r.status);
}
async function start(env:Env,chatId:number):Promise<void>{
  await telegram(env,"sendMessage",{chat_id:chatId,text:"AstraTrade AI\nSignals are estimates, not guarantees. QxBroker OTC quote parity is not verified yet.",reply_markup:{inline_keyboard:[[{text:"START",callback_data:"START_SCAN"}]]}});
}
async function scan(env:Env,chatId:number):Promise<void>{
  const apiKey=env.TWELVE_DATA_API_KEY;
  if(!apiKey){
    await telegram(env,"sendMessage",{chat_id:chatId,text:"SCAN STATUS: NO TRADE\nNo market-data provider is configured. No signal fabricated."});
    return;
  }
  const symbols=(env.TWELVE_DATA_SYMBOLS??"EUR/USD,GBP/USD,USD/JPY,USD/CHF,AUD/USD,USD/CAD,NZD/USD,EUR/JPY")
    .split(",").map(s=>s.trim()).filter(Boolean);
  const results:Array<{symbol:string;status:string;issues:string[]}>=[];
  // Sequential calls respect the typical per-minute credit limit better than parallel bursts.
  for(const symbol of symbols.slice(0,40)){
    try{
      const result=await fetchTwelveDataCandles(symbol,"1min",apiKey,100);
      const report=inspectCandles(result.candles,60_000,result.receivedAt,180_000);
      results.push({symbol,status:report.ok?"DATA_OK":"DATA_REJECTED",issues:report.issues.map(i=>i.code)});
    }catch{
      results.push({symbol,status:"PROVIDER_ERROR",issues:["PROVIDER_ERROR"]});
    }
  }
  const ok=results.filter(r=>r.status==="DATA_OK").length;
  const failed=results.length-ok;
  const lines=results.map(r=>r.symbol+": "+r.status+(r.issues.length?" ("+r.issues.join(", ")+")":""));
  const message=[
    "SCAN STATUS: NO TRADE",
    "Data audit only; a validated/calibrated prediction model and QxBroker quote parity are not enabled.",
    "Markets checked: "+results.length+" | quality passed: "+ok+" | rejected/error: "+failed,
    ...lines,
    "No trading signal is issued until calibration, payout, and broker-specific price validation pass."
  ].join("\n");
  await telegram(env,"sendMessage",{chat_id:chatId,text:message.slice(0,3900)});
}
export default{
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/health") return json({ok:true,service:"astratrade-ai",environment:env.APP_ENV??"unset",liveSignalsEnabled:false,reason:"Calibration and QxBroker quote parity validation pending"});
    if(request.method!=="POST"||url.pathname!=="/telegram/webhook") return json({error:"Not found"},404);
    if(!env.TELEGRAM_WEBHOOK_SECRET||request.headers.get("X-Telegram-Bot-Api-Secret-Token")!==env.TELEGRAM_WEBHOOK_SECRET) return json({error:"Unauthorized"},401);
    let update:TelegramUpdate; try{update=await request.json() as TelegramUpdate;}catch{return json({error:"Invalid JSON"},400);}
    try{
      if(update.message?.chat?.id&&update.message.text?.trim().toLowerCase()==="/start") await start(env,update.message.chat.id);
      const cb=update.callback_query;
      if(cb?.id&&cb.data==="START_SCAN"&&cb.message?.chat?.id){
        await telegram(env,"answerCallbackQuery",{callback_query_id:cb.id,text:"Checking configured market data",show_alert:false});
        await scan(env,cb.message.chat.id);
      }
      return json({ok:true});
    }catch{return json({error:"Upstream request failed"},502);}
  }
};
export {inspectCandles,gateCandidate,simpleFeatures,initialRegimeState,updateRegime};
export type {Candle,SignalCandidate};
