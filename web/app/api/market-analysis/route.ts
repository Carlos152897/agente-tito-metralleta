// GET /api/market-analysis — "Análisis del mercado" (ago 2026, pedido
// explícito de Carlos, a partir de su propia guía de lectura de mercado
// para trading de futuros NQ). Junta los instrumentos macro reales de la
// guía (Nasdaq/S&P/Dow/Russell, VIX, bono a 10 años, dólar, petróleo, oro,
// bitcoin — ver lib/marketAnalysis.ts para las reglas de correlación),
// noticias que podrían mover el rumbo (Fed, geopolítica) y un vigía de
// resultados de las mega-caps (antes/después del cierre).
//
// Fuentes, todas reales — nada inventado:
//   - Futuros (NQ/ES/YM/RTY/ZN/GC/CL/BTC): tastytrade `fetchMacroQuote`,
//     cotizan casi 24/5 en CME/Globex — cubre pre-market Y after-hours.
//   - VIX: índice real de tastytrade (spot, cierra con el mercado de acciones).
//   - Dólar (DXY): sin futuro ICE disponible en tastytrade (probado en vivo,
//     `/instruments/futures?product-code[]=DX` da vacío) — proxy declarado:
//     UUP (Invesco DB US Dollar Bullish ETF), vía MarketSnack, que sí trae
//     % en regular Y en extendido (pre/after-market) por separado.
//   - Resultados: `fetchAssetSnapshot` (MarketSnack) trae `earnings_date`
//     REAL cuando ya está agendado — a diferencia de `lib/earnings.ts`
//     (estimación por cadencia de ~91 días, ya declarada como proxy en su
//     propio archivo), esto es la fecha real si MarketSnack la tiene.
//   - Noticias: `fetchMacroFeeds()` (lib/news.ts, ya en producción para el
//     resto del agente) — CNBC + Investing.com, filtradas por palabras clave
//     de catalizador (Fed, tasas, guerra, aranceles...).

import { fetchActiveFuture, fetchMacroQuote, TastytradeError } from "@/lib/tastytrade";
import { fetchAssetSnapshot, MarketSnackError } from "@/lib/marketsnack";
import { fetchMacroFeeds } from "@/lib/news";
import { isMarketOpen, isPreMarket, isFuturesMarketOpen } from "@/lib/marketHours";
import { analyzeMarket, buildDailyAlerts, type InstrumentKey, type MacroReading } from "@/lib/marketAnalysis";
import { GRANDES_EMPRESAS } from "@/lib/grandesEmpresas";
import { marketDateStr } from "@/lib/occ";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FUTURE_INSTRUMENTS: { key: InstrumentKey; label: string; productCode: string }[] = [
  { key: "NQ", label: "Nasdaq-100 (NQ)", productCode: "NQ" },
  { key: "ES", label: "S&P 500 (ES)", productCode: "ES" },
  { key: "YM", label: "Dow Jones (YM)", productCode: "YM" },
  { key: "RTY", label: "Russell 2000 (RTY)", productCode: "RTY" },
  { key: "ZN", label: "Bono 10 años (ZN)", productCode: "ZN" },
  { key: "GC", label: "Oro (GC)", productCode: "GC" },
  { key: "CL", label: "Petróleo WTI (CL)", productCode: "CL" },
  { key: "BTC", label: "Bitcoin (BTC)", productCode: "BTC" },
];

const CATALYST_KEYWORDS = [
  "fed", "fomc", "powell", "rate", "tasa", "tasas", "interest rate",
  "tariff", "arancel", "trade war", "guerra comercial",
  "war", "guerra", "conflict", "conflicto", "sanction", "sanción",
  "cpi", "inflation", "inflación", "pce", "jobs report", "nonfarm", "payroll", "empleo",
  "recession", "recesión", "gdp", "pib",
  "china", "russia", "rusia", "ukraine", "ucrania", "israel", "iran", "irán",
];

function isCatalyst(text: string): boolean {
  const lower = text.toLowerCase();
  return CATALYST_KEYWORDS.some((k) => lower.includes(k));
}

async function fetchFutureReading(key: InstrumentKey, label: string, productCode: string): Promise<MacroReading | null> {
  const inst = await fetchActiveFuture(productCode).catch(() => null);
  if (!inst) return null;
  const q = await fetchMacroQuote({ future: inst.symbol }).catch(() => null);
  if (!q) return null;
  const changePct = ((q.last - q.prevClose) / q.prevClose) * 100;
  return { key, label, last: q.last, prevClose: q.prevClose, changePct };
}

