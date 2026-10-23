"use client";

// Sección "Spreads" de VisionFutura, debajo de "Alertas y órdenes" (Carlos,
// oct 2026: "contratos de spreads para ganar prima, con alta probabilidad...
// call credit, put credit, call debit, todo"). El cálculo vive en
// lib/visionFuturaSpreads.ts; las cotizaciones son de tastytrade en vivo.

import type { SpreadIdea, SpreadsReport } from "@/lib/visionFuturaSpreads";
import type { ReplaySpreadTrade } from "@/lib/visionFuturaReplay";
import VisionFuturaSpreadTrades from "./VisionFuturaSpreadTrades";

const UP = "var(--green)";
const DOWN = "var(--red-soft)";
const money = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const px = (n: number) => `$${n.toFixed(2)}`;
const lvl = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const GROUPS: { key: keyof Pick<SpreadsReport, "callCredit" | "putCredit" | "callDebit" | "putDebit">; title: string; help: string; color: string }[] = [
  { key: "callCredit", title: "Call credit (bear call)", help: "Cobras prima si el SPX NO sube más allá del strike vendido.", color: DOWN },
  { key: "putCredit", title: "Put credit (bull put)", help: "Cobras prima si el SPX NO baja más allá del strike vendido.", color: UP },
  { key: "callDebit", title: "Call debit", help: "Pagas para ganar si el SPX SUBE hasta el objetivo.", color: UP },
  { key: "putDebit", title: "Put debit", help: "Pagas para ganar si el SPX BAJA hasta el objetivo.", color: DOWN },
];

