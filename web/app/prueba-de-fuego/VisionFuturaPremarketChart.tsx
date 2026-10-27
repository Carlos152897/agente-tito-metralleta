"use client";

// Gráfica del pre-mercado (Carlos, 27-oct-2026: "durante el pre market debería empezar a crear
// una nueva gráfica e ir marcando los puntos importantes del activo"). Va dentro de la sección
// 🌅 Pre-mercado. Velas de la noche (futuro pasado a precio del índice; TSLA = pre-market de la
// acción) desde las 6 pm hasta las 9:30, con:
//   - niveles del pronóstico (cierre, máx/mín de ayer, Magneto, flip, max pain, techo, piso, rango),
//   - máx/mín de la noche con su hora,
//   - perfil de volumen (POC, área de valor, nodos altos),
//   - velas con agresor fuerte (▲ compra al ask / ▼ venta al bid) y zonas de agresor.
// Datos: /api/vision-futura/premarket-chart · motor: lib/visionFuturaPremarketChart.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PremarketChartResponse } from "@/app/api/vision-futura/premarket-chart/route";
import type { PremarketMark } from "@/lib/visionFuturaPremarket";
import { aggregateCandles, type PmCandle } from "@/lib/visionFuturaPremarketChart";

const MARK_COLOR: Record<PremarketMark["kind"], string> = {
  techo: "#fdb022",
  piso: "#38bdf8",
  magneto: "#a78bfa",
  flip: "#f472b6",
  cierre: "#9aa5c0",
  ayer: "#6b7591",
  noche: "#2dd4bf",
  max_pain: "#6b7591",
};
const NIGHT = "#2dd4bf";
const POC = "#facc15";
const BUY = "#22c55e";
const SELL = "#ef4444";
const KEY_ZOOM = "visionary.visionFutura.premarketChartZoom";

type Zoom = "noche" | "2h";

const W = 1000;
const H = 430;
const TOP = 14;
const BOTTOM = 26;
const PLOT_L = 8;
const PLOT_R = 742;
const PROF_L = 748;
const PROF_R = 828;
const LABEL_L = 834;

interface Props {
  inst: "SPX" | "NQ" | "TSLA";
  futLabel: string | null;
}

interface Line {
  key: string;
  price: number;
  color: string;
  text: string;
  strong: boolean;
  dash?: string;
  /** Prioridad al acomodar etiquetas (menor = más importante). */
  prio: number;
}