export async function GET() {
  const now = new Date();

  try {
    const [futureReadings, vixQuote, dxySnapshot, macroNews, earningsSnapshots] = await Promise.all([
      Promise.all(FUTURE_INSTRUMENTS.map((f) => fetchFutureReading(f.key, f.label, f.productCode))),
      fetchMacroQuote({ index: "VIX" }).catch(() => null),
      fetchAssetSnapshot("UUP").catch(() => null),
      fetchMacroFeeds().catch(() => []),
      Promise.all(
        GRANDES_EMPRESAS.map(async (t) => {
          const snap = await fetchAssetSnapshot(t.id).catch(() => null);
          return { ticker: t.id, snap };
        }),
      ),
    ]);

    const readings: MacroReading[] = futureReadings.filter((r): r is MacroReading => r != null);
    if (vixQuote) {
      readings.push({
        key: "VIX", label: "VIX", last: vixQuote.last, prevClose: vixQuote.prevClose,
        changePct: ((vixQuote.last - vixQuote.prevClose) / vixQuote.prevClose) * 100,
      });
    }
    if (dxySnapshot?.regularChangePct != null && dxySnapshot.price != null) {
      const changePct = dxySnapshot.regularChangePct;
      readings.push({
        key: "DXY", label: "Dólar (proxy UUP)", last: dxySnapshot.price,
        prevClose: dxySnapshot.price / (1 + changePct / 100), changePct,
      });
    }

    const analysis = analyzeMarket(readings);

    // Empresas con fecha de resultados REAL ya agendada (no siempre hay —
    // entre temporadas de resultados, MarketSnack la trae en null para todos).
    const earningsWatch = earningsSnapshots
      .filter((e) => e.snap?.earningsDate)
      .map((e) => ({ ticker: e.ticker, earningsDate: e.snap!.earningsDate as string }))
      .sort((a, b) => a.earningsDate.localeCompare(b.earningsDate));

    // Movimiento fuerte YA visible en pre-market/after-hours (típicamente por
    // resultados que ya salieron) — pedido explícito de Carlos: "también para
    // el after market, porque también hay earnings". A diferencia de
    // `earningsWatch` (fecha futura agendada), esto es la reacción real de
    // HOY, sin importar si `earnings_date` está poblado o no (MarketSnack
    // suele limpiar `earnings_date` apenas el reporte ya salió).
    const EXTENDED_MOVE_THRESHOLD = 1.5;
    const extendedMoves = earningsSnapshots
      .filter((e) => e.snap?.extendedChangePct != null && Math.abs(e.snap.extendedChangePct) >= EXTENDED_MOVE_THRESHOLD)
      .map((e) => ({
        ticker: e.ticker,
        changePct: e.snap!.extendedChangePct as number,
        type: e.snap!.extendedType,
      }))
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

    const news = macroNews.slice(0, 30).map((n) => ({
      title: n.title,
      url: n.url,
      publisher: n.publisher,
      publishedUtc: n.publishedUtc,
      catalyst: isCatalyst(`${n.title} ${n.description ?? ""}`),
    }));
    const catalystNews = news.filter((n) => n.catalyst).slice(0, 8);
    const otherNews = news.filter((n) => !n.catalyst).slice(0, 8);

    // "Noticia relevante del día" (pedido explícito de Carlos): earnings de
    // HOY + titulares de HOY clasificados (guerra → alerta roja explicando
    // el canal petróleo→NQ/ES, Fed/Trump → aviso). Solo titulares de HOY
    // (no toda la ventana de 30 que trae `news`) — una guerra de hace 3 días
    // no es "la noticia de hoy".
    const todayStr = marketDateStr(now);
    const earningsToday = earningsWatch.filter((e) => e.earningsDate === todayStr).map((e) => e.ticker);
    const headlinesToday = macroNews
      .filter((n) => marketDateStr(new Date(n.publishedUtc)) === todayStr)
      .map((n) => ({ title: n.title, url: n.url }));
    const dailyAlerts = buildDailyAlerts(headlinesToday, earningsToday);

    return Response.json({
      asOf: now.toISOString(),
      marketOpen: isMarketOpen(now),
      isPreMarket: isPreMarket(now),
      futuresOpen: isFuturesMarketOpen(now),
      readings,
      analysis,
      earningsWatch,
      extendedMoves,
      catalystNews,
      otherNews,
      dailyAlerts,
    });
  } catch (err) {
    const message =
      err instanceof TastytradeError || err instanceof MarketSnackError
        ? err.message
        : "Error inesperado armando el análisis del mercado.";
    return Response.json({ error: message }, { status: 502 });
  }
}
