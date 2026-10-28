"use client";

// Sección "Motor híbrido" de VisionFutura (Carlos, 27-oct-2026): arriba de "Señal del dinero", con
// dos partes — Alertas y órdenes, y Señal del dinero — en su versión mejorada (lib/visionFuturaHybrid.ts).
// Pedido explícito: se muestra SOLO UNA alerta a la vez por parte (la nueva reemplaza a la anterior);
// todas quedan guardadas por dentro (estado del día, repetición, backtest y Excel).

import { useMemo } from "react";
import { HYBRID_TUNING, hybridSummary, resolveHybrid, type HybridDay, type HybridTrade } from "@/lib/visionFuturaHybrid";
import type { Conversion } from "@/lib/visionFutura";
import { useVisionLabels } from "./visionLabels";

const UP = "var(--green)";
const DOWN = "var(--red-soft)";
const n2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hm = (ms: number) => new Date(ms).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

interface Props {
  /** Día del motor híbrido: en vivo, el del servidor; en la repetición, calculado de la repetición. */
  day: HybridDay | null;
  /** Precio para resolver lo abierto en la repetición (serie hasta el momento elegido). */
  replayPrices: { t: number; v: number }[] | null;
  /** Momento que se está viendo (ahora, o la hora de la repetición). */
  nowMs: number;
  conversion: Conversion;
  instrument: string;
  night: boolean;
}

function Status({ t }: { t: HybridTrade }) {
  if (t.outcome == null) return <span style={{ color: "var(--amber-text)", fontWeight: 700 }}>ABIERTA</span>;
  const win = (t.points ?? 0) > 0;
  const label = t.outcome === "objetivo" ? "objetivo ✓" : t.outcome === "stop" ? "stop ✗" : "cierre";
  return (
    <span style={{ color: win ? UP : DOWN, fontWeight: 700 }}>
      {label} {t.points != null && `${t.points > 0 ? "+" : ""}${t.points.toFixed(2)} pts`} {t.exitAt ? `· ${hm(t.exitAt)}` : ""}
    </span>
  );
}

function Card({ kind, list, conversion }: { kind: "alerta" | "senal"; list: HybridTrade[]; conversion: Conversion }) {
  const lb = useVisionLabels();
  const cur = list.at(-1) ?? null;
  const prev = list.length > 1 ? list.at(-2)! : null;
  const s = hybridSummary(list);
  const conv = (v: number) => {
    const parts = [];
    if (lb.etf && conversion.spyRatio) parts.push(`${lb.etf} ${n2(v * conversion.spyRatio)}`);
    if (lb.future && conversion.esBasis != null) parts.push(`${lb.future} ${n2(v + conversion.esBasis)}`);
    return parts.join(" · ");
  };
  const title = kind === "alerta" ? "Alertas y órdenes" : "Señal del dinero";
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--panel-2)", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>{title}</b>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          hoy {s.n} {kind === "alerta" ? "alertas" : "señales"} · {s.wins}G/{s.losses}P · {s.points > 0 ? "+" : ""}{s.points} pts {lb.main} · todas guardadas
        </span>
      </div>
      {!cur ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Sin {kind === "alerta" ? "alertas" : "señales"} todavía.</div>
      ) : (
        <div style={{ borderLeft: `4px solid ${cur.side === "largo" ? UP : DOWN}`, borderRadius: 8, padding: "8px 10px", background: "var(--panel)", display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <b style={{ color: cur.side === "largo" ? UP : DOWN }}>{cur.side === "largo" ? "▲ LARGO" : "▼ CORTO"} · {cur.title}</b>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{hm(cur.at)} NY</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: "var(--muted)" }}>Entrada</span><span><b>{n2(cur.entry)}</b> <span style={{ color: "var(--faint)" }}>{conv(cur.entry)}</span></span>
            <span style={{ color: DOWN }}>Stop</span><span><b>{n2(cur.stop)}</b> <span style={{ color: "var(--faint)" }}>{conv(cur.stop)}</span></span>
            <span style={{ color: UP }}>Objetivo</span><span><b>{n2(cur.target)}</b> <span style={{ color: "var(--faint)" }}>{conv(cur.target)}</span></span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Riesgo {cur.riskPts} pts · Recompensa {cur.rewardPts} pts · {cur.note}</div>
          <div style={{ fontSize: 13 }}><Status t={cur} /></div>
          {prev && <div style={{ fontSize: 11, color: "var(--faint)" }}>Reemplaza a la de las {hm(prev.at)} ({prev.side === "largo" ? "largo" : "corto"} {n2(prev.entry)} · {prev.outcome ?? "abierta"}{prev.points != null ? ` ${prev.points > 0 ? "+" : ""}${prev.points}` : ""}).</div>}
        </div>
      )}
    </div>
  );
}

