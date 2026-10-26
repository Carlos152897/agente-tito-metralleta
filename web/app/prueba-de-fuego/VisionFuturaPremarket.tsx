"use client";

// Sección "🌅 Pre-mercado" de VisionFutura (Carlos, 25-oct-2026: "analiza el pre mercado, ve
// las posiciones importantes y dame en qué rango posiblemente se encuentre el activo ese día").
// Motor: lib/visionFuturaPremarket.ts · datos: lib/visionFuturaPremarketData.ts.
// Antes de la apertura se actualiza cada minuto; en la sesión muestra el pronóstico congelado
// (última lectura antes de las 9:30) y dónde va el precio contra ese rango.

import { useCallback, useEffect, useState } from "react";
import type { PremarketHistoryRow, PremarketPayload, PremarketSnapshot } from "@/lib/visionFuturaPremarketData";
import type { PremarketMark, PremarketPosition, PremarketReport } from "@/lib/visionFuturaPremarket";

const UP = "var(--green)";
const DOWN = "var(--red-soft)";
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
const KEY_OPEN = "visionary.visionFutura.premarketOpen";

interface Props {
  inst: "SPX" | "NQ" | "TSLA";
  /** Precio en vivo del instrumento (para ubicarlo dentro del rango durante la sesión). */
  livePrice: number | null;
  marketOpen: boolean;
  /** Etiqueta del futuro (/ES, /NQ) para las conversiones. */
  futLabel: string | null;
}

