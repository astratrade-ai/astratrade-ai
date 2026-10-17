import { inspectCandles } from "./quality";
import { simpleFeatures } from "./analysis";
import type { Candle } from "./quality";
import { recordSignal, resolveSignal, getOutcomeSummary, type D1DatabaseLike } from "./storage";
import { fetchOTCCandles, fetchOTCSymbols, fetchOTCUsage, fetchOTCVenues, type OTCSymbol } from "./otcharts";
import { fetchTwelveDataCandles } from "./provider";

interface Env {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  OTCHARTS_API_KEY?: string;
  TWELVE_DATA_API_KEY?: string;
  APP_ENV?: string;
  DB?: D1DatabaseLike;
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
async function setMonitoring(env: Env, chatId: number, active: boolean): Promise<void> {
  if (!env.DB) throw new Error("Database not configured");
  const result = active
    ? await env.DB.prepare("INSERT INTO monitor_subscribers (chat_id,active,created_at) VALUES (?,1,?) ON CONFLICT(chat_id) DO UPDATE SET active=1").bind(String(chatId),new Date().toISOString()).run()
    : await env.DB.prepare("UPDATE monitor_subscribers SET active=0 WHERE chat_id=?").bind(String(chatId)).run();
  if (!result.success) throw new Error("Could not update monitoring state");
}
async function activeMonitors(env: Env): Promise<number[]> {
  if (!env.DB) return [];
  const result = await env.DB.prepare("SELECT chat_id FROM monitor_subscribers WHERE active=1 LIMIT 25").all<{chat_id:string}>();
  return (result.results ?? []).map(row => Number(row.chat_id)).filter(id => Number.isSafeInteger(id));
}
async function start(env: Env, chatId: number): Promise<void> {
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: "✨ ASTRATRADE AI — LIVE MONITOR\nTap START to enable automatic market scans. The bot selects an accessible market and sends a direction only when checks pass. Send STOP to pause. Signals are experimental; no profit is guaranteed.",
    reply_markup: { inline_keyboard: [
      [{ text: "✨ ▶ START LIVE MONITOR", style: "success", callback_data: "START_MONITOR" }],
      [{ text: "⏸ STOP MONITOR", style: "danger", callback_data: "STOP_MONITOR" }]
    ] }
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
async function scan(env: Env, chatId: number, requestedSymbol?: string, silentNoTrade = false): Promise<void> {
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
    const symbols = requestedSymbol
      ? catalogue.filter(s => s.open !== false && (s.symbol.toLowerCase() === requestedSymbol.toLowerCase() || s.symbol.toLowerCase() === requestedSymbol.toLowerCase() + "_otc")).slice(0, 1)
      : chooseSymbols(catalogue);
    if (!symbols.length) {
      await telegram(env,"sendMessage",{chat_id:chatId,text:"SCAN STATUS: NO TRADE\nThe Quotex catalogue returned no currently open instruments."});
      return;
    }
    const callsNeeded = symbols.length * 3 + 4;
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
          checks[tf+"s"] = message.includes("HTTP 402") ? "ACCOUNT_PLAN_BLOCKED" : message.includes("HTTP 401") ? "AUTH_FAILED" : message.includes("HTTP 403") ? "PLAN_LIMIT" : message.includes("HTTP 400") ? "TIMEFRAME_UNAVAILABLE" : message.includes("HTTP 429") ? "QUOTA_LIMIT" : "PROVIDER_ERROR";
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
    const entryCandle = await fetchOTCCandles(best.symbol, 60, key, 5).catch(() => null);
    const entryPrice = entryCandle?.candles.at(-1)?.close;
    const signalId = crypto.randomUUID();
    if (!env.DB) {
      await telegram(env,"sendMessage",{chat_id:chatId,text:"SCAN STATUS: NO TRADE\nSignal storage is not configured (DB binding missing); refusing to issue an unlogged signal."});
      return;
    }
    if (!entryCandle || typeof entryPrice !== "number" || !Number.isFinite(entryPrice)) {
      await telegram(env,"sendMessage",{chat_id:chatId,text:"SCAN STATUS: NO TRADE\nCould not capture a valid entry price for outcome tracking."});
      return;
    }
    await recordSignal(env.DB, {id:signalId,createdAt:new Date().toISOString(),symbol:best.symbol,direction:best.direction,timeframeSeconds:60,entryPrice,entryCandleTime:entryCandle.candles.at(-1)!.timestamp,strategyVersion:"ema-momentum-v1"});
    await telegram(env,"sendMessage",{chat_id:chatId,text:[
      "ASTRATRADE AI — PROVISIONAL SIGNAL",
      "Signal ID: "+signalId,
      "Market: "+best.name+" ("+best.symbol+")",
      "Direction: "+best.direction,
      "Outcome tracking: enabled (60-second close; provisional)",
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
    else if (message.includes("HTTP 402")) explanation = "OTCharts returned HTTP 402: the account plan is blocked or unsupported. No signal issued.";
    else if (message.includes("HTTP 403")) explanation = "OTCharts refused the requested Quotex book/instrument under the current free plan (403).";
    else if (message.includes("HTTP 429")) explanation = "OTCharts free-plan request allowance is exhausted (429).";
    await telegram(env,"sendMessage",{chat_id:chatId,text:"SCAN STATUS: NO TRADE\n"+explanation+"\nNo signal was fabricated."});
  }
}
async function resolveDueSignals(env: Env): Promise<number> {
  if (!env.DB || !env.OTCHARTS_API_KEY) return 0;
  const pending = await env.DB.prepare("SELECT id,symbol,direction,timeframe_seconds,entry_price,entry_candle_time FROM signals WHERE status='PENDING' AND entry_price IS NOT NULL AND (entry_candle_time + timeframe_seconds * 1000) <= ? LIMIT 100")
    .bind(Date.now() - 10000).all<{id:string;symbol:string;direction:Direction;timeframe_seconds:30|60|300;entry_price:number;entry_candle_time:number}>();
  let resolved = 0;
  for (const s of pending.results ?? []) {
    try {
      const candles = await fetchOTCCandles(s.symbol,s.timeframe_seconds,env.OTCHARTS_API_KEY,10);
      const targetTime = s.entry_candle_time + s.timeframe_seconds * 1000;
      const exit = candles.candles.find(c => c.timestamp >= targetTime);
      if (!exit || !Number.isFinite(exit.close)) continue;
      const status = exit.close === s.entry_price ? "VOID" : ((s.direction === "UP" && exit.close > s.entry_price) || (s.direction === "DOWN" && exit.close < s.entry_price)) ? "WIN" : "LOSS";
      const ok = await resolveSignal(env.DB,s.id,status,exit.close,"OTCharts candle close at/after expiry");
      if (ok) resolved++;
    } catch { /* provider errors leave the signal pending; never guess an outcome */ }
  }
  return resolved;
}
export default {
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await resolveDueSignals(env);
    for (const chatId of await activeMonitors(env)) {
      try { await scan(env,chatId,undefined,true); } catch { /* isolate subscribers */ }
    }
  },
  async fetch(request:Request,env:Env):Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ok:true,service:"astratrade-ai",environment:env.APP_ENV??"unset",otchartsConfigured:Boolean(env.OTCHARTS_API_KEY),databaseConfigured:Boolean(env.DB),signalMode:"provisional-uncalibrated",liveStreamAvailable:false});
    }
    if (request.method === "GET" && url.pathname === "/stats") {
      if (!env.DB) return json({error:"Database not configured"},503);
      try { return json(await getOutcomeSummary(env.DB)); } catch { return json({error:"Storage query failed"},500); }
    }
    if (request.method !== "POST" || url.pathname !== "/telegram/webhook") return json({error:"Not found"},404);
    if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) return json({error:"Unauthorized"},401);
    let update:TelegramUpdate;
    try { update = await request.json() as TelegramUpdate; } catch { return json({error:"Invalid JSON"},400); }
    try {
      const message = update.message;
      const chatId = message?.chat?.id;
      const text = message?.text?.trim() ?? "";
      if (chatId && text.toLowerCase() === "/start") await start(env,chatId);
      else if (chatId && ["start","start monitor","start scan","▶ start"].includes(text.toLowerCase())) {
        await setMonitoring(env,chatId,true);
        await telegram(env,"sendMessage",{chat_id:chatId,text:"✨ LIVE MONITOR ACTIVATED\nAutomatic market scans will run every minute. Signals are sent only when data-quality and direction checks pass. Send STOP to pause.",reply_markup:{inline_keyboard:[[{text:"⏸ STOP MONITOR",style:"danger",callback_data:"STOP_MONITOR"}]]}});
        await scan(env,chatId);
      } else if (chatId && ["stop","stop monitor","pause"].includes(text.toLowerCase())) {
        await setMonitoring(env,chatId,false);
        await telegram(env,"sendMessage",{chat_id:chatId,text:"⏸ Live monitoring stopped. Send START to resume."});
      }
      else if (chatId && (text.toLowerCase() === "/help" || text.toLowerCase() === "/commands")) {
        await telegram(env,"sendMessage",{chat_id:chatId,text:[
          "AstraTrade AI commands",
          "/start — show scan button",
          "/markets — list open instruments available from your OTCharts plan",
          "/analysis EURUSD — research-only standard FX technical analysis via Twelve Data (not an OTC signal)",
          "/signal SYMBOL — scan one exact available instrument, e.g. /signal EURUSD_otc",
          "/stats — show stored outcome statistics",
          "Signals are experimental, uncalibrated, and do not guarantee profit. Provider plan limits may block data."
        ].join("\n")});
      } else if (chatId && text.toLowerCase().startsWith("/analysis")) {
        const rawSymbol = text.split(/\s+/)[1]?.trim().toUpperCase();
        if (!rawSymbol) {
          await telegram(env,"sendMessage",{chat_id:chatId,text:"Usage: /analysis EURUSD\nResearch-only technical analysis using Twelve Data standard FX candles. This is not a Quotex OTC signal."});
        } else if (!env.TWELVE_DATA_API_KEY) {
          await telegram(env,"sendMessage",{chat_id:chatId,text:"Analysis unavailable: TWELVE_DATA_API_KEY is not configured on the Worker."});
        } else {
          const normalized = rawSymbol.includes("/") ? rawSymbol : /^[A-Z]{6}$/.test(rawSymbol) ? rawSymbol.slice(0,3)+"/"+rawSymbol.slice(3) : rawSymbol;
          const specs = [{interval:"1min",label:"1m",ms:60000},{interval:"5min",label:"5m",ms:300000},{interval:"15min",label:"15m",ms:900000}] as const;
          const reports: string[] = [];
          const directions: Array<string|null> = [];
          for (const spec of specs) {
            try {
              const data = await fetchTwelveDataCandles(normalized,spec.interval,env.TWELVE_DATA_API_KEY,80);
              const q = inspectCandles(data.candles,spec.ms,Date.now(),spec.ms*4);
              if (!q.ok) {
                reports.push(spec.label+": DATA_REJECTED ("+q.issues.map(i=>i.code).join(",")+")");
                directions.push(null);
                continue;
              }
              const f = simpleFeatures(data.candles);
              if (!f) { reports.push(spec.label+": INSUFFICIENT_DATA"); directions.push(null); continue; }
              const dir = f.momentum>0 && f.emaFast>f.emaSlow ? "UP" : f.momentum<0 && f.emaFast<f.emaSlow ? "DOWN" : "MIXED";
              directions.push(dir==="MIXED"?null:dir);
              reports.push(spec.label+": "+dir+" | last close "+data.candles.at(-1)!.close+" | EMA trend "+(f.emaFast>f.emaSlow?"UP":f.emaFast<f.emaSlow?"DOWN":"FLAT")+" | candle age "+Math.max(0,Math.round((Date.now()-data.candles.at(-1)!.timestamp)/1000))+"s");
            } catch (e) {
              const m=e instanceof Error?e.message:"provider error";
              reports.push(spec.label+": FEED_ERROR ("+m.slice(0,100)+")");
              directions.push(null);
            }
          }
          const aligned = directions.every(d=>d!==null) && directions.every(d=>d===directions[0]);
          // A direction is actionable for research display only when every timeframe's latest candle passes freshness checks.
          const reportsFresh = reports.every(line => {
            const m = line.match(/candle age (\d+)s/);
            if (!m) return false;
            const age = Number(m[1]);
            const label = line.slice(0,3);
            const maxAge = label === "1m:" ? 90 : label === "5m" ? 360 : label === "15m" ? 960 : 0;
            return age <= maxAge;
          });
          const direction = aligned && reportsFresh ? directions[0] : null;
          const directionLabel = direction === "UP" ? "CALL / UP ⬆️" : direction === "DOWN" ? "PUT / DOWN ⬇️" : "NO TRADE 🛑";
          await telegram(env,"sendMessage",{chat_id:chatId,text:[
            "📊 ASTRATRADE AI — SIMPLE ANALYSIS",
            "🧭 SET ASSET: "+normalized+" (STANDARD FX, NOT OTC)",
            "⏱️ TIME SET: "+(direction ? "1 MINUTE — RESEARCH HORIZON" : "WAIT — NO VALID ENTRY"),
            "🔗 FEED: Twelve Data composite FX",
            "🎯 DIRECTION: "+directionLabel,
            "🧪 TIMEFRAME CHECK: "+(aligned ? "1m + 5m + 15m ALIGNED" : "NOT ALIGNED / INCOMPLETE"),
            "🕒 FRESHNESS CHECK: "+(reportsFresh ? "PASS" : "FAIL — one or more candles are stale or unavailable"),
            ...reports,
            direction ? "⚠️ RESEARCH BIAS ONLY — not a confirmed broker entry signal." : "🛑 NO TRADE: wait for fresh, complete, aligned data.",
            "Twelve Data standard FX prices do not match Quotex OTC quotes by default. No win probability or profit is guaranteed. Do not treat this as a live OTC instruction."
          ].join("\n").slice(0,3900)});
        }
      } else if (chatId && text.toLowerCase() === "/markets") {
        if (!env.OTCHARTS_API_KEY) {
          await telegram(env,"sendMessage",{chat_id:chatId,text:"Markets unavailable: OTCHARTS_API_KEY is not configured."});
        } else {
          const venues = await fetchOTCVenues(env.OTCHARTS_API_KEY);
          const quotex = venues.venues?.find(v => v.id === "quotex");
          if (!quotex?.open) await telegram(env,"sendMessage",{chat_id:chatId,text:"Markets unavailable: your OTCharts plan does not currently open the Quotex venue."});
          else {
            const catalogue = await fetchOTCSymbols(env.OTCHARTS_API_KEY,"quotex");
            const open = catalogue.filter(s => s.symbol && s.open !== false).slice(0,35);
            await telegram(env,"sendMessage",{chat_id:chatId,text:open.length
              ? ["Open instruments available to this account (first "+open.length+"):",...open.map(s=>s.symbol+(s.name && s.name!==s.symbol ? " — "+s.name : "")),"Use /signal SYMBOL to request a scan. This is limited to your provider plan."].join("\n").slice(0,3900)
              : "The provider returned no open instruments."});
          }
        }
      } else if (chatId && text.toLowerCase() === "/stats") {
        if (!env.DB) await telegram(env,"sendMessage",{chat_id:chatId,text:"Outcome statistics unavailable: D1 database binding is missing."});
        else {
          const stats = await getOutcomeSummary(env.DB);
          await telegram(env,"sendMessage",{chat_id:chatId,text:[
            "AstraTrade outcome tracking",
            "Resolved: "+stats.resolved_total,
            "Wins: "+stats.wins,
            "Losses: "+stats.losses,
            "Voids: "+stats.voids,
            "Observed win rate: "+(stats.win_rate_percent===null ? "not available yet" : stats.win_rate_percent+"%"),
            "Historical results are not a guarantee of future performance."
          ].join("\n")});
        }
      } else if (chatId && text.toLowerCase().startsWith("/signal")) {
        const requested = text.split(/\s+/)[1];
        if (!requested) await telegram(env,"sendMessage",{chat_id:chatId,text:"Usage: /signal SYMBOL\nFirst use /markets to see instruments accessible to your OTCharts plan."});
        else await scan(env,chatId,requested);
      }
      const cb = update.callback_query;
      if (cb?.id && cb.data === "START_MONITOR" && cb.message?.chat?.id) {
        const id=cb.message.chat.id;
        await telegram(env,"answerCallbackQuery",{callback_query_id:cb.id,text:"Live monitoring enabled",show_alert:false});
        await setMonitoring(env,id,true);
        await telegram(env,"sendMessage",{chat_id:id,text:"✨ LIVE MONITOR ACTIVATED\nAutomatic scans will run every minute. Signals are sent only when data-quality and direction checks pass. Send STOP to pause.",reply_markup:{inline_keyboard:[[{text:"⏸ STOP MONITOR",style:"danger",callback_data:"STOP_MONITOR"}]]}});
        await scan(env,id);
      } else if (cb?.id && cb.data === "STOP_MONITOR" && cb.message?.chat?.id) {
        const id=cb.message.chat.id;
        await telegram(env,"answerCallbackQuery",{callback_query_id:cb.id,text:"Monitoring stopped",show_alert:false});
        await setMonitoring(env,id,false);
        await telegram(env,"sendMessage",{chat_id:id,text:"⏸ LIVE MONITOR STOPPED. Send START to resume."});
      }
      return json({ok:true});
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      let explanation = "Command failed while contacting a data service. Please try again later.";
      if (message.includes("HTTP 402")) explanation = "OTCharts is returning HTTP 402: this account's free API tier is paused/blocked. /markets and scans need an active supported plan; no signal was generated.";
      else if (message.includes("HTTP 401")) explanation = "OTCharts rejected the API key (HTTP 401). The key may be invalid or inactive.";
      else if (message.includes("HTTP 403")) explanation = "OTCharts denied this request under the current plan (HTTP 403).";
      else if (message.includes("HTTP 429")) explanation = "OTCharts request quota is exhausted (HTTP 429).";
      if (update.message?.chat?.id) {
        try { await telegram(env, "sendMessage", {chat_id:update.message.chat.id, text:"AstraTrade AI — request unavailable\n"+explanation+"\nNo fake market data or signal was produced."}); } catch { /* Telegram delivery failed; acknowledge webhook to avoid retry storms */ }
      }
      return json({ok:true, commandError:explanation});
    }
  }
};
