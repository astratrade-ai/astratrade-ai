import { inspectCandles, type Candle } from "./quality";
import { gateCandidate, simpleFeatures, type SignalCandidate } from "./analysis";
import { initialRegimeState, updateRegime } from "./regime";
interface Env { TELEGRAM_BOT_TOKEN?:string; TELEGRAM_WEBHOOK_SECRET?:string; TWELVE_DATA_API_KEY?:string; FINNHUB_API_KEY?:string; APP_ENV?:string; }
interface TelegramUpdate { message?:{chat:{id:number};text?:string}; callback_query?:{id:string;data?:string;message?:{chat:{id:number}}}; }
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
async function telegram(env:Env,method:string,payload:Record<string,unknown>):Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram bot token not configured");
  const r=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  if (!r.ok) throw new Error("Telegram API returned HTTP "+r.status);
}
async function start(env:Env,chatId:number):Promise<void> {
  await telegram(env,"sendMessage",{chat_id:chatId,text:"AstraTrade AI\nSignals are estimates, not guarantees. QxBroker OTC quote parity is not verified yet.",reply_markup:{inline_keyboard:[[{text:"START",callback_data:"START_SCAN"}]]}});
}
async function scan(env:Env,chatId:number):Promise<void> {
  const configured=Boolean(env.TWELVE_DATA_API_KEY||env.FINNHUB_API_KEY);
  const textMessage=configured
    ?"SCAN STATUS: NO TRADE\nProvider key exists, but symbol coverage, fresh candle quality, payout, calibration, and QxBroker quote parity have not passed verification. No signal fabricated."
    :"SCAN STATUS: NO TRADE\nNo market-data provider is configured. No signal fabricated.";
  await telegram(env,"sendMessage",{chat_id:chatId,text:textMessage});
}
export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/health") return json({ok:true,service:"astratrade-ai",environment:env.APP_ENV??"unset",liveSignalsEnabled:false,reason:"Provider and broker parity validation pending"});
    if(request.method!=="POST"||url.pathname!=="/telegram/webhook") return json({error:"Not found"},404);
    if(!env.TELEGRAM_WEBHOOK_SECRET||request.headers.get("X-Telegram-Bot-Api-Secret-Token")!==env.TELEGRAM_WEBHOOK_SECRET) return json({error:"Unauthorized"},401);
    let update:TelegramUpdate; try{update=await request.json() as TelegramUpdate;}catch{return json({error:"Invalid JSON"},400);}
    try{
      if(update.message?.chat?.id&&update.message.text?.trim().toLowerCase()==="/start") await start(env,update.message.chat.id);
      const cb=update.callback_query;
      if(cb?.id&&cb.data==="START_SCAN"&&cb.message?.chat?.id){
        await telegram(env,"answerCallbackQuery",{callback_query_id:cb.id,text:"Checking market-data gates",show_alert:false});
        await scan(env,cb.message.chat.id);
      }
      return json({ok:true});
    }catch{return json({error:"Upstream request failed"},502);}
  }
};
export {inspectCandles,gateCandidate,simpleFeatures,initialRegimeState,updateRegime};
export type {Candle,SignalCandidate};
