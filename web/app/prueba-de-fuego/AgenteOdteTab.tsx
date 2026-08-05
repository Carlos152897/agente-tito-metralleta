"use client";

// Agente ODTE — cadena del vencimiento de hoy con los strikes de mayor
// volumen. Calls a la izquierda, strike al centro, puts a la derecha. Ver
// Agente Principal/Proceso 0DTE.md. Puerto del fork Agente0DTE, adaptado como
// pestaña de Prueba de Fuego. Selector de ticker real (SPX/SPY/QQQ/ES/NQ);
// el selector de idioma es solo visual — español fijo, ver zerodteTickers.ts.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChainLine, ZeroDteResult } from "@/lib/zerodte";
import type { AggressorRead } from "@/lib/zerodteFlow";
import { DEFAULT_PARAMS, evaluateEntry, noSetupReason, riskReward } from "@/lib/zerodteStrategy";
import { ZERO_DTE_TICKERS, DEFAULT_ZERO_DTE_TICKER, type ZeroDteTickerId } from "@/lib/zerodteTickers";
import ZeroDteChart from "@/app/components/ZeroDteChart";

const KEY_TICKER = "tito.zeroDte.ticker";

interface FlowState {
  cycles: number;
  contracts: number;
  reads: Record<string, AggressorRead>;
  error?: string;
}

interface EvalState {
  empty?: boolean;
  message?: string;
  error?: string;
  maturedCount?: number;
  meanAbsErrorPct?: number | null;
  biasPct?: number | null;
  bullTouchRate?: number | null;
  bearTouchRate?: number | null;
  closingMeanAbsErrorPts?: number | null;
  closingHitRate?: number | null;
  closingCount?: number;
}

const REFRESH_MS = 60 * 1000;

const nf = new Intl.NumberFormat("en-US");
const num = (v: number | null | undefined) => (v == null ? "—" : nf.format(v));
const dec = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

function pctIn(o: { rangeLow: number; rangeHigh: number }, price: number): number {
  const span = o.rangeHigh - o.rangeLow;
  if (span <= 0) return 50;
  return Math.max(0, Math.min(100, ((price - o.rangeLow) / span) * 100));
}
const rangePos = (o: { rangeLow: number; rangeHigh: number; spot: number }) => pctIn(o, o.spot);
const magnetPos = (o: { rangeLow: number; rangeHigh: number; magnet: number | null }) =>
  o.magnet == null ? 50 : pctIn(o, o.magnet);
const inRange = (o: { rangeLow: number; rangeHigh: number; magnet: number | null }) =>
  o.magnet != null && o.magnet >= o.rangeLow && o.magnet <= o.rangeHigh;

function etTodayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function expirationDays(count = 5): string[] {
  const out = [etTodayStr()];
  const d = new Date(`${etTodayStr()}T12:00:00Z`);
  while (out.length <= count) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function dayLabel(date: string, i: number): string {
  if (i === 0) return "Hoy";
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return `${WEEKDAYS[wd]} ${Number(date.slice(8, 10))}`;
}

function marketOpenNow(): boolean {
  const now = new Date();
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(now);
  if (wd === "Sat" || wd === "Sun") return false;
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0) % 24;
  const m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  const min = h * 60 + m;
  return min >= 570 && min < 960;
}
function etClock(): string {
  return new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
}

const CONFIDENCE: Record<string, string> = { baja: "baja", media: "media", alta: "alta" };