function Card({ s, color }: { s: SpreadIdea; color: string }) {
  const isCredit = s.netPrice > 0;
  return (
    <div style={{ border: "1px solid var(--border)", borderLeft: `4px solid ${color}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8, background: "var(--panel-2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <b style={{ fontSize: 14 }}>{s.title}</b>
        <span style={{ fontSize: 12, color: s.pop >= 0.8 ? UP : "var(--muted)", fontWeight: 600 }}>{(s.pop * 100).toFixed(1)}% de ganar</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
        {s.legs.map((l, i) => (
          <div key={i}>
            <b style={{ color: l.action === "VENDER" ? "var(--amber-text)" : "var(--accent)" }}>{l.action}</b>{" "}
            {l.type.toUpperCase()} <b>{lvl(l.strike)}</b>{" "}
            <span style={{ color: "var(--muted)" }}>@ {l.side} {px(l.price)}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
        <span>{isCredit ? "Cobras" : "Pagas"} <b style={{ color: "var(--text)" }}>{px(Math.abs(s.netPrice))}</b> ({money(s.netPrice * 100)} por spread)</span>
        <span>Ganancia máx <b style={{ color: UP }}>{money(s.maxGainUsd)}</b></span>
        <span>Pérdida máx <b style={{ color: DOWN }}>{money(s.maxLossUsd)}</b></span>
        <span>Breakeven {s.breakevens.map(lvl).join(" / ")}</span>
        <span>Ganancia/riesgo {s.rr.toFixed(2)}x</span>
        {s.refDelta != null && <span>Delta {s.refDelta.toFixed(2)}</span>}
      </div>
      <div style={{ fontSize: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {s.levels.map((t) => (
          <span key={t} style={{ padding: "1px 8px", borderRadius: 999, border: "1px solid var(--border)", color: "var(--muted)" }}>
            {isCredit && s.structure !== "iron_condor" ? `Protegido por ${t}` : t}
          </span>
        ))}
        {s.outsideVixRange && <span style={{ padding: "1px 8px", borderRadius: 999, border: "1px solid var(--green)", color: UP }}>fuera del rango del VIX</span>}
        {s.withBias && !isCredit && <span style={{ padding: "1px 8px", borderRadius: 999, border: "1px solid var(--accent)", color: "var(--accent)" }}>a favor del sesgo</span>}
      </div>
    </div>
  );
}

export default function VisionFuturaSpreads({ spreads, error, expiration, marketOpen, replay, replayTrades }: {
  spreads: SpreadsReport | null | undefined;
  error: string | null | undefined;
  expiration: string;
  marketOpen: boolean;
  replay: boolean;
  /** En la repetición: el backtest de spreads hasta el momento elegido. */
  replayTrades?: { trades: ReplaySpreadTrade[]; tickMs: number; spot: number; isLastTick: boolean; partial: boolean } | null;
}) {
  return (
    <div className="card" style={{ gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
        <h4 style={{ margin: 0 }}>Spreads</h4>
        {spreads && !replay && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            SPXW vencimiento {expiration} · sesgo del día (Magneto): <b>{spreads.bias}</b> · precios de tastytrade (vende al bid, compra al ask)
          </span>
        )}
      </div>

      {replay ? (
        replayTrades ? <VisionFuturaSpreadTrades {...replayTrades} /> : (
          <div className="wheel-empty" style={{ fontSize: 13 }}>Esta repetición se guardó antes del backtest de spreads: toca “Reconstruir de nuevo” si es la última sesión.</div>
        )
      ) : error && !spreads ? (
        <div style={{ fontSize: 13, color: "var(--amber-text)" }}>{error}</div>
      ) : !spreads ? (
        <div className="wheel-empty" style={{ fontSize: 13 }}>Cargando cotizaciones…</div>
      ) : (
        <>
          {!marketOpen && (
            <div style={{ fontSize: 12, color: "var(--amber-text)" }}>
              Mercado cerrado: precios de referencia del cierre para el vencimiento {expiration}. Confírmalos en tu broker antes de operar.
            </div>
          )}
          {spreads.note && <div className="wheel-empty" style={{ fontSize: 13 }}>{spreads.note}</div>}

          {/* SIEMPRE dos columnas (pedido explícito de Carlos): prima a la izquierda, direccionales a la derecha. */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
            {([
              { title: "Prima (crédito)", groups: GROUPS.filter((g) => g.key === "callCredit" || g.key === "putCredit"), withCondor: true },
              { title: "Direccionales (débito)", groups: GROUPS.filter((g) => g.key === "callDebit" || g.key === "putDebit"), withCondor: false },
            ] as const).map((col) => {
              const count = col.groups.reduce((n, g) => n + spreads[g.key].length, 0) + (col.withCondor && spreads.ironCondor ? 1 : 0);
              return (
                <div key={col.title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
                    <b style={{ fontSize: 14 }}>{col.title}</b> <span style={{ color: "var(--muted)" }}>({count})</span>
                  </div>
                  {count === 0 && <div className="wheel-empty" style={{ fontSize: 13 }}>Ninguno pasa los filtros ahora.</div>}
                  {col.groups.map((g) => spreads[g.key].length > 0 && (
                    <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontSize: 13 }}>
                        <b style={{ color: g.color }}>{g.title}</b> <span style={{ color: "var(--faint)" }}>· {g.help}</span>
                      </div>
                      {spreads[g.key].map((s) => <Card key={s.id} s={s} color={g.color} />)}
                    </div>
                  ))}
                  {col.withCondor && spreads.ironCondor && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontSize: 13 }}>
                        <b style={{ color: "var(--accent)" }}>Iron condor</b> <span style={{ color: "var(--faint)" }}>· Cobras prima si el SPX se queda entre los dos lados.</span>
                      </div>
                      <Card s={spreads.ironCondor} color="var(--accent)" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 12, color: "var(--faint)" }}>
            Crédito: probabilidad ≥ 80% medida en el breakeven, delta de la pata vendida ≤ 0.20, cobro ≥ $0.20 y el strike vendido más allá de un nivel de VisionFutura.
            Débito: el strike vendido es un nivel (el objetivo) y la ganancia máxima ≥ el costo. 1 spread = 100 × el precio. Es una lectura del mercado, no una recomendación.
          </div>
        </>
      )}
    </div>
  );
}
