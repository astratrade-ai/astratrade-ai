import { inspectCandles } from "./quality";
import { simpleFeatures } from "./analysis";
import type { Candle } from "./quality";
import { fetchOTCCandles, fetchOTCSymbols, fetchOTCUsage, fetchOTCVenues, type OTCSymbol } from "./otcharts";

interface Env {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  OTCHARTS_API_KEY?: string;
  TWELVE_DATA_API_KEY?: string;
  APP_ENV?: string;
}
interface TelegramUpdate {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
}
type TF = 30 | 60 | 300;
type Direction = "UP" | "DOWN";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
async function telegram(env: Env, method: string, payload: Record<string, unknown>): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram bot token not configured");
  const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error("Telegram API returned HTTP " + r.status);
}
async function start(env: Env, chatId: number): Promise<void> {
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: "AstraTrade AI\nOTCharts Quotex data scan. Free-plan limits apply. Signals are experimental and uncalibrated; no profit is guaranteed.",
    reply_markup: { inline_keyboard: [[{ text: "START", callback_data: "START_SCAN" }]] }
  });
}
function chooseSymbols(symbols: OTCSymbol[]): OTCSymbol[] {
  const preferred = ["EURUSD_otc", "GBPUSD_otc", "USDJPY_otc", "AUDUSD_otc", "EURJPY_otc"];
  const tradable = symbols.filter(s => s.symbol && s.open !== false);
  tradable.sort((a,b) => {
    const ai = preferred.indexOf(a.symbol), bi = preferred.indexOf(b.symbol);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  return tradable.slice(0, 5);
}
function assess(candles: Candle[], tf: TF, now: number, gaps?: {runs?:number;missingBars?:number}) {
  const quality = inspectCandles(candles, tf * 1000, now, tf * 1000 * 4);
  if (gaps && ((gaps.runs ?? 0) > 0 || (gaps.missingBars ?? 0) > 0)) {
    return { ok:false, direction:null as Direction|null, score:0, issue:"CANDLE_GAP", latest:quality.latestTimestamp, count:candles.length };
  }
  if (!quality.ok) return {ok:false,direction:null as Direction|null,score:0,issue:quality.issues.map(i=>i.code).join(","),latest:quality.latestTimestamp,count:candles.length};
  const f = simpleFeatures(candles);
  if (!f) return {ok:false,direction:null as Direction|null,score:0,issue:"INSUFFICIENT_CANDLES",latest:quality.latestTimestamp,count:candles.length};
  const direction: Direction|null = f.momentum > 0 && f.emaFast > f.emaSlow ? "UP" :
    f.momentum < 0 && f.emaFast < f.emaSlow ? "DOWN" : null;
  const score = Math.abs(f.momentum) / Math.max(f.volatility, 1e-8);
  if (!direction || Math.abs(f.momentum) < Math.max(f.volatility * 0.2, 1e-8)) {
    return {ok:true,direction:null,score,issue:"NO_CLEAR_TREND",latest:quality.latestTimestamp,count:candles.length};
  }
  return {ok:true,direction,score,issue:"OK",latest:quality.latestTimestamp,count:candles.length};
}
async function scan(env: Env, chatId: number): Promise<void> {
  const key = env.OTCHARTS_API_KEY;
  if (!key) {
    await telegram(env,"sendMessage",{chat_id:chatId,text:"SCAN STATUS: NO TRADE\nOTCHARTS_API_KEY is not available to this deployed Worker. Check the Worker Secret and deploy the latest code."});
    return;
  }
  try {
    const usage = await fetchOTCUsage(key);
    const venues = await fetchOTCVenues(key);
    const quotex = venues.venues?.find(v => v.id === "quotex");
    if (!quotex?.open) {
      await telegram(env,"sendMessage",{chat_id:chatId,text:"SCAN STATUS: NO TRADE\nOTCharts API key is valid, but your current plan does not open the Quotex venue. Check the /v1/venues access for your account."});
      return;
    }
    const catalogue = await fetchOTCSymbols(key,"quotex");
    const symbols = chooseSymbols(catalogue);
    if (!symbols.length) {
      await telegram(env,"sendMessage",{chat_id:chatId,text:"SCAN STATUS: NO TRADE\nThe Quotex catalogue returned no currently open instruments."});
      return;
    }
    const callsNeeded = symbols.length * 3 + 2;
    const remaining = usage.requests?.remaining;
    if (typeof remaining === "number" && remaining < callsNeeded) {
      await telegram(env,"sendMessage",{chat_id:chatId,text:
        "SCAN STATUS: NO TRADE\nOTCharts key is responding, but the remaining free-plan quota is too low for a complete scan.\nRemaining requests: "+remaining+"\nEstimated needed including catalogue checks: "+callsNeeded+"\nNo partial or fabricated signal was issued."});
      return;
    }
    const tfList: TF[] = [30,60,300];
    const evaluated: Array<{symbol:string;name:string;direction:Direction;score:number;checks:Record<string,string>;latest:number}> = [];
    const diagnostics: string[] = [];
    for (const s of symbols) {
      const checks: Record<string,string> = {};
      const states: Array<{tf:TF;direction:Direction|null;score:number;ok:boolean;latest:number|null}> = [];
      for (const tf of tfList) {
        try {
          const data = await fetchOTCCandles(s.symbol,tf,key,80);
          const a = assess(data.candles,tf,Date.now(),data.gaps);
          checks[tf+"s"] = a.issue;
          states.push({tf,direction:a.direction,score:a.score,ok:a.ok,latest:a.latest});
        } catch (e) {
          const message = e instanceof Error ? e.message : "provider error";
          checks[tf+"s"] = message.includes("HTTP 403") ? "PLAN_LIMIT" : message.includes("HTTP 400") ? "TIMEFRAME_UNAVAILABLE" : message.includes("HTTP 429") ? "QUOTA_LIMIT" : "PROVIDER_ERROR";
          states.push({tf,direction:null,score:0,ok:false,latest:null});
        }
      }
      const dirs = states.map(x=>x.direction);
      const agree = dirs[0] !== null && dirs.every(d=>d===dirs[0]) && states.every(x=>x.ok && x.latest!==null);
      if (agree) {
        evaluated.push({symbol:s.symbol,name:s.name??s.symbol,direction:dirs[0] as Direction,score:states.reduce((n,x)=>n+x.score,0)/states.length,checks,latest:Math.min(...states.map(x=>x.latest as number))});
      } else diagnostics.push(s.symbol+": no aligned setup ("+tfList.map(tf=>tf+"s="+checks[tf+"s"]).join(", ")+")");
    }
    evaluated.sort((a,b)=>b.score-a.score);
    const best = evaluated[0];
    if (!best) {
      await telegram(env,"sendMessage",{chat_id:chatId,text:[
        "SCAN STATUS: NO TRADE",
        "OTCharts connection responded, but no instrument passed data-quality and 30s/1m/5m direction agreement.",
        "Quotex instruments checked: "+symbols.length+" (free plan limits apply; this is not the full book).",
        "Remaining API requests: "+(remaining===undefined?"not reported":remaining),
        ...diagnostics,
        "No win-rate percentage is claimed; outcome calibration has not been completed."
      ].join("\n").slice(0,3900)});
      return;
    }
    const ageSeconds = Math.max(0,Math.round((Date.now()-best.latest)/1000));
    await telegram(env,"sendMessage",{chat_id:chatId,text:[
      "ASTRATRADE AI — PROVISIONAL SIGNAL",
      "Market: "+best.name+" ("+best.symbol+")",
      "Direction: "+best.direction,
      "Timeframe agreement: 30s + 1m + 5m",
      "Setup rank score: "+best.score.toFixed(2)+" (indicator score, NOT win probability)",
      "Newest candle age: "+ageSeconds+"s",
      "Markets checked: "+symbols.length+" accessible/open instruments (free-plan scope; not all Quotex markets)",
      "API quota remaining before scan: "+(remaining===undefined?"not reported":remaining),
      "Evidence: "+Object.entries(best.checks).map(([tf,status])=>tf+" "+status).join("; "),
      "Important: experimental, not calibrated. Verify the current Quotex quote and payout; place trades manually only if you independently accept the risk."
    ].join("\n")});
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown provider error";
    const safe = message.replace(/otc_live_[A-Za-z0-9_-]+/g,"[redacted]").slice(0,500);
    let explanation = "OTCharts request failed: "+safe;
    if (message.includes("HTTP 401")) explanation = "OTCharts rejected the API key (401). Confirm the key is active and the OTCharts account email is confirmed.";
    else if (message.includes("HTTP 403")) explanation = "OTCharts refused the requested Quotex book/instrument under the current free plan (403).";
    else if (message.includes("HTTP 429")) explanation = "OTCharts free-plan request allowance is exhausted (429).";
    await telegram(env,"sendMessage",{chat_id:chatId,text:"SCAN STATUS: NO TRADE\n"+explanation+"\nNo signal was fabricated."});
  }
}
export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ok:true,service:"astratrade-ai",environment:env.APP_ENV??"unset",otchartsConfigured:Boolean(env.OTCHARTS_API_KEY),signalMode:"provisional-uncalibrated",liveStreamAvailable:false});
    }
    if (request.method !== "POST" || url.pathname !== "/telegram/webhook") return json({error:"Not found"},404);
    if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) return json({error:"Unauthorized"},401);
    let update:TelegramUpdate;
    try { update = await request.json() as TelegramUpdate; } catch { return json({error:"Invalid JSON"},400); }
    try {
      if (update.message?.chat?.id && update.message.text?.trim().toLowerCase() === "/start") await start(env,update.message.chat.id);
      const cb = update.callback_query;
      if (cb?.id && cb.data === "START_SCAN" && cb.message?.chat?.id) {
        await telegram(env,"answerCallbackQuery",{callback_query_id:cb.id,text:"Scanning accessible Quotex markets",show_alert:false});
        await scan(env,cb.message.chat.id);
      }
      return json({ok:true});
    } catch { return json({error:"Upstream request failed"},502); }
  }
};
