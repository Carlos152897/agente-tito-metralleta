"use client";

// Panel derecho de VisionFutura (Carlos, 29-oct-2026, con captura de referencia):
//   - "VIX · SPY · QQQ": precio del día con su Imán + (azul) e Imán − (rojo) grabados por minuto,
//     con la misma ventana de hora que la gráfica principal (zoom incluido).
//   - "Vigía tecnológico": las 11 tecnológicas grandes y hacia dónde queda su Imán + mayor.
// Datos: /api/vision-futura/contexto (lib/visionFuturaContextData.ts).

import { useEffect, useRef, useState } from "react";
import {
  TECH_WEIGHTS, stepAt, techReading,
  type TechCompany, type TechIndex, type TechPoint,
} from "@/lib/visionFuturaContext";
import type { ContextPayload, ContextSymbolView } from "@/lib/visionFuturaContextData";

const PRICE = "#e5e9f2";
const MAG_POS = "#7aa2ff";
const MAG_NEG = "#f97066";
const UP = "#12b76a";
const DOWN = "#a855f7"; // mismo morado del posicionamiento (abajo)
const GRID = "#263049";

const LIVE_MS = 30_000;

type Measure = "count" | "balance" | "pull";
const MEASURES: { key: Measure; label: string }[] = [
  { key: "count", label: "Conteo de imanes" },
  { key: "balance", label: "Balance ponderado" },
  { key: "pull", label: "Imán mayor ponderado" },
];

const hm = (sec: number) =>
  new Date(sec * 1000).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const fx = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)} %`;

function nyOffset(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${dateStr}T16:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-05:00";
}

/** Misma ventana que la gráfica principal: sesión 9:30–16:00, o los últimos N min con 8% de aire. */
function windowOf(date: string, lastSec: number, zoomMinutes: number | null): { open: number; close: number } {
  const off = nyOffset(date);
  const sOpen = Date.parse(`${date}T09:30:00${off}`) / 1000;
  const sClose = Date.parse(`${date}T16:00:00${off}`) / 1000;
  if (!zoomMinutes) return { open: sOpen, close: sClose };
  const z = zoomMinutes * 60;
  const close = Math.min(sClose, Math.max(sOpen + z, lastSec + z * 0.08));
  return { open: Math.max(sOpen, close - z), close };
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(240, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

interface Props {
  /** Zoom de la gráfica principal (null = todo el día). */
  zoomMinutes: number | null;
  /** En "Repetir sesión": día y segundo hasta donde mostrar. */
  replayDate?: string | null;
  untilSec?: number | null;
}

export default function VisionFuturaContextPanel({ zoomMinutes, replayDate, untilSec }: Props) {
  const [data, setData] = useState<ContextPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [index, setIndex] = useState<TechIndex>("SPX");
  const [measure, setMeasure] = useState<Measure>("count");

  useEffect(() => {
    try {
      setHidden(localStorage.getItem("visionary.visionFutura.ctxHidden") === "1");
      const ix = localStorage.getItem("visionary.visionFutura.techIndex");
      if (ix === "SPX" || ix === "NDX") setIndex(ix);
      const ms = localStorage.getItem("visionary.visionFutura.techMeasure");
      if (ms === "count" || ms === "balance" || ms === "pull") setMeasure(ms);
    } catch { /* sin storage */ }
  }, []);
  const save = (k: string, v: string) => { try { localStorage.setItem(`visionary.visionFutura.${k}`, v); } catch { /* sin storage */ } };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/vision-futura/contexto${replayDate ? `?date=${replayDate}` : ""}`, { cache: "no-store" });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok || j.error) { setError(j.error ?? `HTTP ${res.status}`); return; }
        setData(j as ContextPayload);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    if (replayDate) return () => { alive = false; };
    const id = window.setInterval(load, LIVE_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [replayDate]);

  const lastSec = untilSec ?? (data ? Math.max(...data.symbols.map((s) => s.line.at(-1)?.t ?? 0), Date.parse(data.asOf) / 1000) : Date.now() / 1000);
  const win = data ? windowOf(data.date, Math.min(lastSec, Date.now() / 1000), zoomMinutes) : null;
  const until = untilSec ?? Infinity;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: "0 0 360px", minWidth: 300 }}>
      <div className="card" style={{ gap: 8, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <b style={{ fontSize: 14 }}>VIX · SPY · QQQ</b>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {data && win ? `hasta ${hm(Math.min(lastSec, win.close))}` : ""}{" "}
            <button onClick={() => { setHidden(!hidden); save("ctxHidden", hidden ? "0" : "1"); }}
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12, padding: 0, marginLeft: 6 }}>
              {hidden ? "mostrar" : "ocultar"}
            </button>
          </span>
        </div>
        {error && <div style={{ fontSize: 12, color: "var(--amber-text)" }}>Sin datos: {error}</div>}
        {!hidden && data && win && (
          <>
            {data.symbols.map((s) => <MiniChart key={s.sym} s={s} win={win} until={until} showAxis={s.sym === "QQQ"} />)}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--muted)" }}>
              <span><span style={{ color: PRICE }}>—</span> Precio</span>
              <span><span style={{ color: MAG_POS }}>—</span> Imán +</span>
              <span><span style={{ color: MAG_NEG }}>—</span> Imán −</span>
              <span>▲▼ imán fuera de la escala</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--faint)", lineHeight: 1.45 }}>
              Imán +: mayor gamma positiva; imán −: mayor gamma negativa; a ±25 % del precio en el VIX y ±1 % en SPY y QQQ.
              Al minuto cerrado, con la misma hora que la gráfica principal. Contexto visual. En vivo: grabación del día
              {data.symbols.every((s) => s.magnets.length === 0) ? " (los imanes empiezan a dibujarse cuando se graba con el mercado abierto)" : ""}.
            </div>
          </>
        )}
      </div>
      {data && win && (
        <TechWatch data={data} win={win} until={until} index={index} measure={measure}
          setIndex={(i) => { setIndex(i); save("techIndex", i); }}
          setMeasure={(m) => { setMeasure(m); save("techMeasure", m); }} />
      )}
    </div>
  );
}

