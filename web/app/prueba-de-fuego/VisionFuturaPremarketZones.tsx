"use client";

// Franja "Zonas pre-market" arriba de la escalera (Carlos, 29-oct-2026, con captura de referencia):
// rango principal (piso–techo) y extensión del pronóstico de pre-mercado de ESE día
// (lib/visionFuturaPremarket.ts, guardado en data/vision-futura/premarket/), dónde está el precio
// ahora y a cuántos puntos del techo y del piso. Las mismas zonas se dibujan como líneas en la
// gráfica (capa "Premarket", se prende/apaga con su botón).

import { useEffect, useState } from "react";
import type { PremarketReport } from "@/lib/visionFuturaPremarket";

export const PM_COLOR = "#d4a373";

/** Pronóstico guardado del día `date` (o null). Se refresca cada 5 min (antes de abrir se actualiza). */
export function usePremarketZones(inst: string, date: string | null): PremarketReport | null {
  const [rep, setRep] = useState<PremarketReport | null>(null);
  useEffect(() => {
    if (!date) { setRep(null); return; }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/vision-futura/premarket?inst=${encodeURIComponent(inst)}&day=${date}`, { cache: "no-store" });
        const j = await res.json();
        if (alive) setRep(res.ok ? (j.report as PremarketReport | null) : null);
      } catch { if (alive) setRep(null); }
    };
    load();
    const id = window.setInterval(load, 5 * 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [inst, date]);
  return rep;
}

const f0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const f2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function VisionFuturaPremarketZones({ report, spot, date, main }: { report: PremarketReport | null; spot: number; date: string | null; main: string }) {
  const [info, setInfo] = useState(false);
  const box: React.CSSProperties = {
    display: "flex", flexDirection: "column", gap: 6, padding: "8px 12px", borderRadius: 10,
    background: "rgba(212,163,115,0.07)", border: "1px solid rgba(212,163,115,0.35)", borderLeft: `3px solid ${PM_COLOR}`, fontSize: 12,
  };
  if (!report) {
    return (
      <div style={box}>
        <span><b style={{ color: PM_COLOR }}>Zonas pre-market</b> <span style={{ color: "var(--muted)" }}>· sin pronóstico de pre-mercado guardado para {date ?? "este día"} (se arma solo entre semana de 7:00 a 9:30).</span></span>
      </div>
    );
  }
  const { low, high } = report.range;
  const ext = report.extended;
  const inside = spot >= low && spot <= high;
  const status = inside
    ? { text: "✓ dentro del rango", color: "var(--green)", bg: "var(--green-bg)" }
    : spot > high
      ? { text: spot > ext.high ? `▲ arriba de la extensión (+${f0(spot - ext.high)})` : `▲ rompió el techo (+${f0(spot - high)})`, color: "#7aa2ff", bg: "var(--accent-dim)" }
      : { text: spot < ext.low ? `▼ abajo de la extensión (−${f0(ext.low - spot)})` : `▼ rompió el piso (−${f0(low - spot)})`, color: "var(--red-soft)", bg: "var(--red-bg)" };
  return (
    <div style={box}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "center", fontVariantNumeric: "tabular-nums" }}>
        <b style={{ color: PM_COLOR }}>Zonas pre-market</b>
        <span style={{ color: "var(--muted)" }}>Rango principal <b style={{ color: "var(--text)" }}>{f0(low)}–{f0(high)}</b> ({f0(high - low)} pts)</span>
        <span style={{ color: "var(--muted)" }}>Extensión <b style={{ color: "var(--text)" }}>{f0(ext.low)}</b> abajo · <b style={{ color: "var(--text)" }}>{f0(ext.high)}</b> arriba</span>
        <span style={{ color: "var(--muted)" }}>Precio ahora <b style={{ color: "var(--text)" }}>{f2(spot)}</b></span>
        <span style={{ padding: "1px 8px", borderRadius: 999, background: status.bg, color: status.color, fontWeight: 600 }}>{status.text}</span>
        {inside && <span style={{ color: "var(--muted)" }}>a {f0(high - spot)} pts del techo y {f0(spot - low)} del piso</span>}
        <button onClick={() => setInfo(!info)} aria-label="Cómo se calcula" title="Cómo se calcula"
          style={{ marginLeft: "auto", width: 22, height: 22, borderRadius: 999, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 12, padding: 0 }}>i</button>
      </div>
      {info && (
        <div style={{ color: "var(--muted)", lineHeight: 1.5 }}>
          Pronóstico de {main} hecho antes de la apertura ({report.targetDate}, lectura de las{" "}
          {new Date(report.asOf).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false })} NY).
          Techo {f0(report.techo.price)}: {report.techo.why}. Piso {f0(report.piso.price)}: {report.piso.why}.
          Extensión = ±1.5σ del movimiento esperado (σ {f0(report.sigma)} pts, {report.sigmaSource}). Confianza {report.confidence}, sesgo {report.bias}.
          En la gráfica: línea sólida = rango principal, punteada = extensión (botón "Premarket").
        </div>
      )}
    </div>
  );
}
