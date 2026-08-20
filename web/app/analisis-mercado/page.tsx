"use client";

// "Análisis del mercado" (ago 2026, pedido explícito de Carlos, a partir de
// su propia guía de lectura de mercado para trading de futuros NQ). Botón
// que resume en palabras sencillas cómo está el mercado hoy — índices,
// VIX, bono a 10 años, dólar, petróleo, oro, bitcoin (ver
// lib/marketAnalysis.ts para las reglas de correlación de la guía) — más
// noticias que podrían cambiar el rumbo (Fed, geopolítica) y qué mega-caps
// reportan resultados pronto (antes o después del cierre).

import { useCallback, useEffect, useState } from "react";
import BrandMark from "@/app/components/BrandMark";
import NavTabs from "@/app/components/NavTabs";

type Lean = "risk_on" | "risk_off" | "neutral";
type Regime = "risk_on" | "risk_off" | "mixto";

interface Reading {
  key: string;
  label: string;
  last: number;
  prevClose: number;
  changePct: number;
}

interface Signal {
  label: string;
  lean: Lean;
  detail: string;
}

interface Analysis {
  regime: Regime;
  regimeLabel: string;
  score: number;
  signals: Signal[];
  breadthWarning: string | null;
  summary: string;
  oneLiner: string;
  simpleSummary: string;
}

interface EarningsItem {
  ticker: string;
  earningsDate: string;
}

interface ExtendedMoveItem {
  ticker: string;
  changePct: number;
  type: string | null;
}

interface NewsItem {
  title: string;
  url: string;
  publisher: string;
  publishedUtc: string;
  catalyst: boolean;
}

type AlertLevel = "danger" | "warning" | "info";

interface DailyAlert {
  level: AlertLevel;
  message: string;
  sourceUrl?: string;
}

interface Result {
  asOf: string;
  marketOpen: boolean;
  isPreMarket: boolean;
  futuresOpen: boolean;
  readings: Reading[];
  analysis: Analysis;
  earningsWatch: EarningsItem[];
  extendedMoves: ExtendedMoveItem[];
  catalystNews: NewsItem[];
  otherNews: NewsItem[];
  dailyAlerts: DailyAlert[];
}

const KEY_LAST = "visionary.marketAnalysis.last";

const money = (n: number) =>
  n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const timeET = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
const dateET = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

const REGIME_CLASS: Record<Regime, string> = { risk_on: "ma-badge-on", risk_off: "ma-badge-off", mixto: "ma-badge-mixed" };
const LEAN_CLASS: Record<Lean, string> = { risk_on: "ma-lean-on", risk_off: "ma-lean-off", neutral: "ma-lean-neutral" };
const LEAN_DOT: Record<Lean, string> = { risk_on: "🟢", risk_off: "🔴", neutral: "⚪" };