export default function VisionFuturaPremarketChart({ inst, futLabel }: Props) {
  const [data, setData] = useState<PremarketChartResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<Zoom>("noche");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    try { const v = window.localStorage.getItem(KEY_ZOOM); if (v === "noche" || v === "2h") setZoom(v); } catch { /* sin storage */ }
  }, []);
  const pickZoom = (z: Zoom) => { setZoom(z); try { window.localStorage.setItem(KEY_ZOOM, z); } catch { /* ignorar */ } };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/vision-futura/premarket-chart?inst=${inst}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `Error ${res.status}`);
      setData(json as PremarketChartResponse);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error leyendo la gráfica del pre-mercado.");
    } finally {
      setLoading(false);
    }
  }, [inst]);

  useEffect(() => {
    setData(null);
    setLoading(true);
    load();
    // En pre-mercado se redibuja cada 30 s; ya en sesión la noche no cambia.
    const id = window.setInterval(() => { load(); }, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const dec = inst === "TSLA" ? 2 : 2;
  const fmt = (v: number | null | undefined, d = dec) =>
    v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt0 = (v: number) => fmt(v, inst === "TSLA" ? 2 : Math.abs(v % 1) < 0.005 ? 0 : 2);

  const view = useMemo(() => {
    if (!data || data.candles.length === 0) return null;
    const all = data.candles;
    const last = all[all.length - 1];
    let t0 = data.from, t1 = data.open;
    let bars: PmCandle[];
    if (zoom === "2h") {
      t1 = Math.min(data.open, last.time + 15 * 60);
      t0 = Math.max(data.from, t1 - 135 * 60);
      bars = all.filter((b) => b.time >= t0);
    } else {
      bars = aggregateCandles(all, 5);
    }
    const stepSec = zoom === "2h" ? 60 : 300;
    const a = data.analysis;

    // Escala vertical: velas + rango probable + niveles que caen dentro del extendido.
    const ext = data.extended;
    const inExt = (p: number) => !ext || (p >= ext.low - 1e-9 && p <= ext.high + 1e-9);
    const vals: number[] = [];
    for (const b of bars) vals.push(b.high, b.low);
    if (data.range) vals.push(data.range.low, data.range.high);
    for (const m of data.marks) if (inExt(m.price)) vals.push(m.price);
    if (zoom === "noche" && a.nightHigh && a.nightLow) vals.push(a.nightHigh.price, a.nightLow.price);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.05, last.close * 0.0004);
    lo -= pad; hi += pad;
    const y = (p: number) => TOP + (1 - (p - lo) / (hi - lo)) * (H - TOP - BOTTOM);
    const x = (t: number) => PLOT_L + ((t - t0) / Math.max(1, t1 - t0)) * (PLOT_R - PLOT_L);
    const bw = Math.max(1, ((PLOT_R - PLOT_L) * stepSec) / Math.max(1, t1 - t0) * 0.7);
    return { bars, t0, t1, lo, hi, y, x, bw, last, stepSec };
  }, [data, zoom]);

  const lines: Line[] = useMemo(() => {
    if (!data) return [];
    const a = data.analysis;
    const out: Line[] = data.marks.map((m) => ({
      key: `${m.kind}-${m.label}`,
      price: m.price,
      color: MARK_COLOR[m.kind],
      text: `${m.label} ${fmt0(m.price)}`,
      strong: m.kind === "techo" || m.kind === "piso" || m.kind === "magneto",
      dash: m.kind === "techo" || m.kind === "piso" || m.kind === "magneto" ? undefined : "4 4",
      prio: m.kind === "techo" || m.kind === "piso" ? 0 : m.kind === "magneto" ? 1 : m.kind === "cierre" ? 2 : 4,
    }));
    if (a.nightHigh) out.push({ key: "nh", price: a.nightHigh.price, color: NIGHT, text: `Máx. noche ${fmt0(a.nightHigh.price)} · ${hm(a.nightHigh.time)}`, strong: true, dash: "6 3", prio: 1 });
    if (a.nightLow) out.push({ key: "nl", price: a.nightLow.price, color: NIGHT, text: `Mín. noche ${fmt0(a.nightLow.price)} · ${hm(a.nightLow.time)}`, strong: true, dash: "6 3", prio: 1 });
    if (a.poc != null) out.push({ key: "poc", price: a.poc, color: POC, text: `POC ${fmt0(a.poc)} (más volumen)`, strong: false, dash: "2 3", prio: 3 });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (loading && !data) return <div className="wheel-empty">Dibujando la noche de {inst}…</div>;
  if (err && !data) return <div style={{ fontSize: 12, color: "var(--amber-text)" }}>Gráfica del pre-mercado: {err}</div>;
  if (!data) return null;
  if (!view) return <div style={{ fontSize: 12, color: "var(--muted)" }}>Gráfica del pre-mercado: {data.note ?? "sin velas todavía."}</div>;

  const { bars, t0, t1, lo, hi, y, x, bw, last } = view;
  const a = data.analysis;
  const clampY = (p: number) => Math.min(H - BOTTOM, Math.max(TOP, y(p)));

  // Etiquetas a la derecha sin encimarse (de arriba a abajo; las fuera de la escala van al borde con flecha).
  const placed = [...lines]
    .sort((p, q) => q.price - p.price || p.prio - q.prio)
    .map((l) => {
      const out = l.price > hi ? "↑ " : l.price < lo ? "↓ " : "";
      return { l, out, want: clampY(l.price) };
    });
  const GAP = 12;
  let prevY = -Infinity;
  const labelY = placed.map((p) => { const v = Math.max(p.want, prevY + GAP); prevY = v; return v; });
  // Si se salieron por abajo, se empujan hacia arriba.
  for (let i = labelY.length - 1, maxY = H - BOTTOM + 4; i >= 0; i--) {
    if (labelY[i] > maxY) labelY[i] = maxY;
    maxY = labelY[i] - GAP;
  }

  // Perfil de volumen.
  const maxVol = Math.max(1, ...a.profile.map((r) => r.volume));
  const rowH = Math.max(1, Math.abs(y(0) - y(a.bucket)) - 1);

  // Marcas de hora.
  const span = t1 - t0;
  const tickEvery = span > 8 * 3600 ? 3600 * 2 : span > 4 * 3600 ? 3600 : span > 90 * 60 ? 1800 : 900;
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / tickEvery) * tickEvery; t <= t1; t += tickEvery) ticks.push(t);

  const aggs = a.aggressors.filter((g) => g.time >= t0 && g.time <= t1);
  const maxDelta = Math.max(1, ...a.aggressors.map((g) => Math.abs(g.delta)));
  const hoverBar = hover != null ? bars.reduce<PmCandle | null>((best, b) => (best == null || Math.abs(b.time - hover) < Math.abs(best.time - hover) ? b : best), null) : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < PLOT_L || px > PLOT_R) { setHover(null); return; }
    setHover(t0 + ((px - PLOT_L) / (PLOT_R - PLOT_L)) * (t1 - t0));
  };

  const fut = (p: number) => (data.basis != null && futLabel ? `${futLabel} ${fmt(p + data.basis)}` : "");
  const lecturas = buildReadings(data, fmt0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <b style={{ fontSize: 13 }}>
          Gráfica de la noche · {inst === "TSLA" ? "4 am" : "6 pm"} → 9:30 NY
          <span style={{ fontWeight: 400, color: "var(--muted)" }}> · {data.source}{data.phase === "sesion" ? " · noche terminada" : ` · se actualiza cada 30 s`}</span>
        </b>
        <div style={{ display: "flex", gap: 6 }}>
          {(["noche", "2h"] as Zoom[]).map((z) => (
            <button key={z} onClick={() => pickZoom(z)} style={{
              fontSize: 12, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
              border: `1px solid ${zoom === z ? "var(--accent)" : "var(--border)"}`,
              background: zoom === z ? "rgba(47,107,255,0.18)" : "var(--panel-2)", color: "var(--text)",
            }}>
              {z === "noche" ? "Toda la noche (velas 5 min)" : "Últimas 2 h (velas 1 min)"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", minWidth: 640, display: "block", fontFamily: "ui-sans-serif, system-ui, sans-serif", background: "var(--panel-2)", borderRadius: 10 }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* Rango probable del pronóstico */}
          {data.range && (
            <g>
              <rect x={PLOT_L} width={PLOT_R - PLOT_L} y={clampY(data.range.high)} height={Math.max(0, clampY(data.range.low) - clampY(data.range.high))} fill="rgba(47,107,255,0.10)" />
              <text x={PLOT_L + 6} y={clampY(data.range.high) + 12} fontSize={10.5} fill="#9db6ff">rango probable {fmt0(data.range.low)} – {fmt0(data.range.high)}</text>
            </g>
          )}

          {/* Horas */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={TOP} y2={H - BOTTOM} stroke="rgba(148,163,184,0.10)" />
              <text x={x(t)} y={H - 8} fontSize={10.5} textAnchor="middle" fill="#8b95ad">{hm(t)}</text>
            </g>
          ))}

          {/* Niveles */}
          {placed.map(({ l, out }) => out ? null : (
            <line key={l.key} x1={PLOT_L} x2={PROF_R} y1={y(l.price)} y2={y(l.price)} stroke={l.color} strokeWidth={l.strong ? 1.4 : 1} strokeDasharray={l.dash} opacity={0.85} />
          ))}

          {/* Velas */}
          {bars.map((b) => {
            const up = b.close >= b.open;
            const c = up ? BUY : SELL;
            const cx = x(b.time + view.stepSec / 2);
            const yo = y(b.open), yc = y(b.close);
            return (
              <g key={b.time}>
                <line x1={cx} x2={cx} y1={y(b.high)} y2={y(b.low)} stroke={c} strokeWidth={1} />
                <rect x={cx - bw / 2} width={bw} y={Math.min(yo, yc)} height={Math.max(1, Math.abs(yc - yo))} fill={c} />
              </g>
            );
          })}

          {/* Agresor fuerte */}
          {aggs.map((g) => {
            const cx = x(g.time + 30);
            const s = 5 + 5 * (Math.abs(g.delta) / maxDelta);
            const buy = g.side === "compra";
            const yy = buy ? y(g.low) + 6 : y(g.high) - 6;
            const pts = buy ? `${cx},${yy} ${cx - s},${yy + s * 1.4} ${cx + s},${yy + s * 1.4}` : `${cx},${yy} ${cx - s},${yy - s * 1.4} ${cx + s},${yy - s * 1.4}`;
            return (
              <polygon key={`ag-${g.time}`} points={pts} fill={buy ? BUY : SELL} stroke="#0b1020" strokeWidth={1}>
                <title>{`${hm(g.time)} · ${buy ? "COMPRA agresiva (al ask)" : "VENTA agresiva (al bid)"} ${g.delta > 0 ? "+" : "−"}${Math.abs(g.delta).toLocaleString("en-US")} de ${g.volume.toLocaleString("en-US")} · precio ${fmt(g.price)}`}</title>
              </polygon>
            );
          })}

          {/* Precio actual */}
          <circle cx={x(last.time + 30)} cy={y(last.close)} r={4} fill="#f5f7fb" stroke="#0b1020" strokeWidth={1.5} />

          {/* Perfil de volumen */}
          <line x1={PROF_L} x2={PROF_L} y1={TOP} y2={H - BOTTOM} stroke="rgba(148,163,184,0.25)" />
          {a.valueArea && (
            <rect x={PROF_L} width={PROF_R - PROF_L} y={clampY(a.valueArea.high)} height={Math.max(0, clampY(a.valueArea.low) - clampY(a.valueArea.high))} fill="rgba(250,204,21,0.07)">
              <title>{`Área de valor (70% del volumen): ${fmt0(a.valueArea.low)} – ${fmt0(a.valueArea.high)}`}</title>
            </rect>
          )}
          {a.profile.map((r) => {
            if (r.price < lo || r.price > hi) return null;
            const isPoc = a.poc != null && Math.abs(r.price - a.poc) < a.bucket / 2;
            const isHvn = a.hvn.some((h) => Math.abs(h - r.price) < a.bucket / 2);
            return (
              <rect key={r.price} x={PROF_L + 1} y={y(r.price) - rowH / 2} height={rowH} width={((PROF_R - PROF_L - 4) * r.volume) / maxVol}
                fill={isPoc ? POC : isHvn ? "#eab308" : "rgba(148,163,184,0.45)"} opacity={isPoc ? 0.95 : isHvn ? 0.7 : 1}>
                <title>{`${fmt0(r.price - a.bucket / 2)}–${fmt0(r.price + a.bucket / 2)}: ${Math.round(r.volume).toLocaleString("en-US")} contratos${isPoc ? " · POC" : isHvn ? " · nodo de volumen alto" : ""}`}</title>
              </rect>
            );
          })}
          {/* Zonas de agresor (marca en la orilla del perfil) */}
          {a.aggZones.filter((z) => z.price >= lo && z.price <= hi).map((z) => (
            <rect key={`z-${z.side}-${z.price}`} x={PROF_R - 6} width={6} y={y(z.price) - 4} height={8} fill={z.side === "compra" ? BUY : SELL}>
              <title>{`Zona de ${z.side} agresiva ${fmt0(z.price)}: ${z.delta > 0 ? "+" : "−"}${Math.abs(Math.round(z.delta)).toLocaleString("en-US")} neto`}</title>
            </rect>
          ))}
          <text x={(PROF_L + PROF_R) / 2} y={H - 8} fontSize={10} textAnchor="middle" fill="#8b95ad">volumen</text>

          {/* Etiquetas de niveles */}
          {placed.map(({ l, out, want }, i) => (
            <g key={`lb-${l.key}`}>
              {Math.abs(labelY[i] - want) > 2 && !out && <line x1={PROF_R} x2={LABEL_L - 2} y1={want} y2={labelY[i]} stroke={l.color} opacity={0.5} />}
              <text x={LABEL_L} y={labelY[i] + 3.5} fontSize={10.5} fill={l.color} fontWeight={l.strong ? 700 : 400}>
                <title>{`${l.text}${fut(l.price) ? ` · ${fut(l.price)}` : ""}`}</title>
                {out}{l.text}
              </text>
            </g>
          ))}

          {/* Cruz de lectura */}
          {hoverBar && (
            <g pointerEvents="none">
              <line x1={x(hoverBar.time + view.stepSec / 2)} x2={x(hoverBar.time + view.stepSec / 2)} y1={TOP} y2={H - BOTTOM} stroke="rgba(245,247,251,0.35)" />
              {(() => {
                const cx = x(hoverBar.time + view.stepSec / 2);
                const bx = cx > (PLOT_L + PLOT_R) / 2 ? cx - 196 : cx + 8;
                const delta = hoverBar.askVolume != null && hoverBar.bidVolume != null ? hoverBar.askVolume - hoverBar.bidVolume : null;
                const rows = [
                  `${hm(hoverBar.time)} NY`,
                  `A ${fmt(hoverBar.open)}  C ${fmt(hoverBar.close)}`,
                  `Máx ${fmt(hoverBar.high)}  Mín ${fmt(hoverBar.low)}`,
                  ...(fut(hoverBar.close) ? [`= ${fut(hoverBar.close)}`] : []),
                  ...(hoverBar.volume != null ? [`vol ${hoverBar.volume.toLocaleString("en-US")}${delta != null ? ` · agresor ${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta).toLocaleString("en-US")}` : ""}`] : []),
                ];
                return (
                  <g>
                    <rect x={bx} y={TOP + 4} width={188} height={rows.length * 15 + 8} rx={6} fill="rgba(11,16,32,0.92)" stroke="var(--border)" />
                    {rows.map((t, i) => <text key={i} x={bx + 8} y={TOP + 19 + i * 15} fontSize={11} fill={i === 0 ? "#f5f7fb" : "#c3cbe0"} fontWeight={i === 0 ? 700 : 400}>{t}</text>)}
                  </g>
                );
              })()}
            </g>
          )}
        </svg>
      </div>

      {/* Leyenda + lectura */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 11, color: "var(--muted)" }}>
        <span><Sw c={NIGHT} dash /> máx/mín de la noche</span>
        <span><Sw c={POC} dash /> POC = precio con más volumen</span>
        <span><Sw c={MARK_COLOR.techo} /> techo · <Sw c={MARK_COLOR.piso} /> piso · <Sw c={MARK_COLOR.magneto} /> Magneto</span>
        <span><Sw c={MARK_COLOR.cierre} dash /> cierre / máx-mín de ayer</span>
        <span style={{ color: BUY }}>▲ compra agresiva</span>
        <span style={{ color: SELL }}>▼ venta agresiva</span>
        <span>■ en la orilla del volumen = zona de agresor</span>
      </div>
      {lecturas.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3, fontSize: 13 }}>
          {lecturas.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
      {data.note && <div style={{ fontSize: 12, color: "var(--amber-text)" }}>{data.note}</div>}
      {err && <div style={{ fontSize: 12, color: "var(--amber-text)" }}>{err} (mostrando la última lectura)</div>}
    </div>
  );
}