export default function VisionFuturaHybrid({ day, replayPrices, nowMs, conversion, instrument, night }: Props) {
  // Solo lo que ya salió a esta hora; en la repetición, resuelto con el precio hasta este momento.
  const view = useMemo(() => {
    if (!day) return { alerts: [] as HybridTrade[], money: [] as HybridTrade[], blocked: [] as HybridDay["blocked"] };
    const upTo = (l: HybridTrade[]) => l.filter((t) => t.at <= nowMs).sort((a, b) => a.at - b.at);
    // En la repetición: precio de 5 min hasta el momento elegido; en el último paso, lo abierto sale al cierre.
    const lastT = replayPrices?.at(-1)?.t ?? Infinity;
    const fix = (l: HybridTrade[]) => (replayPrices ? l.map((t) => resolveHybrid({ ...t, outcome: null, exit: null, exitAt: null, points: null }, replayPrices.filter((p) => p.t <= nowMs), nowMs >= lastT)) : l);
    return { alerts: fix(upTo(day.alerts)), money: fix(upTo(day.money)), blocked: day.blocked.filter((b) => b.at <= nowMs) };
  }, [day, replayPrices, nowMs]);
  if (night) return null;
  const lastBlocked = view.blocked.at(-1);
  return (
    <div className="card" style={{ gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
        <h4 style={{ margin: 0 }}>⚙️ Motor híbrido</h4>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>las mismas alertas y señales, con las mejoras medidas · una a la vez</span>
      </div>
      {instrument === "NQ" && (
        <div style={{ fontSize: 12, color: "var(--amber-text)" }}>Ojo: en NQ estas mejoras no dieron ventaja en el backtest (4 días). Úsalo como lectura.</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 12 }}>
        <Card kind="alerta" list={view.alerts} conversion={conversion} />
        <Card kind="senal" list={view.money} conversion={conversion} />
      </div>
      {lastBlocked && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Última bloqueada ({hm(lastBlocked.at)}, {lastBlocked.source === "alerta" ? "alerta" : "señal"}): {lastBlocked.title} — {lastBlocked.reason}. Bloqueadas hoy: {view.blocked.length}.
        </div>
      )}
      <details style={{ fontSize: 12, color: "var(--muted)" }}>
        <summary style={{ cursor: "pointer" }}>Qué cambia contra los motores normales</summary>
        <ul style={{ margin: "6px 0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <li><b>Alertas:</b> nada antes de las 9:45; nada si el piso/techo está a ≤ {HYBRID_TUNING.magnetPts} pts del Magneto (escalado por instrumento); stop {HYBRID_TUNING.stopMult}× y objetivo {HYBRID_TUNING.targetMult}× del scalp (SPX: 6 y 4.5 pts).</li>
          <li><b>Señal del dinero:</b> no entra si hay un piso, imán o Magneto en contra entre la entrada y el objetivo.</li>
          <li>Backtest con velas de 1 min, 4 días SPX: alertas −$1,500 → +$1,725; señales −$1,405 → +$867 (por contrato /ES). Muestra chica: se decide el 4-nov.</li>
          <li>Se muestra solo la última de cada tipo; todas quedan guardadas en el día, la repetición, el backtest y el Excel.</li>
          <li>En la repetición el resultado se ve con el precio de 5 min; el backtest y el Excel lo califican con velas de 1 min (más exigente).</li>
        </ul>
      </details>
    </div>
  );
}
