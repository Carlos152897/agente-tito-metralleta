"use client";

// Lista de cambios de posicionamiento Long/Short del día (traído del zip "visionfutura-main",
// oct-2026): entra, cambia de lado, sale, agresor inusual y marcas de presión. La más reciente arriba.

import { useState } from "react";
import type { PosHistory } from "@/lib/visionFuturaPositioning";

const LONG = "#12b76a";
const SHORT = "#a855f7";
const YELLOW = "#fdb022";

const hm = (ms: number) => new Date(ms).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

export default function VisionFuturaPositionLog({ positions }: { positions: Pick<PosHistory, "segments" | "events"> | null | undefined }) {
  const [all, setAll] = useState(false);
  const [onlyPressure, setOnlyPressure] = useState(false);
  if (!positions) return null;
  const ev = [...positions.events].reverse().filter((e) => !onlyPressure || e.kind === "presion");
  const shown = all ? ev : ev.slice(0, 10);
  const color = (e: (typeof ev)[number]) => (e.kind === "prende" ? (e.text?.startsWith("⇄") ? "#9aa5c0" : YELLOW) : e.kind === "sale" ? "#9aa5c0" : e.side === "L" ? LONG : SHORT);
  const nowLong = positions.segments.filter((s) => s.end == null && s.side === "L").length;
  const nowShort = positions.segments.filter((s) => s.end == null && s.side === "S").length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <b style={{ fontSize: 13 }}>Cambios de posicionamiento de hoy{ev.length > 0 ? ` (${ev.length})` : ""}</b>
        <span style={{ color: "var(--muted)" }}>
          ahora <span style={{ color: LONG }}>{nowLong} Long</span> · <span style={{ color: SHORT }}>{nowShort} Short</span>
        </span>
        <label style={{ color: "var(--muted)", display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={onlyPressure} onChange={(e) => setOnlyPressure(e.target.checked)} /> solo presión
        </label>
      </div>
      {ev.length === 0 ? (
        <div style={{ color: "var(--faint)" }}>Sin cambios todavía.</div>
      ) : (
        <div style={{ display: "grid", gap: 2, fontVariantNumeric: "tabular-nums" }}>
          {shown.map((e, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "48px 70px 1fr", gap: 8 }}>
              <span style={{ color: "var(--faint)" }}>{hm(e.t)}</span>
              <span>{e.strike.toLocaleString("en-US", { maximumFractionDigits: 1 })}</span>
              <span style={{ color: color(e) }}>{e.text}</span>
            </div>
          ))}
        </div>
      )}
      {ev.length > 10 && (
        <button onClick={() => setAll(!all)} style={{ alignSelf: "flex-start", fontSize: 12, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}>
          {all ? "Ver menos" : `Ver los ${ev.length}`}
        </button>
      )}
      <div style={{ color: "var(--faint)" }}>
        Long = calls compradas + puts vendidas le ganan a calls vendidas + puts compradas en ese strike (Short al revés); cuenta si es ≥ 10% del strike más fuerte y el cambio se sostiene 2 lecturas (≥ 1 min).
        Presión (● verde Long / ● morada Short en la gráfica) = el precio está a ≤ 1 strike de un strike posicionado y entran ≥ $250K nuevos a favor de su lado. Es para observar y medir, no una entrada.
      </div>
    </div>
  );
}
