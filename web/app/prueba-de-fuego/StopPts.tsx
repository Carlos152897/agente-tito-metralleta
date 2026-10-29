"use client";

// Etiqueta "🛑 Stop: X pts" que va en cada motor (Carlos, 29-oct-2026: "agrega a cada motor
// cuántos puntos son de stop loss, para poder guiarme"). Los puntos son los mismos en el índice
// y en su futuro (la base solo desplaza el precio), así que se muestran juntos con lo que cuesta
// en dólares por contrato grande y por micro.

import { useVisionLabels } from "./visionLabels";

interface Contract { label: string; big: number; micro: number; microLabel: string }

/** Contrato del futuro según la etiqueta (/ES… o /NQ…); null si no hay futuro (acciones). */
function contractOf(sym: string | null): Contract | null {
  if (!sym) return null;
  if (/NQ/i.test(sym)) return { label: sym, big: 20, micro: 2, microLabel: "/MNQ" };
  if (/ES/i.test(sym)) return { label: sym, big: 50, micro: 5, microLabel: "/MES" };
  return null;
}

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 })}`;

export default function StopPts({ pts, compact }: { pts: number | null | undefined; compact?: boolean }) {
  const lb = useVisionLabels();
  if (pts == null || !Number.isFinite(pts)) return null;
  const p = Math.abs(pts);
  // De noche el principal ya es el futuro (/ESZ6); de día, el futuro va aparte.
  const fut = contractOf(lb.future) ?? (lb.main.startsWith("/") ? contractOf(lb.main) : null);
  const ptsTxt = `${p.toFixed(2)} pts`;
  const sameAs = fut && fut.label !== lb.main ? ` ${lb.main} = ${ptsTxt} ${fut.label}` : ` ${fut ? fut.label : lb.main}`;
  const money = fut
    ? `−${usd(p * fut.big)} por 1 ${fut.label.replace(/[A-Z]\d$/, "")} · −${usd(p * fut.micro)} por 1 ${fut.microLabel}`
    : `−${usd(p * 100)} por 100 acciones`;
  if (compact) {
    return (
      <span style={{ color: "var(--red-soft)", fontWeight: 700, whiteSpace: "nowrap" }} title={`${ptsTxt}${sameAs} · ${money}`}>
        −{p.toFixed(2)}
      </span>
    );
  }
  return (
    <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "baseline", alignSelf: "flex-start", padding: "3px 10px", borderRadius: 8, border: "1px solid var(--red-soft)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
      <b style={{ color: "var(--red-soft)" }}>🛑 Stop: {ptsTxt}</b>
      <span style={{ color: "var(--muted)" }}>{sameAs.trim()} · {money}</span>
    </div>
  );
}