export default function AgenteOdteTab() {
  const [data, setData] = useState<ZeroDteResult | null>(null);
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [evalu, setEvalu] = useState<EvalState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [days] = useState<string[]>(() => expirationDays(5));
  const [selDate, setSelDate] = useState<string>(() => etTodayStr());
  const [selTicker, setSelTicker] = useState<ZeroDteTickerId>(DEFAULT_ZERO_DTE_TICKER);

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY_TICKER);
    if (saved && ZERO_DTE_TICKERS.some((t) => t.id === saved)) setSelTicker(saved as ZeroDteTickerId);
  }, []);

  const pickTicker = useCallback((id: ZeroDteTickerId) => {
    setSelTicker(id);
    window.localStorage.setItem(KEY_TICKER, id);
  }, []);

  const load = useCallback(async (date: string, ticker: ZeroDteTickerId) => {
    setLoading(true);
    setError(null);
    const isToday = date === etTodayStr();

    let flowPromise: Promise<void> = Promise.resolve();
    if (isToday) {
      flowPromise = fetch(`/api/0dte/flow?ticker=${ticker}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => setFlow(j as FlowState))
        .catch(() => setFlow(null));
      fetch(`/api/0dte/eval?ticker=${ticker}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => setEvalu(j as EvalState))
        .catch(() => setEvalu(null));
    } else {
      setFlow(null);
      setEvalu(null);
    }

    try {
      const res = await fetch(
        `/api/0dte?date=${encodeURIComponent(date)}&ticker=${ticker}`, { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json as ZeroDteResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
      setData(null);
    } finally {
      setLoading(false);
      await flowPromise;
    }
  }, []);

  useEffect(() => {
    load(selDate, selTicker);
    if (selDate !== etTodayStr()) return;
    const id = setInterval(() => load(selDate, selTicker), REFRESH_MS);
    return () => clearInterval(id);
  }, [selDate, selTicker, load]);

  const live = useMemo(() => {
    if (!data || !data.isToday || data.spot == null) return null;
    return evaluateEntry(data.spot, data.gex.regime, data.gex.kingStrike, data.gex.flipStrike, DEFAULT_PARAMS);
  }, [data]);

  const prevDir = useRef<string | null>(null);
  const [justChanged, setJustChanged] = useState(false);
  useEffect(() => {
    if (!data?.isToday) { prevDir.current = null; return; }
    const dir = live ? live.direction : "none";
    setJustChanged(prevDir.current !== null && prevDir.current !== dir);
    prevDir.current = dir;
  }, [live, data?.isToday]);

  const maxVol = data
    ? Math.max(1, ...data.lines.flatMap((l) => [l.call?.volume ?? 0, l.put?.volume ?? 0]))
    : 1;

  const spot = data?.spot ?? null;
  const spotAt = data && spot != null ? data.lines.findIndex((l) => l.strike < spot) : -1;

  return (
    <div className="z-wrap">
      <style>{CSS}</style>

      <header className="z-head">
        <div>
          <h1>Agente ODTE</h1>
          <p>
            {selDate === etTodayStr() ? "Vencimiento de hoy" : "Vencimiento futuro"} · los{" "}
            {data ? data.lines.length : "—"} strikes de mayor volumen (top 10 calls + top 10 puts)
          </p>
        </div>
        <div className="z-controls">
          <select
            value={selTicker}
            onChange={(e) => pickTicker(e.target.value as ZeroDteTickerId)}
            aria-label="Ticker"
          >
            {ZERO_DTE_TICKERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}{t.sublabel ? ` (${t.sublabel})` : ""}
              </option>
            ))}
          </select>
          <select defaultValue="es" aria-label="Idioma">
            <option value="es">ES Español</option>
            <option value="en" disabled>EN English (próximamente)</option>
          </select>
          <button onClick={() => load(selDate, selTicker)} disabled={loading}>
            {loading ? "Cargando…" : "Actualizar"}
          </button>
        </div>
      </header>

      <div className="z-daybar">
        <span className="z-daybar-lbl">Vencimiento</span>
        {days.map((d, i) => (
          <button
            key={d}
            className={`z-daychip ${d === selDate ? "z-daychip-on" : ""}`}
            onClick={() => setSelDate(d)}
            disabled={loading && d === selDate}
          >
            {dayLabel(d, i)}<em>{i}DTE</em>
          </button>
        ))}
      </div>

      {data && (
        <div className="z-meta">
          <span><b>{data.ticker}</b></span>
          <span>Spot <b>{dec(spot)}</b></span>
          <span>Vence <b>{data.expiration}</b></span>
          <span>{num(data.contractCount)} contratos en la cadena</span>
          <span className="z-time">
            {new Date(data.asOf).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })} ET
          </span>
          {data.realtimeStrikes > 0 ? (
            <span className="z-fresh" title="Gamma/OI/volumen de MarketSnack sobre los strikes activos; el resto es Schwab (15 min)">
              ⚡ {data.realtimeStrikes} strikes en tiempo real{data.realtimeAgeSec != null ? ` (${data.realtimeAgeSec}s)` : ""}
            </span>
          ) : (
            data.delayed && <span className="z-flag">cadena Schwab (retraso ~15 min)</span>
          )}
        </div>
      )}

      {error && <div className="z-error">{error}</div>}

      {data && !data.isToday && (
        <div className="z-future">
          Vista de cadena a futuro (vence {data.expiration}). Se muestran el ranking por volumen y el
          GEX de ese vencimiento. El panorama de 5 min, los escenarios hasta el cierre y el agresor
          solo aplican al 0DTE de hoy.
        </div>
      )}

      {data?.isToday && (
        <section className={`z-live ${live ? `z-live-${live.direction}` : "z-live-none"} ${justChanged ? "z-live-changed" : ""}`}>
          <header>
            <h2>Mejor trade ahora</h2>
            {justChanged && <span className="z-live-alert">⚡ el setup cambió</span>}
            <span className="z-live-clock">{marketOpenNow() ? `en vivo · ${etClock()} ET` : "mercado cerrado"}</span>
          </header>
          {!marketOpenNow() ? (
            <p className="z-live-msg">
              Fuera de sesión (9:30-16:00 ET). Durante el mercado abierto, el agente busca el mejor
              trade en vivo y lo actualiza cada minuto.
            </p>
          ) : live ? (
            <>
              <div className="z-live-row">
                <span className={`z-live-dir z-dir-${live.direction}`}>
                  {live.direction === "long" ? "▲ LONG" : "▼ SHORT"}
                </span>
                <div><span className="z-sum-lbl">Entrada (ahora)</span><b>{dec(live.entry)}</b></div>
                <div><span className="z-sum-lbl">Objetivo (imán)</span><b>{live.target}</b></div>
                <div><span className="z-sum-lbl">Stop</span><b>{dec(live.stop)}</b></div>
                <div><span className="z-sum-lbl">Riesgo / Beneficio</span><b>{riskReward(live).toFixed(1)} : 1</b></div>
              </div>
              <p className="z-live-reason">{live.reason}</p>
            </>
          ) : (
            <p className="z-live-msg">
              Sin setup ahora — {noSetupReason(data.spot, data.gex.regime, data.gex.kingStrike, DEFAULT_PARAMS)}
            </p>
          )}
          <p className="z-outlook-caveat">
            Se recalcula cada minuto con el GEX en vivo. El agente calcula y muestra; tú decides y
            ejecutas. No es una orden ni un consejo.
          </p>
        </section>
      )}

      {data?.outlook && (
        <section className={`z-outlook z-lean-${data.outlook.lean}`}>
          <div className="z-outlook-top">
            <span className="z-outlook-tag">Próximos ~{data.outlook.horizonMinutes} min</span>
            <span className={`z-lean-chip z-lean-chip-${data.outlook.lean}`}>
              {data.outlook.lean === "alcista" ? "▲ sesgo alcista"
                : data.outlook.lean === "bajista" ? "▼ sesgo bajista"
                : "▬ lateral"}
            </span>
            <span className="z-conf">confianza {CONFIDENCE[data.outlook.confidence] ?? data.outlook.confidence}</span>
          </div>
          <p className="z-outlook-head">{data.outlook.headline}</p>
          <div className="z-outlook-range">
            <span>{dec(data.outlook.rangeLow)}</span>
            <div className="z-range-bar">
              <i className="z-range-fill" />
              <b className="z-range-now" style={{ left: `${rangePos(data.outlook)}%` }}>{dec(data.outlook.spot)}</b>
              {data.outlook.magnet != null && inRange(data.outlook) && (
                <span className="z-range-magnet" style={{ left: `${magnetPos(data.outlook)}%` }} title="Imán (mayor gamma)">
                  {data.outlook.magnet}
                </span>
              )}
            </div>
            <span>{dec(data.outlook.rangeHigh)}</span>
          </div>
          <p className="z-outlook-detail">{data.outlook.detail}</p>
          {(data.outlook.charmNote || data.outlook.vannaNote) && (
            <div className="z-flow">
              {data.outlook.charmNote && (
                <p className="z-flow-line">
                  <span className="z-flow-tag">CHARM</span>{" "}
                  {data.outlook.charmNote.replace(/^Charm \d+%: /, "")}
                  {data.outlook.charmIntensity != null && (
                    <span className="z-flow-bar"><i style={{ width: `${data.outlook.charmIntensity * 100}%` }} /></span>
                  )}
                </p>
              )}
              {data.outlook.vannaNote && (
                <p className="z-flow-line">
                  <span className="z-flow-tag">VANNA</span> {data.outlook.vannaNote.replace(/^Vanna: /, "")}
                </p>
              )}
            </div>
          )}
          <p className="z-outlook-caveat">
            Estimación probabilística a partir del posicionamiento de opciones — el rango es ~68%
            (±1σ). No es una certeza ni un consejo de inversión.
          </p>
        </section>
      )}

      {data && (
        <div className="z-summary">
          <div className="z-sum-card z-sum-call">
            <span className="z-sum-lbl">Call de mayor volumen</span>
            <b>{data.summary.maxCallStrike ?? "—"}</b>
            <span className="z-sum-sub">{num(data.summary.maxCallVolume)} contratos</span>
          </div>
          <div className="z-sum-card z-sum-put">
            <span className="z-sum-lbl">Put de mayor volumen</span>
            <b>{data.summary.maxPutStrike ?? "—"}</b>
            <span className="z-sum-sub">{num(data.summary.maxPutVolume)} contratos</span>
          </div>
          <div className="z-sum-card">
            <span className="z-sum-lbl">Ratio Put / Call</span>
            <b>{data.summary.putCallRatio?.toFixed(2) ?? "—"}</b>
            <span className="z-sum-sub">{num(data.summary.putVolume)} puts · {num(data.summary.callVolume)} calls</span>
          </div>
        </div>
      )}

      {data && data.gex.n > 0 && (
        <section className={`z-gex z-gex-${data.gex.regime}`}>
          <header>
            <h2>Gamma del día (GEX)</h2>
            <span>{data.gex.n} strikes · gamma real en {(data.gex.realGammaShare * 100).toFixed(0)}% de los contratos</span>
          </header>
          <div className="z-gex-grid">
            <div>
              <span className="z-sum-lbl">Régimen</span>
              <b>{data.gex.regime === "positive" ? "γ positiva" : "γ negativa"}</b>
              <span className="z-sum-sub">
                {data.gex.regime === "positive"
                  ? "los dealers operan CONTRA el movimiento → el precio tiende a revertir hacia el imán"
                  : "los dealers operan A FAVOR → los movimientos se amplifican"}
              </span>
            </div>
            <div>
              <span className="z-sum-lbl">Imán (mayor gamma)</span>
              <b>{data.gex.kingStrike ?? "—"}</b>
              <span className="z-sum-sub">strike que más ancla al precio</span>
            </div>
            <div>
              <span className="z-sum-lbl">Zona de inversión</span>
              <b>{data.gex.flipStrike ?? "—"}</b>
              <span className="z-sum-sub">
                {data.gex.flipStrike == null ? "el GEX no cambia de signo en la ventana" : "cruzarlo cambia el régimen"}
              </span>
            </div>
          </div>
        </section>
      )}

      {data?.closing && (
        <section className={`z-close z-close-${data.closing.phase === "live" ? data.closing.confidence : data.closing.phase}`}>
          <div className="z-close-top">
            <span className="z-close-tag">⏱ Cierre 4:00pm ET</span>
            {data.closing.phase === "live" && (
              <>
                <span className="z-close-min">faltan {data.closing.minutesLeft.toFixed(0)} min</span>
                <span className="z-conf">confianza {CONFIDENCE[data.closing.confidence] ?? data.closing.confidence}</span>
              </>
            )}
            {data.closing.phase === "pending" && <span className="z-close-min">se calcula a las 3:00pm ET</span>}
            {data.closing.phase === "final" && <span className="z-close-min">fijado · sesión {data.closing.fromDate ?? ""}</span>}
          </div>
          <div className="z-close-main">
            <div>
              <span className="z-sum-lbl">Strike de cierre más probable</span>
              <b className="z-close-strike">{data.closing.strike ?? "—"}</b>
            </div>
            {data.closing.phase === "live" && (
              <div className="z-close-range">
                <span className="z-sum-lbl">Rango probable</span>
                <b>{data.closing.rangeLow} – {data.closing.rangeHigh}</b>
                <span className="z-sum-sub">±{data.closing.sigma.toFixed(1)} pts de margen</span>
              </div>
            )}
          </div>
          <p className="z-close-note">{data.closing.note}</p>
          {evalu?.closingCount != null && evalu.closingCount > 0 && (
            <p className="z-close-acc">
              Historial: en {evalu.closingCount} cierre{evalu.closingCount === 1 ? "" : "s"} medido{evalu.closingCount === 1 ? "" : "s"}, error medio {evalu.closingMeanAbsErrorPts?.toFixed(1) ?? "—"} pts
              {evalu.closingHitRate != null && ` · acierto (±5 pts) ${evalu.closingHitRate.toFixed(0)}%`}
            </p>
          )}
          <p className="z-outlook-caveat">
            Estimación del efecto de anclaje de los dealers, no certeza. Una noticia o un cambio de
            régimen puede romperlo. Tú decides.
          </p>
        </section>
      )}

      {data?.forecast && (
        <section className="z-fc">
          <header>
            <h2>Escenarios hasta el cierre</h2>
            {data.forecast.calibShiftPct !== 0 && (
              <span className="z-calib-chip" title="El objetivo base se corrige según el sesgo histórico medido en 'Precisión del modelo'">
                🧠 auto-ajustado {data.forecast.calibShiftPct > 0 ? "+" : ""}{data.forecast.calibShiftPct.toFixed(2)}%
              </span>
            )}
            <span>
              {data.forecast.hoursToClose.toFixed(1)} h restantes · IV {(data.forecast.iv * 100).toFixed(1)}% ·
              1σ = ±{data.forecast.sigma.toFixed(1)} pts ({data.forecast.sigmaPct.toFixed(2)}%)
            </span>
          </header>

          {data.forecast.caveat && <div className="z-fc-caveat">{data.forecast.caveat}</div>}

          <div className="z-fc-grid">
            {data.forecast.scenarios.map((s) => (
              <div key={s.kind} className={`z-fc-card z-fc-${s.kind}`}>
                <span className="z-sum-lbl">{s.kind === "bull" ? "Alcista" : s.kind === "bear" ? "Bajista" : "Base"}</span>
                <b>{s.target.toFixed(2)}</b>
                <span className="z-fc-pct">{s.changePct >= 0 ? "+" : ""}{s.changePct.toFixed(2)}%</span>
                <div className="z-fc-prob">
                  <i style={{ width: `${s.probTouch * 100}%` }} />
                  <span>{(s.probTouch * 100).toFixed(0)}% de tocarlo</span>
                </div>
                <p>{s.reason}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {data && (
        <p className="z-caveat">
          El volumen dice dónde hay actividad; el agresor dice de qué lado. VENTA de calls es
          resistencia y VENTA de puts es soporte; COMPRA es direccional. El número pequeño es cuántos
          trades sustentan el porcentaje — desconfía de los que tengan pocos. El agresor se acumula
          desde que arrancó el agente, así que gana fiabilidad conforme avanza la sesión.
        </p>
      )}

      {data && (
        <section className="z-chart-card">
          <div className="z-chart-head">Gráfica de {data.ticker} con niveles del agente</div>
          <ZeroDteChart
            ticker={selTicker}
            reloadKey={data.asOf}
            maxCall={data.summary.maxCallStrike}
            maxPut={data.summary.maxPutStrike}
            magnet={data.gex.kingStrike}
            flip={data.gex.flipStrike}
            target={data.closing?.strike ?? null}
            spot={data.spot}
          />
          <p className="z-chart-legend">
            <b style={{ color: "#5b21b6" }}>Violeta</b> = strike de mayor volumen (call/put) ·{" "}
            <b style={{ color: "#374151" }}>gris</b> = imán del GEX ·{" "}
            <b style={{ color: "#9a3412" }}>naranja</b> = flip gamma (anclaje ↔ aceleración) ·{" "}
            <b style={{ color: "#92400e" }}>amarillo</b> = target de cierre ·{" "}
            <b style={{ color: "#1d4ed8" }}>azul punteado</b> = precio actual
          </p>
        </section>
      )}

      {data && (
        <table className="z-chain">
          <thead>
            <tr className="z-side">
              <th colSpan={4} className="z-call">C A L L S</th>
              <th className="z-mid" />
              <th colSpan={4} className="z-put">P U T S</th>
            </tr>
            <tr className="z-spotrow-hidden">
              <th colSpan={9} className="z-aggr-note">
                {!data.isToday
                  ? "Agresor solo disponible en el 0DTE de hoy"
                  : flow?.error
                    ? `Agresor no disponible: ${flow.error}`
                    : flow
                      ? `Agresor acumulado en ${flow.cycles} ciclo${flow.cycles === 1 ? "" : "s"} · ${flow.contracts} contratos con muestra`
                      : "Cargando agresor…"}
              </th>
            </tr>
            <tr>
              <th>Agresor</th>
              <th className="z-vol">Volumen</th>
              <th>OI</th>
              <th>Delta</th>
              <th className="z-mid">Strike</th>
              <th>Delta</th>
              <th>OI</th>
              <th className="z-vol">Volumen</th>
              <th>Agresor</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line, i) => (
              <Fragment key={line.strike}>
                {i === spotAt && spot != null && (
                  <tr className="z-spotrow">
                    <td colSpan={9} className="z-spotband">
                      <span className="z-spot-flag">Precio actual</span>
                      <b>{dec(spot)}</b>
                      <span className="z-spot-hint">cae entre strikes — no es un contrato, por eso no tiene volumen ni OI</span>
                    </td>
                  </tr>
                )}
                <Line
                  line={line}
                  maxVol={maxVol}
                  spot={spot}
                  topCall={line.strike === data.summary.maxCallStrike}
                  topPut={line.strike === data.summary.maxPutStrike}
                  isMagnet={line.strike === data.gex.kingStrike}
                  callAggr={flow?.reads?.[`call:${line.strike}`] ?? null}
                  putAggr={flow?.reads?.[`put:${line.strike}`] ?? null}
                />
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {evalu && !evalu.error && (
        <section className="z-eval">
          <header>
            <h2>Precisión del modelo</h2>
            <span>
              {evalu.empty || !evalu.maturedCount
                ? "aún sin sesiones cerradas para medir"
                : `${evalu.maturedCount} sesión${evalu.maturedCount === 1 ? "" : "es"} evaluada${evalu.maturedCount === 1 ? "" : "s"}`}
            </span>
          </header>
          {evalu.empty || !evalu.maturedCount ? (
            <p className="z-eval-wait">
              El modelo guarda su pronóstico de hoy y lo contrasta contra el cierre real. La primera
              medición aparece mañana; la fiabilidad crece con los días.
            </p>
          ) : (
            <div className="z-eval-grid">
              <div>
                <span className="z-sum-lbl">Error medio del base</span>
                <b>{evalu.meanAbsErrorPct?.toFixed(2) ?? "—"}%</b>
              </div>
              <div>
                <span className="z-sum-lbl">Sesgo</span>
                <b>{evalu.biasPct == null ? "—" : `${evalu.biasPct >= 0 ? "+" : ""}${evalu.biasPct.toFixed(2)}%`}</b>
                <span className="z-sum-sub">
                  {evalu.biasPct == null ? "" : evalu.biasPct >= 0 ? "el precio cierra por encima del base" : "por debajo del base"}
                </span>
              </div>
              <div>
                <span className="z-sum-lbl">Alcista tocado</span>
                <b>{evalu.bullTouchRate?.toFixed(0) ?? "—"}%</b>
              </div>
              <div>
                <span className="z-sum-lbl">Bajista tocado</span>
                <b>{evalu.bearTouchRate?.toFixed(0) ?? "—"}%</b>
              </div>
            </div>
          )}
        </section>
      )}

      <p className="z-foot">
        Se actualiza sola cada minuto. Fondo sombreado = contrato ITM. La barra bajo el volumen es
        relativa al mayor de la tabla. Fila amarilla = muro de mayor volumen (MAX CALL/PUT); 🧲 gris =
        imán del GEX.
      </p>
    </div>
  );
}

function Line({
  line, maxVol, spot, topCall, topPut, isMagnet, callAggr, putAggr,
}: {
  line: ChainLine;
  maxVol: number;
  spot: number | null;
  topCall: boolean;
  topPut: boolean;
  isMagnet: boolean;
  callAggr: AggressorRead | null;
  putAggr: AggressorRead | null;
}) {
  const { call, put, strike, from } = line;
  const callItm = spot != null && strike < spot;
  const putItm = spot != null && strike > spot;
  const rankedCall = from === "call" || from === "both";
  const rankedPut = from === "put" || from === "both";

  return (
    <tr className={`${topCall || topPut ? "z-toprow" : ""} ${isMagnet ? "z-magnetrow" : ""}`}>
      <Aggr read={callAggr} itm={callItm} />
      <td className={`z-vol ${callItm ? "z-itm" : ""} ${rankedCall ? "z-ranked" : ""} ${topCall ? "z-top z-top-call" : ""}`}>
        {topCall && <em className="z-tag">MAX CALL</em>}
        <span>{num(call?.volume)}</span>
        <i style={{ width: `${((call?.volume ?? 0) / maxVol) * 100}%` }} className="z-bar z-bar-call" />
      </td>
      <td className={callItm ? "z-itm" : ""}>{num(call?.openInterest)}</td>
      <td className={callItm ? "z-itm" : ""}>{dec(call?.greeks?.delta)}</td>

      <td className={`z-mid ${isMagnet ? "z-magnet" : ""}`}>
        {isMagnet && <em className="z-magnet-tag" title="imán del GEX">🧲</em>}
        {strike}
      </td>

      <td className={putItm ? "z-itm" : ""}>{dec(put?.greeks?.delta)}</td>
      <td className={putItm ? "z-itm" : ""}>{num(put?.openInterest)}</td>
      <td className={`z-vol ${putItm ? "z-itm" : ""} ${rankedPut ? "z-ranked" : ""} ${topPut ? "z-top z-top-put" : ""}`}>
        {topPut && <em className="z-tag">MAX PUT</em>}
        <span>{num(put?.volume)}</span>
        <i style={{ width: `${((put?.volume ?? 0) / maxVol) * 100}%` }} className="z-bar z-bar-put" />
      </td>
      <Aggr read={putAggr} itm={putItm} />
    </tr>
  );
}

/** Celda de agresor. Vacía si no hubo muestra suficiente. */
function Aggr({ read, itm }: { read: AggressorRead | null; itm: boolean }) {
  if (!read) return <td className={`z-aggr ${itm ? "z-itm" : ""}`}>—</td>;
  const label =
    read.side === "compra" ? "COMPRA" :
    read.side === "venta" ? "VENTA" :
    read.side === "mid" ? "MID" : "mixto";
  return (
    <td className={`z-aggr z-aggr-${read.side} ${itm ? "z-itm" : ""}`} title={read.meaning}>
      <b>{label}</b> {(read.pct * 100).toFixed(0)}%
      <small>{read.trades}</small>
    </td>
  );
}

const CSS = `
.z-wrap { max-width: 1440px; margin: 0 auto; padding: 0 0 40px; font-size: 15px; }
.z-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.z-head h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: -0.2px; }
.z-head p { margin: 0; color: var(--muted); font-size: 14px; }
.z-controls { display: flex; gap: 8px; }
.z-controls select, .z-controls button {
  font: inherit; padding: 8px 14px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--panel); color: var(--text); cursor: pointer;
}
.z-controls button { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.z-controls button:disabled { opacity: .6; cursor: default; }

.z-meta { display: flex; gap: 18px; flex-wrap: wrap; align-items: center;
  margin: 20px 0 12px; color: var(--muted); font-size: 14px; }
.z-meta b { color: var(--text); }
.z-time { margin-left: auto; font-variant-numeric: tabular-nums; }
.z-fresh { background: var(--green-bg); border: 1px solid var(--green);
  color: var(--green-dark); padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.z-flag { background: var(--amber-bg); border: 1px solid var(--amber-border);
  color: var(--amber-text); padding: 2px 8px; border-radius: 999px; font-size: 12px; }
.z-error { background: var(--red-bg); border: 1px solid var(--red-soft);
  color: #7a271a; padding: 12px 14px; border-radius: 8px; margin: 16px 0; }

.z-chain { width: 100%; border-collapse: collapse; background: var(--panel);
  border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
  font-variant-numeric: tabular-nums; }
.z-chain th, .z-chain td { padding: 9px 12px; text-align: right; font-size: 14.5px;
  border-bottom: 1px solid var(--border-soft); }
.z-chain thead th { background: var(--panel-2); color: var(--muted);
  font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.z-chain tr.z-side th { font-size: 12px; letter-spacing: .18em; padding: 8px; }
.z-side .z-call { color: var(--green-dark); background: var(--green-bg); }
.z-side .z-put { color: #b42318; background: var(--red-bg); }

.z-mid { text-align: center !important; font-weight: 700; background: var(--panel-2);
  border-left: 1px solid var(--border); border-right: 1px solid var(--border); }
.z-itm { background: rgba(47,107,255,.05); }
.z-vol { position: relative; font-weight: 600; }
.z-ranked span { color: var(--text); }
.z-vol span { position: relative; z-index: 1; }
.z-bar { position: absolute; bottom: 0; height: 4px; display: block; border-radius: 2px; }
.z-bar-call { right: 0; background: var(--call); }
.z-bar-put { left: 0; background: var(--put); }

.z-spotband { background: var(--accent-dim);
  border-top: 2px solid var(--accent); border-bottom: 2px solid var(--accent);
  text-align: center !important; padding: 7px 10px !important; }
.z-spot-flag { font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
  font-weight: 700; color: #fff; background: var(--accent); padding: 2px 8px;
  border-radius: 999px; vertical-align: middle; }
.z-spotband b { color: var(--accent); font-size: 15px; font-weight: 700;
  margin: 0 8px; vertical-align: middle; font-variant-numeric: tabular-nums; }
.z-spot-hint { color: var(--muted); font-size: 11px; font-weight: 400; vertical-align: middle; }

.z-foot { color: var(--faint); font-size: 12px; margin-top: 14px; }

.z-chart-card { border: 1px solid var(--border); background: var(--panel);
  border-radius: 12px; padding: 14px 16px; margin: 0 0 16px; }
.z-chart-head { font-size: 14px; font-weight: 500; color: var(--text); margin-bottom: 8px; }
.z-chart-wrap { width: 100%; overflow-x: auto; }
.z-chart-legend { margin: 8px 0 0; font-size: 11.5px; color: var(--muted); line-height: 1.5; }
.z-chart-msg { padding: 28px 12px; text-align: center; color: var(--faint); font-size: 13px; }

.z-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: var(--space-md); margin: 4px 0 16px; }
.z-sum-card { background: var(--panel); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
.z-sum-card b { font-size: 24px; letter-spacing: -0.4px; font-variant-numeric: tabular-nums; }
.z-sum-lbl { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.z-sum-sub { font-size: 13px; color: var(--faint); font-variant-numeric: tabular-nums; }
.z-sum-call { border-left: 3px solid var(--call); }
.z-sum-call b { color: var(--green-dark); }
.z-sum-put { border-left: 3px solid var(--put); }
.z-sum-put b { color: #b42318; }

.z-caveat { background: var(--amber-bg); border: 1px solid var(--amber-border);
  color: var(--amber-text); padding: 10px 14px; border-radius: 8px;
  font-size: 12.5px; line-height: 1.5; margin: 0 0 16px; }

.z-close { border: 2px solid var(--accent); background: var(--accent-dim);
  border-radius: 12px; padding: 18px 20px; margin: 0 0 16px; }
.z-close-baja { border-color: var(--border); background: var(--panel-2); }
.z-close-pending { border-color: var(--border); border-style: dashed; background: var(--panel-2); }
.z-close-pending .z-close-strike { color: var(--faint); }
.z-close-final { border-color: var(--border); background: var(--panel-2); }
.z-close-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.z-close-tag { font-size: 12px; font-weight: 800; letter-spacing: .03em; color: var(--accent); }
.z-close-min { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.z-close-main { display: flex; gap: 32px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 10px; }
.z-close-main > div { display: flex; flex-direction: column; gap: 2px; }
.z-close-strike { font-size: 34px; letter-spacing: -0.6px; color: var(--accent);
  font-variant-numeric: tabular-nums; line-height: 1.05; }
.z-close-range b { font-size: 18px; font-variant-numeric: tabular-nums; }
.z-close-note { margin: 0 0 6px; font-size: 12.5px; color: var(--text); line-height: 1.5; }
.z-close-acc { margin: 0 0 8px; font-size: 12px; color: var(--muted);
  padding: 6px 10px; background: var(--panel); border-radius: 6px; display: inline-block; }
.z-close-acc b { color: var(--text); }

.z-calib-chip { font-size: 11px; font-weight: 700; background: var(--accent-dim);
  color: var(--accent); padding: 2px 9px; border-radius: 999px; }

.z-live { border: 2px solid var(--border); border-radius: 12px; padding: 16px 18px;
  margin: 0 0 16px; background: var(--panel); }
.z-live-long { border-color: var(--green); background: var(--green-bg); }
.z-live-short { border-color: var(--red-soft); background: var(--red-bg); }
.z-live-none { border-color: var(--border); background: var(--panel-2); }
.z-live-changed { box-shadow: 0 0 0 3px var(--amber-bg); }
.z-live header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.z-live h2 { margin: 0; font-size: 16px; }
.z-live-alert { font-size: 11px; font-weight: 700; background: var(--amber-bg);
  color: var(--amber-text); border: 1px solid var(--amber-border); padding: 2px 8px; border-radius: 999px; }
.z-live-clock { margin-left: auto; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.z-live-row { display: flex; align-items: flex-end; gap: 22px; flex-wrap: wrap; margin-bottom: 8px; }
.z-live-row > div { display: flex; flex-direction: column; gap: 2px; }
.z-live-row b { font-size: 23px; letter-spacing: -0.3px; font-variant-numeric: tabular-nums; }
.z-live-dir { font-size: 18px; font-weight: 700; }
.z-dir-long { color: var(--green-dark); }
.z-dir-short { color: #b42318; }
.z-live-reason { margin: 0 0 6px; font-size: 12.5px; color: var(--text); line-height: 1.45; }
.z-live-msg { margin: 0 0 6px; font-size: 13px; color: var(--muted); line-height: 1.5; }

.z-eval { border: 1px solid var(--border); background: var(--panel);
  border-radius: 10px; padding: 16px; margin: 0 0 16px; }
.z-eval header { display: flex; justify-content: space-between; align-items: baseline;
  gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.z-eval h2 { margin: 0; font-size: 15px; }
.z-eval header span { color: var(--muted); font-size: 12px; }
.z-eval-wait { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
.z-eval-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-md); }
.z-eval-grid > div { display: flex; flex-direction: column; gap: 2px; }
.z-eval-grid b { font-size: 20px; letter-spacing: -0.3px; font-variant-numeric: tabular-nums; }

.z-aggr { font-size: 11px; white-space: nowrap; color: var(--faint); }
.z-aggr b { font-size: 10.5px; letter-spacing: .03em; }
.z-aggr small { display: inline-block; margin-left: 4px; font-size: 9.5px;
  color: var(--faint); opacity: .8; }
.z-aggr-compra { color: var(--green-dark); }
.z-aggr-venta { color: #b42318; }
.z-aggr-mixto, .z-aggr-mid { color: var(--muted); }
.z-aggr-note { text-align: center !important; font-weight: 500 !important;
  text-transform: none !important; letter-spacing: 0 !important;
  font-size: 11px !important; color: var(--muted) !important;
  background: var(--panel) !important; padding: 6px !important; }

.z-daybar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 4px 0 16px; }
.z-daybar-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
  color: var(--muted); font-weight: 600; margin-right: 4px; }
.z-daychip { display: inline-flex; flex-direction: column; align-items: center; gap: 1px;
  font: inherit; font-size: 13px; padding: 6px 14px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--border); background: var(--panel); color: var(--text); line-height: 1.2; }
.z-daychip em { font-style: normal; font-size: 10px; color: var(--faint); letter-spacing: .03em; }
.z-daychip:hover { border-color: var(--border); background: var(--panel-2); }
.z-daychip-on { border: 2px solid var(--accent); color: var(--accent); font-weight: 600; padding: 5px 13px; }
.z-daychip-on em { color: var(--accent); }

.z-future { background: var(--amber-bg); border: 1px solid var(--amber-border);
  color: var(--amber-text); padding: 10px 14px; border-radius: 8px; margin: 0 0 16px;
  font-size: 12.5px; line-height: 1.5; }

.z-outlook { border: 1px solid var(--border); border-left-width: 4px; background: var(--panel);
  border-radius: 12px; padding: 18px 20px; margin: 0 0 16px; }
.z-lean-alcista { border-left-color: var(--green); }
.z-lean-bajista { border-left-color: var(--red); }
.z-lean-lateral { border-left-color: var(--muted); }
.z-outlook-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.z-outlook-tag { font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--muted); font-weight: 600; }
.z-lean-chip { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
.z-lean-chip-alcista { background: var(--green-bg); color: var(--green-dark); }
.z-lean-chip-bajista { background: var(--red-bg); color: #b42318; }
.z-lean-chip-lateral { background: var(--panel-2); color: var(--muted); }
.z-conf { margin-left: auto; font-size: 11px; color: var(--faint); }
.z-outlook-head { margin: 0 0 14px; font-size: 20px; font-weight: 700; letter-spacing: -0.3px;
  line-height: 1.35; font-variant-numeric: tabular-nums; }
.z-outlook-range { display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
  font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.z-range-bar { position: relative; flex: 1; height: 30px; }
.z-range-fill { position: absolute; top: 12px; left: 0; right: 0; height: 6px;
  background: linear-gradient(90deg, var(--red-bg), var(--panel-2), var(--green-bg));
  border-radius: 3px; }
.z-range-now { position: absolute; top: 0; transform: translateX(-50%); font-size: 12px;
  font-weight: 700; color: var(--accent); white-space: nowrap;
  background: var(--panel); padding: 0 4px; border-radius: 4px; }
.z-range-now::after { content: ""; position: absolute; left: 50%; top: 18px; width: 2px; height: 12px;
  background: var(--accent); transform: translateX(-50%); }
.z-range-magnet { position: absolute; bottom: -2px; transform: translateX(-50%); font-size: 10px;
  color: var(--amber-text); background: var(--amber-bg); padding: 1px 5px; border-radius: 4px;
  border: 1px solid var(--amber-border); white-space: nowrap; }
.z-outlook-detail { margin: 0 0 8px; font-size: 13px; color: var(--text); line-height: 1.5; }
.z-flow { display: flex; flex-direction: column; gap: 5px; margin: 0 0 10px;
  padding: 8px 10px; background: var(--panel-2); border-radius: 8px; }
.z-flow-line { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.45;
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.z-flow-tag { font-size: 9.5px; font-weight: 700; letter-spacing: .06em; padding: 2px 6px;
  border-radius: 4px; background: var(--accent-dim); color: var(--accent); }
.z-flow-bar { display: inline-block; width: 70px; height: 5px; border-radius: 3px;
  background: var(--border); position: relative; overflow: hidden; }
.z-flow-bar i { position: absolute; inset: 0 auto 0 0; background: var(--accent); }
.z-outlook-caveat { margin: 0; font-size: 11.5px; color: var(--faint); line-height: 1.45; }

.z-gex { border: 1px solid var(--border); background: var(--panel);
  border-radius: 10px; padding: 16px; margin: 0 0 16px; border-left-width: 3px; }
.z-gex-positive { border-left-color: var(--green); }
.z-gex-negative { border-left-color: var(--red); }
.z-gex header { display: flex; justify-content: space-between; align-items: baseline;
  gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.z-gex h2 { margin: 0; font-size: 15px; }
.z-gex header span { color: var(--muted); font-size: 12px; }
.z-gex-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--space-md); }
.z-gex-grid > div { display: flex; flex-direction: column; gap: 2px; }
.z-gex-grid b { font-size: 20px; letter-spacing: -0.3px; font-variant-numeric: tabular-nums; }
.z-gex-positive .z-gex-grid > div:first-child b { color: var(--green-dark); }
.z-gex-negative .z-gex-grid > div:first-child b { color: #b42318; }
.z-gex-grid .z-sum-sub { line-height: 1.45; }

.z-fc { border: 1px solid var(--border); background: var(--panel);
  border-radius: 10px; padding: 16px; margin: 0 0 16px; }
.z-fc header { display: flex; justify-content: space-between; align-items: baseline;
  gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.z-fc h2 { margin: 0; font-size: 15px; }
.z-fc header span { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.z-fc-caveat { background: var(--amber-bg); border: 1px solid var(--amber-border);
  color: var(--amber-text); padding: 8px 12px; border-radius: 6px;
  font-size: 12.5px; margin-bottom: 12px; }
.z-fc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-md); }
.z-fc-card { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 3px; background: var(--panel-2); }
.z-fc-card b { font-size: 22px; letter-spacing: -0.4px; font-variant-numeric: tabular-nums; }
.z-fc-card p { margin: 6px 0 0; font-size: 11.5px; color: var(--muted); line-height: 1.45; }
.z-fc-pct { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.z-fc-bull { border-left: 3px solid var(--green); }
.z-fc-bull b, .z-fc-bull .z-fc-pct { color: var(--green-dark); }
.z-fc-bear { border-left: 3px solid var(--red); }
.z-fc-bear b, .z-fc-bear .z-fc-pct { color: #b42318; }
.z-fc-base { border-left: 3px solid var(--accent); }
.z-fc-base b, .z-fc-base .z-fc-pct { color: var(--accent); }
.z-fc-prob { position: relative; margin-top: 8px; height: 16px;
  background: var(--border-soft); border-radius: 4px; overflow: hidden; }
.z-fc-prob i { position: absolute; inset: 0 auto 0 0; background: var(--accent-dim); }
.z-fc-prob span { position: relative; z-index: 1; font-size: 10.5px; line-height: 16px;
  padding-left: 6px; color: var(--text); font-weight: 600; }

.z-toprow td { background: #ffeeba; }
.z-magnet { background: #d1d5db !important; }
.z-magnetrow td:not(.z-magnet) { background: #eceef1; }
.z-magnet-tag { font-style: normal; margin-right: 3px; font-size: 11px; }
.z-top { position: relative; }
.z-top span { font-weight: 800; font-size: 14px; }
.z-top-call span { color: var(--green-dark); }
.z-top-put span { color: #b42318; }
.z-tag { position: absolute; top: 50%; transform: translateY(-50%);
  font-size: 9px; font-style: normal; font-weight: 700; letter-spacing: .06em;
  padding: 2px 5px; border-radius: 4px; white-space: nowrap; }
.z-top-call .z-tag { left: 8px; background: var(--green-bg); color: var(--green-dark); }
.z-top-put .z-tag { left: 8px; background: var(--red-bg); color: #b42318; }
.z-top-call span { padding-left: 4px; }
.z-toprow .z-bar { height: 5px; }
`;