export default function VisionFuturaPremarket({ inst, livePrice, marketOpen, futLabel }: Props) {
  const [data, setData] = useState<PremarketPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try { const v = window.localStorage.getItem(KEY_OPEN); if (v != null) setOpen(v === "1"); } catch { /* sin storage */ }
  }, []);
  const toggle = () => setOpen((o) => { try { window.localStorage.setItem(KEY_OPEN, o ? "0" : "1"); } catch { /* ignorar */ } return !o; });

  const load = useCallback(async (force = false) => {
    try {
      const res = await fetch(`/api/vision-futura/premarket?inst=${inst}${force ? "&force=1" : ""}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.error && !json.day) throw new Error(json.error ?? `Error ${res.status}`);
      setData(json as PremarketPayload);
      setErr((json as PremarketPayload).error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error leyendo el pre-mercado.");
    } finally {
      setLoading(false);
    }
  }, [inst]);

  useEffect(() => {
    setData(null);
    setLoading(true);
    load();
    // Cada minuto (el servidor recalcula como mucho cada 60 s; en sesión devuelve lo guardado).
    const id = window.setInterval(() => load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const day = data?.day ?? null;
  const inSession = data?.phase === "sesion";
  // En sesión manda el pronóstico congelado antes de la apertura.
  const r: PremarketReport | null = day ? (inSession ? day.frozen ?? day.report : day.report) : null;
  const price = inSession && marketOpen && livePrice ? livePrice : r?.spot ?? null;
  const fmt = (v: number | null | undefined, d = inst === "TSLA" ? 2 : 0) =>
    v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fut = (v: number) => (r?.futBasis != null && futLabel ? ` · ${futLabel} ${fmt(v + r.futBasis)}` : "");

  return (
    <div className="card" style={{ gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <h4 style={{ margin: 0 }}>🌅 Pre-mercado · rango probable {data ? `del ${fechaLarga(data.date)}` : ""}</h4>
          {data && <PhaseChip data={data} />}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!inSession && <button onClick={() => load(true)} style={linkBtn}>Actualizar</button>}
          <button onClick={toggle} style={linkBtn}>{open ? "Ocultar" : "Mostrar"}</button>
        </div>
      </div>

      {open && (
        <>
          {loading && !data && <div className="wheel-empty">Leyendo el pre-mercado de {inst}…</div>}
          {err && <div style={{ fontSize: 12, color: "var(--amber-text)" }}>{err}{day ? " (mostrando la última lectura)" : ""}</div>}
          {r && (
            <>
              {/* Números grandes */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 10 }}>
                <Stat
                  label={inSession && marketOpen ? "Precio ahora" : "Precio implícito"}
                  value={fmt(price, 2)}
                  sub={inSession && marketOpen ? `abrió con gap ${signed(r.gap)} pts` : `${signed(r.gap)} pts (${r.gapPct > 0 ? "+" : ""}${r.gapPct}%) vs cierre ${fmt(r.prevClose, 2)}`}
                  color={r.gap > 0 ? UP : r.gap < 0 ? DOWN : undefined}
                />
                <Stat label="Movimiento esperado" value={`±${fmt(r.sigma, inst === "TSLA" ? 2 : 1)}`} sub={r.sigmaSource} />
                <Stat
                  label="Rango probable"
                  value={`${fmt(r.range.low)} – ${fmt(r.range.high)}`}
                  sub={`${fmt(r.range.high - r.range.low)} pts · extendido ${fmt(r.extended.low)} – ${fmt(r.extended.high)}`}
                  color="var(--text)"
                />
                <Stat
                  label="Tipo de día"
                  value={r.regime === "positivo" ? "Rango" : r.regime === "negativo" ? "Movido" : "—"}
                  sub={r.regime ? `GEX ${r.regime} · confianza ${r.confidence} · sesgo ${r.bias}` : "sin GEX"}
                  color={r.regime === "negativo" ? DOWN : r.regime === "positivo" ? UP : undefined}
                />
              </div>

              <RangeBar r={r} price={price} fmt={fmt} fut={fut} inSession={inSession && marketOpen} />

              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                {r.lecturas.map((l) => <li key={l}>{l}</li>)}
                {r.biasWhy.map((l) => <li key={l} style={{ color: "var(--muted)" }}>{l}</li>)}
                {r.events.length > 0 && <li style={{ color: "var(--amber-text)" }}>⚠ Evento hoy: {r.events.join(", ")} — el rango puede romperse a la hora del anuncio.</li>}
              </ul>

              {/* Escenarios */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 10 }}>
                {r.scenarios.map((s) => (
                  <div key={s.kind} style={{
                    border: `1px solid ${s.kind === "base" ? "var(--border)" : s.kind === "alcista" ? "rgba(18,183,106,0.45)" : "rgba(249,112,102,0.45)"}`,
                    borderRadius: 10, padding: "10px 12px", background: "var(--panel-2)", display: "flex", flexDirection: "column", gap: 4,
                  }}>
                    <b style={{ fontSize: 13, color: s.kind === "alcista" ? UP : s.kind === "bajista" ? DOWN : "var(--text)" }}>
                      {s.kind === "base" ? "◆" : s.kind === "alcista" ? "▲" : "▼"} {s.title}
                    </b>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{s.text}</span>
                  </div>
                ))}
              </div>

              <Positions r={r} fmt={fmt} fut={fut} price={price} />

              {day && day.snapshots.length > 1 && <Path snaps={day.snapshots} fmt={fmt} />}

              {day?.grade && (
                <div style={{ fontSize: 13, padding: "8px 12px", borderRadius: 8, background: "var(--panel-2)", border: `1px solid ${day.grade.insideRange ? "rgba(18,183,106,0.45)" : "rgba(253,176,34,0.45)"}` }}>
                  <b>Resultado del día:</b> máx {fmt(day.grade.high, 2)} · mín {fmt(day.grade.low, 2)} · cierre {fmt(day.grade.close, 2)} → {day.grade.notes.join("; ") || "sin notas"}.
                </div>
              )}

              <History rows={data?.history ?? []} fmt={fmt} />

              <div style={{ fontSize: 11, color: "var(--faint)" }}>
                Cómo se calcula: precio implícito = cierre anterior + lo que se movió el futuro desde las 4 pm. Movimiento esperado = straddle ATM ÷ 0.8 (≈ 1 desviación estándar).
                Piso/techo = paredes de puts/calls del vencimiento {r.expiration} (GEX recalculado con el precio de pre-mercado) entre 0.3σ y 1.6σ del precio; si no hay, ±1σ.
                El pronóstico que se califica es la última lectura antes de las 9:30; al cierre se compara con el máximo y mínimo real (cierres de 5 min).
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = { fontSize: 12, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 };
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
const hm = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
function fechaLarga(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
}

function PhaseChip({ data }: { data: PremarketPayload }) {
  const d = data.day;
  const txt = data.phase === "sesion"
    ? d?.frozen ? `pronóstico de las ${hm(d.frozen.asOf)} NY · sesión en curso` : "sesión en curso"
    : d ? `pre-mercado en curso · actualizado ${hm(d.report.asOf)} NY` : "pre-mercado";
  return (
    <span style={{ fontSize: 12, padding: "2px 10px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--panel-2)", color: data.phase === "sesion" ? "var(--muted)" : "var(--amber-text)" }}>
      {txt}
    </span>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--faint)", overflowWrap: "anywhere" }}>{sub}</div>}
    </div>
  );
}

/** Barra horizontal: rango extendido, rango probable, niveles y el precio. */
function RangeBar({ r, price, fmt, fut, inSession }: { r: PremarketReport; price: number | null; fmt: (v: number | null, d?: number) => string; fut: (v: number) => string; inSession: boolean }) {
  const W = 1000, H = 132, PAD = 24, BAR_Y = 62, BAR_H = 16;
  const vals = [r.extended.low, r.extended.high, ...r.marks.map((m) => m.price), ...(price != null ? [price] : [])];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.04;
  lo -= pad; hi += pad;
  const x = (v: number) => PAD + ((v - lo) / (hi - lo)) * (W - 2 * PAD);
  // Etiquetas en carriles arriba/abajo para que no se encimen.
  const marks = [...r.marks].sort((a, b) => a.price - b.price);
  const lanes: number[][] = [[], [], [], []]; // 0,1 arriba · 2,3 abajo
  const placed = marks.map((m, i) => {
    const px = x(m.price);
    const w = (m.label.length + 8) * 6.2;
    const prefer = m.kind === "techo" || m.kind === "piso" || m.kind === "magneto" ? [0, 1, 2, 3] : i % 2 ? [2, 3, 0, 1] : [0, 1, 2, 3];
    let lane = prefer.find((l) => lanes[l].every((ox) => Math.abs(ox - px) > w * 0.55)) ?? prefer[0];
    lanes[lane].push(px);
    return { m, px, lane };
  });
  const laneY = (l: number) => (l === 0 ? BAR_Y - 30 : l === 1 ? BAR_Y - 14 : l === 2 ? BAR_Y + BAR_H + 18 : BAR_Y + BAR_H + 34);
  const inRange = price != null && price >= r.range.low && price <= r.range.high;
  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 560, display: "block", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        {/* Extendido */}
        <rect x={x(r.extended.low)} y={BAR_Y} width={Math.max(0, x(r.extended.high) - x(r.extended.low))} height={BAR_H} rx={8} fill="rgba(148,163,184,0.12)" />
        {/* Probable */}
        <rect x={x(r.range.low)} y={BAR_Y} width={Math.max(0, x(r.range.high) - x(r.range.low))} height={BAR_H} rx={8} fill="rgba(47,107,255,0.30)" stroke="rgba(122,162,255,0.8)" />
        <text x={x(r.range.low) + 10} y={BAR_Y + 12} fontSize={10.5} fill="#dbe4ff" fontWeight={600}>rango probable</text>
        {placed.map(({ m, px, lane }) => {
          const ly = laneY(lane);
          const above = lane < 2;
          const strong = m.kind === "techo" || m.kind === "piso" || m.kind === "magneto";
          return (
            <g key={`${m.label}-${m.price}`}>
              <title>{`${m.label}: ${fmt(m.price, 2)}${fut(m.price)}`}</title>
              <line x1={px} x2={px} y1={above ? ly + 3 : BAR_Y + BAR_H} y2={above ? BAR_Y : ly - 10} stroke={MARK_COLOR[m.kind]} strokeWidth={strong ? 1.6 : 1} strokeDasharray={strong ? undefined : "3 3"} opacity={0.9} />
              <text x={px} y={ly} fontSize={11} textAnchor="middle" fill={MARK_COLOR[m.kind]} fontWeight={strong ? 700 : 400}>{m.label} {fmt(m.price)}</text>
            </g>
          );
        })}
        {price != null && (
          <g>
            <circle cx={x(price)} cy={BAR_Y + BAR_H / 2} r={7} fill={inRange ? "#f5f7fb" : "#facc15"} stroke="#0b1020" strokeWidth={2} />
            <text x={x(price)} y={H - 4} fontSize={11} textAnchor="middle" fill={inRange ? "#f5f7fb" : "#facc15"} fontWeight={700}>
              {inSession ? "ahora" : "precio implícito"} {fmt(price, 2)}{inSession && !inRange ? " · FUERA del rango" : ""}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function Positions({ r, fmt, fut, price }: { r: PremarketReport; fmt: (v: number | null, d?: number) => string; fut: (v: number) => string; price: number | null }) {
  const maxOi = Math.max(1, ...r.positions.map((p) => Math.max(p.callOi, p.putOi)));
  const th: React.CSSProperties = { textAlign: "left", padding: "5px 8px", color: "var(--muted)", fontWeight: 500, fontSize: 12, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { textAlign: "left", padding: "5px 8px", fontSize: 13, borderBottom: "1px solid var(--border-soft)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  const d = (v: number | null) => (v == null ? "" : v === 0 ? "=" : `${v > 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US")}`);
  const row = (p: PremarketPosition, showDelta: boolean) => {
    const near = price != null && Math.abs(p.strike - price) <= r.sigma * 0.15;
    return (
      <tr key={p.strike} style={near ? { background: "rgba(47,107,255,0.10)" } : undefined}>
        <td style={{ ...td, fontWeight: 700 }} title={fut(p.strike).replace(" · ", "") || undefined}>{fmt(p.strike, p.strike % 1 ? 2 : 0)}</td>
        <td style={td}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
            <span>{p.callOi.toLocaleString("en-US")}</span>
            <span style={{ display: "inline-block", width: 70 * (p.callOi / maxOi), height: 8, borderRadius: 2, background: UP, opacity: 0.8 }} />
          </div>
        </td>
        <td style={td}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 70 * (p.putOi / maxOi), height: 8, borderRadius: 2, background: DOWN, opacity: 0.8 }} />
            <span>{p.putOi.toLocaleString("en-US")}</span>
          </div>
        </td>
        {showDelta && <td style={{ ...td, color: "var(--muted)" }}>{d(p.dCall)} / {d(p.dPut)}</td>}
        <td style={td}>{p.tags.map((t) => <span key={t} style={{ fontSize: 11, padding: "1px 6px", borderRadius: 999, border: "1px solid var(--border)", marginRight: 4 }}>{t}</span>)}</td>
        <td style={{ ...td, color: "var(--muted)", whiteSpace: "normal", minWidth: 220 }}>{p.lectura}</td>
      </tr>
    );
  };
  const hasPrev = r.oiPrevAt != null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <b style={{ fontSize: 13 }}>Posiciones importantes (open interest del vencimiento {r.expiration}, ±1.5σ del precio)</b>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Strike</th><th style={{ ...th, textAlign: "right" }}>Calls</th><th style={th}>Puts</th>
              {hasPrev && <th style={th}>Δ calls / puts</th>}<th style={th}>Nivel</th><th style={th}>Qué significa</th>
            </tr>
          </thead>
          <tbody>{r.positions.map((p) => row(p, hasPrev))}</tbody>
        </table>
      </div>
      {hasPrev ? (
        r.newPositions.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            <b style={{ color: "var(--text)" }}>Posiciones nuevas</b> (OI que entró desde la foto del {new Date(r.oiPrevAt!).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}):{" "}
            {r.newPositions.map((p) => `${fmt(p.strike, p.strike % 1 ? 2 : 0)} (${(p.dCall ?? 0) > 0 ? `+${(p.dCall ?? 0).toLocaleString("en-US")} calls` : ""}${(p.dCall ?? 0) > 0 && (p.dPut ?? 0) > 0 ? ", " : ""}${(p.dPut ?? 0) > 0 ? `+${(p.dPut ?? 0).toLocaleString("en-US")} puts` : ""})`).join(" · ")}
          </div>
        )
      ) : (
        <div style={{ fontSize: 12, color: "var(--faint)" }}>Posiciones nuevas: se guardó la primera foto del OI; en cuanto OCC publique el siguiente (cada mañana) se verá qué entró.</div>
      )}
    </div>
  );
}