// ── Mini gráfica de VIX / SPY / QQQ ──
function MiniChart({ s, win, until, showAxis }: { s: ContextSymbolView; win: { open: number; close: number }; until: number; showAxis: boolean }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = 64, AX = showAxis ? 16 : 0, PADR = 10;
  const pts = s.line.filter((p) => p.t >= win.open && p.t <= win.close && p.t <= until);
  const mags = s.magnets.filter((p) => p.t <= win.close && p.t <= until);
  const lastMag = mags.at(-1) ?? null;
  // En vivo (sin límite) el imán actual es la lectura en vivo; en la repetición, el grabado a esa hora.
  const posNow = Number.isFinite(until) ? lastMag?.pos ?? null : s.pos;
  const negNow = Number.isFinite(until) ? lastMag?.neg ?? null : s.neg;
  const price = pts.at(-1)?.v ?? s.price;

  const vals = pts.map((p) => p.v);
  let lo = vals.length ? Math.min(...vals) : (price ?? 0) - 1;
  let hi = vals.length ? Math.max(...vals) : (price ?? 0) + 1;
  // El imán entra a la escala si está cerca (hasta un rango del precio por fuera); si no, ▲▼ en la orilla.
  const range0 = Math.max(hi - lo, (price ?? 1) * 0.002);
  const nearScale = (v: number | null) => v != null && v >= lo - range0 && v <= hi + range0;
  for (const v of [posNow, negNow]) if (nearScale(v)) { lo = Math.min(lo, v as number); hi = Math.max(hi, v as number); }
  const pad = (hi - lo || 1) * 0.12;
  lo -= pad; hi += pad;
  const x = (t: number) => ((Math.min(Math.max(t, win.open), win.close) - win.open) / (win.close - win.open)) * (W - PADR);
  const y = (v: number) => 4 + ((hi - v) / (hi - lo)) * (H - 8);
  const inScale = (v: number) => v >= lo && v <= hi;

  const pricePath = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const stepPath = (k: "pos" | "neg") => {
    let d = "", prev: number | null = null;
    for (const m of mags) {
      const v = m[k];
      if (v == null || !inScale(v)) { prev = null; continue; }
      d += prev == null ? `M${x(m.t).toFixed(1)},${y(v).toFixed(1)}` : `H${x(m.t).toFixed(1)}V${y(v).toFixed(1)}`;
      prev = v;
    }
    const endT = Math.min(until, pts.at(-1)?.t ?? win.close);
    if (prev != null) d += `H${x(endT).toFixed(1)}`;
    return d;
  };
  // Marcas ▲▼ cuando el imán del minuto quedó fuera de la escala.
  const offMarks = (k: "pos" | "neg") => mags
    .filter((m, i) => m[k] != null && !inScale(m[k] as number) && (i === 0 || mags[i - 1][k] !== m[k]))
    .map((m) => ({ t: m.t, up: (m[k] as number) > hi }));

  const dist = (v: number | null) => (v != null && price ? ` (${pct(((v - price) / price) * 100)})` : "");
  const chg = price != null && s.prevClose ? ((price - s.prevClose) / s.prevClose) * 100 : null;
  const ticks: number[] = [];
  const span = win.close - win.open;
  const step = span > 3 * 3600 ? 3600 : span > 3600 ? 1800 : 900;
  for (let t = Math.ceil(win.open / step) * step; t <= win.close; t += step) ticks.push(t);

  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" }}>
        <b style={{ color: "var(--text)" }}>{s.sym} {fx(price, s.digits)}</b>
        {chg != null && <span style={{ color: chg >= 0 ? "var(--green)" : "var(--red-soft)", fontSize: 11 }}>{pct(chg)}</span>}
        <span style={{ color: "var(--faint)" }}>·</span>
        <span style={{ color: MAG_POS }}>+ {fx(posNow, s.digits)}{dist(posNow)}</span>
        <span style={{ color: "var(--faint)" }}>·</span>
        <span style={{ color: MAG_NEG }}>− {fx(negNow, s.digits)}{dist(negNow)}</span>
      </div>
      <svg width={W} height={H + AX} style={{ display: "block" }}>
        <rect x={0} y={0} width={W - PADR} height={H} fill="rgba(255,255,255,0.02)" stroke={GRID} strokeWidth={0.6} />
        {ticks.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke={GRID} strokeWidth={0.5} />)}
        {s.prevClose != null && inScale(s.prevClose) && (
          <line x1={0} x2={W - PADR} y1={y(s.prevClose)} y2={y(s.prevClose)} stroke="#6b7591" strokeDasharray="2 3" strokeWidth={0.8} />
        )}
        <path d={stepPath("pos")} fill="none" stroke={MAG_POS} strokeWidth={1.4} opacity={0.9} />
        <path d={stepPath("neg")} fill="none" stroke={MAG_NEG} strokeWidth={1.4} opacity={0.9} />
        {offMarks("pos").map((m) => <text key={`p${m.t}`} x={x(m.t)} y={m.up ? 9 : H - 2} fontSize={8} fill={MAG_POS} textAnchor="middle">{m.up ? "▲" : "▼"}</text>)}
        {offMarks("neg").map((m) => <text key={`n${m.t}`} x={x(m.t)} y={m.up ? 9 : H - 2} fontSize={8} fill={MAG_NEG} textAnchor="middle">{m.up ? "▲" : "▼"}</text>)}
        <path d={pricePath} fill="none" stroke={PRICE} strokeWidth={1.4} />
        {/* Imanes actuales en la orilla derecha: punta de flecha (▲▼ si están fuera de la escala) */}
        {([[posNow, MAG_POS], [negNow, MAG_NEG]] as const).map(([v, col], i) => v == null ? null : inScale(v)
          ? <polygon key={i} points={`${W - PADR + 1},${y(v)} ${W - 1},${y(v) - 4} ${W - 1},${y(v) + 4}`} fill={col} />
          : <text key={i} x={W - 5} y={v > hi ? 9 : H - 2} fontSize={9} fill={col} textAnchor="middle">{v > hi ? "▲" : "▼"}</text>)}
        {pts.length > 0 && <circle cx={x(pts[pts.length - 1].t)} cy={y(pts[pts.length - 1].v)} r={2.2} fill={PRICE} />}
        {showAxis && ticks.map((t) => <text key={`l${t}`} x={x(t)} y={H + 12} fontSize={9.5} fill="#6b7591" textAnchor="middle">{hm(t)}</text>)}
      </svg>
    </div>
  );
}