function Sw({ c, dash }: { c: string; dash?: boolean }) {
  return <span style={{ display: "inline-block", width: 16, height: 0, borderTop: `2px ${dash ? "dashed" : "solid"} ${c}`, verticalAlign: "middle", marginRight: 4 }} />;
}

const hm = (sec: number) => new Date(sec * 1000).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

/** Frases cortas de lo que dice la noche. */
function buildReadings(d: PremarketChartResponse, f: (v: number) => string): string[] {
  const a = d.analysis;
  const out: string[] = [];
  const p = a.last;
  if (p == null) return out;
  if (d.prevClose != null) {
    const g = p - d.prevClose;
    out.push(`Precio de la noche ${f(p)}: ${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(1)} vs el cierre ${f(d.prevClose)} (${g >= 0 ? "gap arriba" : "gap abajo"}).`);
  }
  if (a.nightHigh && a.nightLow) {
    const toH = a.nightHigh.price - p, toL = p - a.nightLow.price;
    out.push(`Rango de la noche ${f(a.nightLow.price)} – ${f(a.nightHigh.price)} (${(a.nightHigh.price - a.nightLow.price).toFixed(1)} pts); el precio está a ${toH.toFixed(1)} del máximo y ${toL.toFixed(1)} del mínimo.`);
  }
  if (a.poc != null && a.valueArea) {
    const where = p > a.valueArea.high ? "ARRIBA del área de valor → los compradores aceptaron precios más altos"
      : p < a.valueArea.low ? "ABAJO del área de valor → los vendedores llevaron el precio a donde casi no se operó"
      : p >= a.poc ? "dentro del área de valor, arriba del POC" : "dentro del área de valor, abajo del POC";
    out.push(`POC ${f(a.poc)} · área de valor ${f(a.valueArea.low)} – ${f(a.valueArea.high)}: el precio está ${where}.`);
  }
  if (d.range) {
    const inR = p >= d.range.low && p <= d.range.high;
    out.push(inR ? `Dentro del rango probable ${f(d.range.low)} – ${f(d.range.high)}.` : `FUERA del rango probable ${f(d.range.low)} – ${f(d.range.high)} (${p > d.range.high ? "arriba" : "abajo"}).`);
  }
  if (a.hasFlow) {
    const buys = a.aggressors.filter((g) => g.side === "compra"), sells = a.aggressors.filter((g) => g.side === "venta");
    const lastAgg = a.aggressors.at(-1);
    if (a.aggressors.length) {
      out.push(`Agresor fuerte: ${buys.length} vela(s) de compra y ${sells.length} de venta; la más reciente ${lastAgg!.side === "compra" ? "COMPRA" : "VENTA"} ${lastAgg!.delta > 0 ? "+" : "−"}${Math.abs(lastAgg!.delta).toLocaleString("en-US")} a las ${hm(lastAgg!.time)} en ${f(lastAgg!.price)}.`);
    }
    const zb = a.aggZones.filter((z) => z.side === "compra").map((z) => f(z.price));
    const zs = a.aggZones.filter((z) => z.side === "venta").map((z) => f(z.price));
    if (zb.length || zs.length) out.push(`Zonas de agresor: compra en ${zb.join(", ") || "—"} · venta en ${zs.join(", ") || "—"}.`);
  } else {
    out.push("Sin datos de compras/ventas al ask/bid para el agresor.");
  }
  return out;
}