function Path({ snaps, fmt }: { snaps: PremarketSnapshot[]; fmt: (v: number | null, d?: number) => string }) {
  const rows = snaps.slice(-10).reverse();
  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Cómo se fue moviendo el pre-mercado ({snaps.length} lecturas)</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        {rows.map((s, i) => {
          const prev = rows[i + 1];
          const moved = prev && (prev.low !== s.low || prev.high !== s.high);
          return (
            <div key={s.t} style={{ display: "flex", gap: 12, color: moved ? "var(--text)" : "var(--muted)" }}>
              <span style={{ width: 44 }}>{hm(s.t)}</span>
              <span style={{ width: 110 }}>precio {fmt(s.spot, 2)}</span>
              <span style={{ width: 150 }}>rango {fmt(s.low)} – {fmt(s.high)}</span>
              <span style={{ width: 110 }}>Magneto {fmt(s.magnet)}</span>
              <span>±{fmt(s.sigma, 1)} · {s.confidence}{moved ? " · cambió el rango" : ""}</span>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function History({ rows, fmt }: { rows: PremarketHistoryRow[]; fmt: (v: number | null, d?: number) => string }) {
  if (rows.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--faint)" }}>Historial de aciertos: cada día al cierre se compara el pronóstico con lo que hizo el precio (empieza a llenarse desde el primer día con lectura de pre-mercado).</div>;
  }
  const inside = rows.filter((r) => r.grade.insideRange).length;
  const closeIn = rows.filter((r) => r.grade.closeInside).length;
  const ext = rows.filter((r) => r.grade.insideExtended).length;
  const techo = rows.filter((r) => r.grade.techoHeld != null);
  const piso = rows.filter((r) => r.grade.pisoHeld != null);
  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
        Historial: {inside}/{rows.length} días dentro del rango · cierre dentro {closeIn}/{rows.length} · dentro del extendido {ext}/{rows.length}
        {techo.length > 0 && ` · techo aguantó ${techo.filter((r) => r.grade.techoHeld).length}/${techo.length}`}
        {piso.length > 0 && ` · piso aguantó ${piso.filter((r) => r.grade.pisoHeld).length}/${piso.length}`}
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        {rows.map((r) => (
          <div key={r.date} style={{ display: "flex", gap: 12, color: "var(--muted)" }}>
            <span style={{ width: 80 }}>{r.date}</span>
            <span style={{ width: 150 }}>rango {fmt(r.low)} – {fmt(r.high)}</span>
            <span style={{ width: 160 }}>real {fmt(r.grade.low)} – {fmt(r.grade.high)}</span>
            <span style={{ color: r.grade.insideRange ? UP : "var(--amber-text)" }}>{r.grade.insideRange ? "✓ dentro" : "✗ salió"}</span>
            <span>movió {r.grade.realizedVsExpected}× lo esperado</span>
          </div>
        ))}
      </div>
    </details>
  );
}