export default function MarketAnalysisPage() {
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY_LAST);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<Result>;
        // Descarta el cache si le falta algún array esperado — pasa cuando
        // se agrega un campo nuevo a la respuesta y queda un cache viejo de
        // antes de ese cambio (bug real visto en vivo: `extendedMoves`
        // undefined tumbaba el render con "Cannot read properties of
        // undefined"). Mejor recargar en limpio que mostrar a medias.
        const isComplete =
          Array.isArray(parsed.readings) && Array.isArray(parsed.earningsWatch) &&
          Array.isArray(parsed.extendedMoves) && Array.isArray(parsed.catalystNews) &&
          Array.isArray(parsed.otherNews) && Array.isArray(parsed.dailyAlerts) &&
          typeof parsed.analysis?.simpleSummary === "string";
        if (isComplete) setData(parsed as Result);
        else window.localStorage.removeItem(KEY_LAST);
      } catch {
        window.localStorage.removeItem(KEY_LAST);
      }
    }
  }, []);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/market-analysis", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json as Result);
      window.localStorage.setItem(KEY_LAST, JSON.stringify(json));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <main className="ideas-page">
      <div className="hb">
        <BrandMark subtitle="🌍 Análisis del mercado" />
        <NavTabs />
      </div>

      <div className="ideas-body">
        <style>{CSS}</style>

        <header className="ma-head">
          <div>
            <h1>Análisis del mercado</h1>
            <p>Cómo está el mercado hoy, en palabras simples — índices, VIX, bono a 10 años, dólar, petróleo, oro y bitcoin, más noticias que podrían cambiar el rumbo.</p>
          </div>
          <button className="ma-analyze-btn" onClick={analyze} disabled={loading}>
            {loading ? "Analizando…" : data ? "🔄 Actualizar análisis" : "🔍 Analizar mercado"}
          </button>
        </header>

        {error && <div className="ma-error">⚠ {error}</div>}

        {!data && !loading && !error && (
          <div className="ma-empty">Tocá "Analizar mercado" para ver el resumen de hoy.</div>
        )}

        {data && (
          <>
            <div className="ma-meta">
              <span>actualizado {timeET(data.asOf)} ET</span>
              <span className={data.marketOpen ? "ma-mkt ma-mkt-on" : "ma-mkt ma-mkt-off"}>
                {data.marketOpen ? "🟢 mercado abierto" : data.isPreMarket ? "🟡 pre-market" : "🔴 mercado de acciones cerrado"}
              </span>
              <span className={data.futuresOpen ? "ma-mkt ma-mkt-on" : "ma-mkt ma-mkt-off"}>
                {data.futuresOpen ? "🟢 futuros (NQ/ES) abiertos" : "🔴 futuros cerrados"}
              </span>
            </div>

            {data.dailyAlerts.length > 0 && (
              <section className="ma-alerts">
                <h2>📰 Noticia relevante del día</h2>
                <div className="ma-alerts-list">
                  {data.dailyAlerts.map((a, i) => (
                    <div key={i} className={`ma-alert ma-alert-${a.level}`}>
                      {a.sourceUrl ? (
                        <a href={a.sourceUrl} target="_blank" rel="noreferrer">{a.message}</a>
                      ) : (
                        <span>{a.message}</span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className={`ma-verdict ${REGIME_CLASS[data.analysis.regime]}`}>
              <div className="ma-verdict-top">
                <span className="ma-verdict-badge">{data.analysis.regimeLabel}</span>
              </div>
              <p className="ma-verdict-oneliner">{data.analysis.oneLiner}</p>
              <p className="ma-verdict-summary">{data.analysis.summary}</p>
            </section>

            <section className="ma-simple">
              <h2>🧒 En palabras simples</h2>
              <p>{data.analysis.simpleSummary}</p>
            </section>

            {data.extendedMoves.length > 0 && (
              <section className="ma-extended-moves">
                <h2>🌙 Movimiento fuerte fuera de horario (probable por resultados)</h2>
                <div className="ma-extended-list">
                  {data.extendedMoves.map((m) => (
                    <span key={m.ticker} className={`ma-extended-chip ${m.changePct >= 0 ? "ma-up" : "ma-down"}`}>
                      <b>{m.ticker}</b> {pct(m.changePct)} {m.type ? `(${m.type})` : ""}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section className="ma-instruments">
              {data.readings.map((r) => (
                <div key={r.key} className="ma-instrument-card">
                  <div className="ma-instrument-label">{r.label}</div>
                  <div className="ma-instrument-price">{money(r.last)}</div>
                  <div className={`ma-instrument-change ${r.changePct >= 0 ? "ma-up" : "ma-down"}`}>{pct(r.changePct)}</div>
                </div>
              ))}
            </section>

            <section className="ma-signals">
              <h2>Señales, una por una</h2>
              <div className="ma-signals-list">
                {data.analysis.signals.map((s, i) => (
                  <div key={i} className={`ma-signal-row ${LEAN_CLASS[s.lean]}`}>
                    <span className="ma-signal-dot">{LEAN_DOT[s.lean]}</span>
                    <span className="ma-signal-label">{s.label}</span>
                    <span className="ma-signal-detail">{s.detail}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="ma-cols">
              <div className="ma-box">
                <h2>📅 Resultados que vigilar</h2>
                {data.earningsWatch.length === 0 ? (
                  <p className="ma-box-empty">Sin resultados agendados todavía para las empresas del radar (Magnificent 7 + PLTR/IREN/NFLX/SPCX/INTC/ORCL) — se actualiza solo cuando MarketSnack ya tiene la fecha confirmada.</p>
                ) : (
                  <ul className="ma-earnings-list">
                    {data.earningsWatch.map((e) => (
                      <li key={e.ticker}><b>{e.ticker}</b> — reporta el {dateET(e.earningsDate)}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="ma-box">
                <h2>⚠ Posibles catalizadores</h2>
                {data.catalystNews.length === 0 ? (
                  <p className="ma-box-empty">Sin noticias de Fed/tasas/geopolítica destacadas ahora mismo.</p>
                ) : (
                  <ul className="ma-news-list">
                    {data.catalystNews.map((n) => (
                      <li key={n.url}>
                        <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a>
                        <span className="ma-news-meta">{n.publisher} · {dateET(n.publishedUtc)} {timeET(n.publishedUtc)} ET</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="ma-box ma-news-general">
              <h2>Más noticias del día</h2>
              {data.otherNews.length === 0 ? (
                <p className="ma-box-empty">Sin más titulares por ahora.</p>
              ) : (
                <ul className="ma-news-list">
                  {data.otherNews.map((n) => (
                    <li key={n.url}>
                      <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a>
                      <span className="ma-news-meta">{n.publisher} · {dateET(n.publishedUtc)} {timeET(n.publishedUtc)} ET</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        <p className="ma-foot">
          Futuros (NQ/ES/YM/RTY/ZN/GC/CL/BTC) y VIX: datos reales de tastytrade — los futuros cotizan casi 24/5, así que
          también cubren pre-market y after-hours. Dólar: proxy real vía el ETF UUP (no hay futuro de DXY en tastytrade).
          Bono a 10 años: proxy vía el futuro de la nota (ZN) — su precio sube cuando el rendimiento (yield) baja, y
          viceversa. Resultados: "Resultados que vigilar" solo muestra fecha si MarketSnack ya la tiene confirmada
          (entre temporadas de resultados puede no haber ninguna agendada). "Movimiento fuerte fuera de horario"
          es distinto: avisa cuando una de las 13 empresas del radar ya se movió ≥1.5% en pre-market/after-hours
          ahora mismo, sin importar si la fecha estaba agendada — así se ve la reacción real a un reporte que
          recién salió. Dinero simulado, no es consejo financiero.
        </p>
      </div>
    </main>
  );
}

const CSS = `
.ma-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.ma-head h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: -0.2px; }
.ma-head p { margin: 0; color: var(--muted); font-size: 13.5px; max-width: 560px; }
.ma-analyze-btn { font: inherit; font-weight: 700; padding: 12px 22px; border-radius: 10px; cursor: pointer;
  background: var(--accent); border: 1px solid var(--accent); color: #fff; white-space: nowrap; }
.ma-analyze-btn:disabled { opacity: .6; cursor: default; }

.ma-error { background: var(--red-bg); border: 1px solid var(--red-soft); color: #7a271a;
  padding: 12px 14px; border-radius: 8px; margin: 0 0 16px; }
.ma-empty { color: var(--faint); font-size: 14px; padding: 40px 0; text-align: center; }

.ma-meta { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 0 0 14px; color: var(--muted); font-size: 13px; }
.ma-mkt { font-size: 11.5px; padding: 2px 9px; border-radius: 999px; font-weight: 600; }
.ma-mkt-on { background: var(--green-bg); color: var(--green-dark); border: 1px solid var(--green); }
.ma-mkt-off { background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); }

.ma-verdict { border: 2px solid var(--border); border-radius: 14px; padding: 18px 20px; margin: 0 0 18px; background: var(--panel); }
.ma-badge-on { border-color: var(--green); background: var(--green-bg); }
.ma-badge-off { border-color: var(--red-soft); background: var(--red-bg); }
.ma-badge-mixed { border-color: var(--amber-border); background: var(--amber-bg); }
.ma-verdict-badge { font-size: 17px; font-weight: 800; }
.ma-verdict-oneliner { margin: 10px 0 6px; font-size: 15px; font-weight: 600; }
.ma-verdict-summary { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--text); }

.ma-alerts { margin: 0 0 18px; }
.ma-alerts h2 { margin: 0 0 10px; font-size: 15px; }
.ma-alerts-list { display: flex; flex-direction: column; gap: 8px; }
.ma-alert { border-radius: 10px; padding: 12px 16px; font-size: 14px; line-height: 1.5; border: 1px solid var(--border); }
.ma-alert a { color: inherit; text-decoration: none; }
.ma-alert a:hover { text-decoration: underline; }
.ma-alert-danger { background: var(--red-bg); border-color: #d9524f; color: #7a271a; font-weight: 700; }
.ma-alert-warning { background: var(--amber-bg); border-color: var(--amber-border); color: var(--amber-text); font-weight: 600; }
.ma-alert-info { background: var(--panel-2); border-color: var(--border); color: var(--text); }

.ma-simple { border: 1px solid var(--border); background: var(--panel-2); border-radius: 12px; padding: 16px 20px; margin: 0 0 18px; }
.ma-simple h2 { margin: 0 0 8px; font-size: 14.5px; }
.ma-simple p { margin: 0; font-size: 14.5px; line-height: 1.65; color: var(--text); }

.ma-extended-moves { border: 1px solid var(--amber-border); background: var(--amber-bg); border-radius: 12px; padding: 14px 18px; margin: 0 0 18px; }
.ma-extended-moves h2 { margin: 0 0 10px; font-size: 14px; }
.ma-extended-list { display: flex; flex-wrap: wrap; gap: 8px; }
.ma-extended-chip { font-size: 13px; padding: 6px 12px; border-radius: 999px; background: var(--panel); border: 1px solid var(--border); font-weight: 600; }
.ma-extended-chip.ma-up { color: var(--green-dark); }
.ma-extended-chip.ma-down { color: #b42318; }

.ma-instruments { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin: 0 0 18px; }
.ma-instrument-card { border: 1px solid var(--border); background: var(--panel); border-radius: 10px; padding: 10px 12px; }
.ma-instrument-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 700; margin-bottom: 4px; }
.ma-instrument-price { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
.ma-instrument-change { font-size: 12.5px; font-weight: 700; margin-top: 2px; }
.ma-up { color: var(--green-dark); }
.ma-down { color: #b42318; }

.ma-signals { margin: 0 0 18px; }
.ma-signals h2 { font-size: 15px; margin: 0 0 10px; }
.ma-signals-list { display: flex; flex-direction: column; gap: 6px; }
.ma-signal-row { display: flex; align-items: baseline; gap: 8px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-soft); background: var(--panel-2); font-size: 13px; flex-wrap: wrap; }
.ma-signal-label { font-weight: 700; min-width: 150px; }
.ma-signal-detail { color: var(--muted); }
.ma-lean-on { border-left: 3px solid var(--green); }
.ma-lean-off { border-left: 3px solid #d9524f; }
.ma-lean-neutral { border-left: 3px solid var(--border); }

.ma-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; margin: 0 0 14px; }
.ma-box { border: 1px solid var(--border); background: var(--panel); border-radius: 12px; padding: 16px 18px; }
.ma-box h2 { margin: 0 0 10px; font-size: 14.5px; }
.ma-box-empty { color: var(--faint); font-size: 13px; margin: 0; line-height: 1.5; }
.ma-earnings-list, .ma-news-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.ma-earnings-list li { font-size: 13.5px; }
.ma-news-list li { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.ma-news-list a { color: var(--text); text-decoration: none; font-weight: 600; }
.ma-news-list a:hover { text-decoration: underline; }
.ma-news-meta { font-size: 11.5px; color: var(--faint); }
.ma-news-general { margin-bottom: 14px; }

.ma-foot { color: var(--faint); font-size: 12px; margin-top: 8px; line-height: 1.5; }
`;
