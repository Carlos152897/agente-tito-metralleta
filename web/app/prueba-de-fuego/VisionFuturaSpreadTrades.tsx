"use client";

// Backtest de spreads dentro de la repetición (Carlos, oct 2026: "si se da una
// alerta de un spread dame la notificación, la ejecutas y me dices cuánto se
// ganó o perdió"). Cada alerta de VisionFutura "ejecuta" su spread de prima y
// su spread direccional (lib/visionFuturaReplay.ts); acá se muestran a medida
// que avanza la repetición: la notificación al abrirse, el resultado "si el
// SPX terminara aquí" mientras sigue el día, y el resultado final al cierre.

import type { ReplaySpreadTrade } from "@/lib/visionFuturaReplay";
import { spreadPnlAtExpiry } from "@/lib/visionFuturaSpreads";

const UP = "var(--green)";
const DOWN = "var(--red-soft)";
const usd = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const lvl = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const hmNy = (ms: number) => new Date(ms).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

export default function VisionFuturaSpreadTrades({ trades, tickMs, spot, isLastTick, partial }: {
  trades: ReplaySpreadTrade[];
  tickMs: number;
  spot: number;
  isLastTick: boolean;
  partial: boolean;
}) {
  const open = trades.filter((t) => t.openedAt <= tickMs).sort((a, b) => b.openedAt - a.openedAt);
  const justOpened = open.filter((t) => t.openedAt === tickMs);
  const final = isLastTick && !partial;
  // Resultado de cada uno: final (al vencimiento) en el último momento; si no, "si terminara aquí".
  const pnlOf = (t: ReplaySpreadTrade) => (final && t.pnlUsd != null ? t.pnlUsd : spreadPnlAtExpiry(t.idea, spot) * 100);
  const total = open.reduce((s, t) => s + pnlOf(t), 0);
  const credit = open.filter((t) => t.kind === "credito");
  const debit = open.filter((t) => t.kind === "debito");
  const sum = (arr: ReplaySpreadTrade[]) => arr.reduce((s, t) => s + pnlOf(t), 0);
  const allFinal = trades.filter((t) => t.pnlUsd != null);
  const dayTotal = allFinal.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {justOpened.map((t) => (
        <div key={`n-${t.id}`} style={{ border: "1px solid var(--accent)", background: "var(--accent-dim)", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
          🔔 <b>{hmNy(t.openedAt)} · Spread ejecutado</b> por la alerta “{t.alertTitle}”: <b>{t.idea.title}</b>{" "}
          ({t.kind === "credito" ? `cobras $${t.idea.netPrice.toFixed(2)}` : `pagas $${Math.abs(t.idea.netPrice).toFixed(2)}`} por acción)
        </div>
      ))}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, alignItems: "baseline" }}>
        <span><b>{open.length}</b> spreads ejecutados {final ? "en el día" : "hasta esta hora"}</span>
        <span>
          {final ? "Resultado final (al vencimiento)" : `Si el SPX terminara aquí (${lvl(spot)})`}:{" "}
          <b style={{ color: total >= 0 ? UP : DOWN, fontSize: 15 }}>{usd(total)}</b>
        </span>
        <span style={{ color: "var(--muted)" }}>
          Prima: <b style={{ color: sum(credit) >= 0 ? UP : DOWN }}>{usd(sum(credit))}</b> ({credit.length}) · Direccionales:{" "}
          <b style={{ color: sum(debit) >= 0 ? UP : DOWN }}>{usd(sum(debit))}</b> ({debit.length})
        </span>
        {!final && allFinal.length > 0 && (
          <span style={{ color: "var(--faint)" }}>Total del día completo: {usd(dayTotal)} (ve al cierre ⏭)</span>
        )}
      </div>

      {open.length === 0 ? (
        <div className="wheel-empty" style={{ fontSize: 13 }}>Todavía no se ejecutó ningún spread a esta hora. Se ejecutan cuando se dispara una alerta.</div>
      ) : (
        // SIEMPRE dos columnas (pedido explícito de Carlos): prima a la izquierda,
        // direccionales a la derecha — no se apilan en pantallas angostas.
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
          {([
            { list: credit, title: "Prima (crédito)", help: "Cobras prima; ganan si el SPX no llega al strike vendido." },
            { list: debit, title: "Direccionales (débito)", help: "Pagas; ganan si el SPX llega al objetivo." },
          ] as const).map((col) => (
            <div key={col.title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
                <b style={{ fontSize: 14 }}>{col.title} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({col.list.length})</span></b>
                <b style={{ color: sum(col.list) >= 0 ? UP : DOWN }}>{usd(sum(col.list))}</b>
              </div>
              <div style={{ fontSize: 12, color: "var(--faint)", marginTop: -4 }}>
                {col.help}{" "}
                {col.list.length > 0 && (
                  <span style={{ color: "var(--muted)" }}>
                    · {final ? "Ganadas" : "Van ganando"} <b style={{ color: UP }}>{col.list.filter((t) => pnlOf(t) >= 0).length}</b> ·{" "}
                    {final ? "Perdidas" : "Van perdiendo"} <b style={{ color: DOWN }}>{col.list.filter((t) => pnlOf(t) < 0).length}</b>
                  </span>
                )}
              </div>
              {col.list.length === 0 && <div className="wheel-empty" style={{ fontSize: 13 }}>Ninguno todavía.</div>}
              {col.list.map((t) => {
                const pnl = pnlOf(t);
                const color = t.kind === "credito" ? (t.direction === "alcista" ? UP : DOWN) : "var(--accent)";
                return (
                  <div key={t.id} style={{ border: "1px solid var(--border)", borderLeft: `4px solid ${color}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 6, background: "var(--panel-2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <b style={{ fontSize: 14 }}>{t.idea.title}</b>
                      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{hmNy(t.openedAt)}</span>
                        {/* Ganada / perdida: definitiva al cierre; durante el día, cómo va. */}
                        <span style={{
                          fontSize: 11, fontWeight: 700, letterSpacing: 0.4, padding: "2px 8px", borderRadius: 999,
                          color: pnl >= 0 ? UP : DOWN,
                          background: pnl >= 0 ? "var(--green-bg)" : "var(--red-bg)",
                          border: `1px solid ${pnl >= 0 ? UP : DOWN}`,
                        }}>
                          {final ? (pnl >= 0 ? "GANADA" : "PERDIDA") : (pnl >= 0 ? "va ganando" : "va perdiendo")}
                        </span>
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--faint)" }}>Por la alerta: {t.alertTitle} · SPX al abrir {lvl(t.spotAtOpen)}</div>
                    <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", display: "flex", flexDirection: "column", gap: 2 }}>
                      {t.idea.legs.map((l, i) => (
                        <div key={i}>
                          <b style={{ color: l.action === "VENDER" ? "var(--amber-text)" : "var(--accent)" }}>{l.action}</b> {l.type.toUpperCase()} <b>{lvl(l.strike)}</b>{" "}
                          <span style={{ color: "var(--muted)" }}>@ {l.side} ${l.price.toFixed(2)}</span>{" "}
                          <span style={{ fontSize: 11, color: t.legSources[i] === "real" ? "var(--faint)" : "var(--amber-text)" }}>
                            ({t.legSources[i] === "real" ? "llenado real" : "estimado"})
                          </span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {t.idea.netPrice > 0 ? `Cobrado $${t.idea.netPrice.toFixed(2)}` : `Pagado $${Math.abs(t.idea.netPrice).toFixed(2)}`} · ganancia máx ${t.idea.maxGainUsd} · pérdida máx ${t.idea.maxLossUsd} · {(t.idea.pop * 100).toFixed(0)}% de ganar al abrir
                    </div>
                    <div style={{ fontSize: 14 }}>
                      {final ? `Cerrado al vencimiento (${lvl(t.settle ?? spot)}): ` : "Si terminara aquí: "}
                      <b style={{ color: pnl >= 0 ? UP : DOWN }}>{usd(pnl)}</b>
                      {final && <span> {pnl >= 0 ? "✅" : "❌"}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: "var(--faint)" }}>
        Cada alerta ejecuta 2 spreads: uno de prima (crédito protegido por el nivel de la alerta) y uno direccional (débito hacia el objetivo).
        Precio de cada pata = promedio real al que se llenó en MarketSnack en los últimos 15 min. Se mantienen hasta el vencimiento; 1 spread = 100 × el precio. Sin comisiones.
      </div>
    </div>
  );
}