// ── Vigía tecnológico ──
function TechWatch({ data, win, until, index, measure, setIndex, setMeasure }: {
  data: ContextPayload; win: { open: number; close: number }; until: number;
  index: TechIndex; measure: Measure; setIndex: (i: TechIndex) => void; setMeasure: (m: Measure) => void;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const w = TECH_WEIGHTS[index];
  const companies: TechCompany[] = [...data.tech.companies].sort((a, b) => (w[b.ticker] ?? 0) - (w[a.ticker] ?? 0));
  const series: TechPoint[] = data.tech.series[index].filter((p) => p.t >= win.open && p.t <= win.close && p.t <= until);
  // Lectura: en vivo, la de ahora (de las 11 empresas); en la repetición, la grabada a esa hora.
  const live = !Number.isFinite(until) && !data.past ? techReading(companies, index) : null;
  const rec = stepAt(data.tech.series[index], Number.isFinite(until) ? until : Infinity);
  const now = live ?? rec;
  const nowMin = Math.floor(Date.now() / 60_000) * 60;
  const hasThisMinute = !!rec && (Number.isFinite(until) ? until - rec.t < 120 : nowMin - rec.t < 120);

  const val = (p: { count: number; balance: number; pull: number } | null) => (p ? p[measure] : null);
  const n = now?.n ?? 11;
  const range = measure === "count" ? { lo: 0, hi: n, mid: n / 2 }
    : measure === "balance" ? { lo: -100, hi: 100, mid: 0 }
    : (() => { const m = Math.max(1, ...series.map((p) => Math.abs(p.pull)), Math.abs(now?.pull ?? 0)); return { lo: -m, hi: m, mid: 0 }; })();
  const fmtVal = (v: number | null) => v == null ? "—" : measure === "count" ? `${v} de ${n}` : measure === "balance" ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)} %` : pct(v);
  const H = 120, PADL = 18, PADR = 6;
  const x = (t: number) => PADL + ((Math.min(Math.max(t, win.open), win.close) - win.open) / (win.close - win.open)) * (W - PADL - PADR);
  const y = (v: number) => 6 + ((range.hi - v) / (range.hi - range.lo || 1)) * (H - 12);
  const path = series.map((p, i) => `${i ? "H" : "M"}${x(p.t).toFixed(1)}${i ? `V${y(p[measure]).toFixed(1)}` : `,${y(p[measure]).toFixed(1)}`}`).join("");
  const ticks: number[] = [];
  const span = win.close - win.open;
  const step = span > 3 * 3600 ? 3600 : span > 3600 ? 1800 : 900;
  for (let t = Math.ceil(win.open / step) * step; t <= win.close; t += step) ticks.push(t);
  const v = val(now);
  const frac = v == null ? 0.5 : (v - range.lo) / (range.hi - range.lo || 1);

  const explain: Record<Measure, string> = {
    count: `Conteo de imanes: cuántas de las ${n} empresas tienen su imán + mayor (su mayor gamma positiva a ±5 % del precio) ARRIBA del precio. Sin pesos: cada empresa cuenta igual.`,
    balance: "Balance ponderado: cada empresa suma su peso en el índice si su imán + mayor está arriba y lo resta si está abajo (−100 % = todas abajo, +100 % = todas arriba).",
    pull: "Imán mayor ponderado: distancia promedio del precio a su imán + mayor, pesada por el peso en el índice (+ = el dinero jala hacia arriba).",
  };

  return (
    <div className="card" style={{ gap: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ fontSize: 14 }}>Vigía tecnológico</b>
        <div className="view-toggle">
          {(["SPX", "NDX"] as TechIndex[]).map((i) => (
            <button key={i} className={index === i ? "active" : ""} onClick={() => setIndex(i)}>{i}</button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--faint)" }}>
        {measure === "count" ? "Sin pesos: cada empresa cuenta igual. " : ""}La lista va ordenada por su peso en el {index === "SPX" ? "S&P 500" : "Nasdaq 100"} (pesos aproximados).
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ height: 8, borderRadius: 999, background: "var(--panel-2)", border: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>
          {v != null && (
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${Math.min(frac, 0.5) * 100}%`, width: `${Math.abs(frac - 0.5) * 100}%`, background: frac >= 0.5 ? UP : DOWN }} />
          )}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "var(--muted)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
          <span>{measure === "count" ? "0 · todos abajo" : "todo abajo"}</span>
          <b style={{ color: v == null ? "var(--muted)" : frac > 0.5 ? UP : frac < 0.5 ? DOWN : "var(--text)", fontSize: 13 }}>{fmtVal(v)}</b>
          <span>{measure === "count" ? `todos arriba · ${n}` : "todo arriba"}</span>
        </div>
      </div>
      {!hasThisMinute && <div style={{ fontSize: 11, color: "var(--muted)" }}>Sin lectura grabada en este minuto{live ? " (arriba: lectura en vivo)" : ""}.</div>}
      <div ref={ref}>
        <svg width={W} height={H + 16} style={{ display: "block" }}>
          <defs>
            <clipPath id={`tw-up-${index}`}><rect x={0} y={0} width={W} height={y(range.mid)} /></clipPath>
            <clipPath id={`tw-dn-${index}`}><rect x={0} y={y(range.mid)} width={W} height={H} /></clipPath>
          </defs>
          <rect x={PADL} y={0} width={W - PADL - PADR} height={H} fill="rgba(255,255,255,0.02)" stroke={GRID} strokeWidth={0.6} />
          {ticks.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke={GRID} strokeWidth={0.5} />)}
          <line x1={PADL} x2={W - PADR} y1={y(range.mid)} y2={y(range.mid)} stroke="#6b7591" strokeDasharray="3 3" />
          <text x={PADL - 4} y={10} fontSize={9} fill="#6b7591" textAnchor="end">{measure === "count" ? n : measure === "balance" ? "100" : range.hi.toFixed(1)}</text>
          <text x={PADL - 4} y={H - 2} fontSize={9} fill="#6b7591" textAnchor="end">{measure === "count" ? 0 : measure === "balance" ? "−100" : range.lo.toFixed(1)}</text>
          <path d={path} fill="none" stroke={UP} strokeWidth={1.6} clipPath={`url(#tw-up-${index})`} />
          <path d={path} fill="none" stroke={DOWN} strokeWidth={1.6} clipPath={`url(#tw-dn-${index})`} />
          {ticks.map((t) => <text key={`l${t}`} x={x(t)} y={H + 12} fontSize={9.5} fill="#6b7591" textAnchor="middle">{hm(t)}</text>)}
          {series.length === 0 && <text x={W / 2} y={H / 2} fontSize={11} fill="#6b7591" textAnchor="middle">Se dibuja minuto a minuto con el mercado abierto</text>}
        </svg>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", columnGap: 16, rowGap: 3, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        {companies.map((c) => {
          const chg = c.price != null && c.prevClose ? ((c.price - c.prevClose) / c.prevClose) * 100 : null;
          return (
            <div key={c.ticker} style={{ display: "flex", justifyContent: "space-between", gap: 6, padding: "2px 0", borderBottom: "1px solid var(--border-soft)" }}
              title={c.magnet != null ? `Imán + mayor ${fx(c.magnet, 2)} (${c.distPct != null ? pct(c.distPct) : "—"}) · vence ${c.expiration ?? "—"}` : "Sin imán + a ±5 %"}>
              <span>
                <b>{c.ticker}</b>{" "}
                <span style={{ color: "var(--faint)" }}>{(w[c.ticker] ?? 0).toFixed(1)} %</span>{" "}
                <span style={{ color: c.dir > 0 ? UP : c.dir < 0 ? DOWN : "var(--faint)" }}>{c.dir > 0 ? "▲" : c.dir < 0 ? "▼" : "·"}</span>
              </span>
              <span style={{ color: chg == null ? "var(--faint)" : chg >= 0 ? "var(--green)" : "var(--red-soft)" }}>{chg == null ? "—" : pct(chg)}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Medida:</span>
        {MEASURES.map((m) => (
          <button key={m.key} onClick={() => setMeasure(m.key)} aria-pressed={measure === m.key}
            style={{
              padding: "4px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
              border: `1px solid ${measure === m.key ? "var(--accent)" : "var(--border)"}`,
              background: measure === m.key ? "var(--accent)" : "transparent", color: measure === m.key ? "#fff" : "var(--muted)", fontWeight: measure === m.key ? 700 : 500,
            }}>
            {m.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "var(--faint)", lineHeight: 1.45 }}>
        {explain[measure]} ▲ = imán arriba del precio · ▼ = abajo. El % de la derecha es el cambio del día.
      </div>
    </div>
  );
}
