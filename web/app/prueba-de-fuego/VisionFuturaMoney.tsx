"use client";

// Sección "🧭 Señal del dinero" de VisionFutura (Carlos, 23-oct-2026): la receta de las 5 preguntas
// hecha regla (lib/visionFuturaMoneyFlow.ts). Muestra hacia dónde apunta el dinero ahora (4 votos),
// la señal LONG/SHORT con entrada, objetivo y stop, y las señales del día con su resultado.

import type { MoneyReading, MoneyTrade } from "@/lib/visionFuturaMoneyFlow";
import { FutureFirstNote } from "./VisionFuturaAlerts";
import { toFuture, useFutureFirst } from "./visionLabels";

const UP = "var(--green)";
const DOWN = "var(--red-soft)";
const k = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hm = (ms: number) => new Date(ms).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const pts = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;
const usd = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

interface Props {
  reading: MoneyReading | null;
  trades: MoneyTrade[];
  /** Repetición: momento y precio del paso (para filtrar y valuar). */
  replay: { tickMs: number; spot: number; isLastTick: boolean; partial: boolean } | null;
  spot: number;
  marketOpen: boolean;
  night: boolean;
  main: string;
  /** Cómo se opera cada lado (texto) y conversiones al ETF / futuro. */
  instrumentos: { largo: string; corto: string };
  conv: (spx: number) => { spy: number | null; es: number | null };
  etfLabel: string | null;
  futLabel: string | null;
  mult: { big: number; bigLabel: string };
}

export default function VisionFuturaMoney(p: Props) {
  const { reading, replay } = p;
  const nowMs = replay ? replay.tickMs : Date.now();
  const spotNow = replay ? replay.spot : p.spot;
  const trades = p.trades
    .filter((t) => t.openedAt <= nowMs)
    .map((t) => {
      // En la repetición, un resultado "del futuro" todavía no se ve.
      const closed = t.outcome != null && t.exitAt != null && t.exitAt <= nowMs && (t.outcome !== "cierre" || !replay || replay.isLastTick);
      const running = Math.round((t.side === "largo" ? spotNow - t.entry : t.entry - spotNow) * 100) / 100;
      return { t, closed, value: closed ? t.points ?? 0 : running };
    });
  const total = trades.reduce((a, x) => a + x.value, 0);
  const wins = trades.filter((x) => x.closed && x.value > 0).length, losses = trades.filter((x) => x.closed && x.value < 0).length;
  const open = trades.find((x) => !x.closed);
  const sig = reading?.signal ?? null;
  const leanColor = reading?.lean === "alcista" ? UP : reading?.lean === "bajista" ? DOWN : "var(--muted)";
  const ff = useFutureFirst();
  const futOn = ff.on && ff.basis != null;
  const eq = (spx: number) => {
    const c = p.conv(spx);
    // NQ en vivo: el futuro va primero (px) y acá queda el índice de referencia.
    const parts = futOn
      ? [`${p.main} ${spx.toFixed(2)}`, c.spy != null && p.etfLabel ? `${p.etfLabel} ${c.spy.toFixed(2)}` : null].filter(Boolean)
      : [c.spy != null && p.etfLabel ? `${p.etfLabel} ${c.spy.toFixed(2)}` : null, c.es != null && p.futLabel ? `${p.futLabel} ${c.es.toFixed(2)}` : null].filter(Boolean);
    return parts.length ? ` (${parts.join(" · ")})` : "";
  };
  /** Precio principal: el futuro con NQ en vivo; el índice si no. */
  const px = (v: number, basis: number | null | undefined = ff.basis) => { const f = toFuture(ff, v, basis); return f != null ? `${ff.label} ${k(f)}` : k(v); };

  return (
    <div className="card" style={{ gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
        <h4 style={{ margin: 0 }}>🧭 Señal del dinero</h4>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Hacia dónde apunta el dinero · LONG/SHORT con objetivo y stop · desde las 9:45 NY · una operación a la vez</span>
      </div>

      <details style={{ fontSize: 12, color: "var(--muted)" }}>
        <summary style={{ cursor: "pointer" }}>Cómo decide</summary>
        <ul style={{ margin: "6px 0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <li>4 votos: <b>Imán</b> (Magneto arriba/abajo) · <b>Apuestas del día</b> (verde vs morado) · <b>Dinero nuevo 15 min</b> (qué crece más) · <b>Barra más grande</b> (arriba/abajo).</li>
          <li>Dispara cuando el <b>dinero nuevo</b> tiene dirección (es el que manda) y al menos <b>2 de los otros 3</b> van al mismo lado.</li>
          <li><b>Objetivo:</b> el nivel más cercano en esa dirección a ≥ 8 pts (Magneto, imanes, techo/piso, barra más grande). <b>Stop:</b> detrás del nivel más cercano en contra + 2 pts (entre 5 y 15 pts). Solo si gana ≥ 1.2 veces lo que arriesga.</li>
          <li>Gana menos de la mitad de las veces, pero los objetivos son más largos que los stops. El resultado de cada día queda en el Excel del backtest (hoja “dinero”). Con pocos días es una lectura, no una garantía — siempre con stop.</li>
        </ul>
      </details>

      <FutureFirstNote />

      {p.night ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Solo en la sesión de día (SPX, NQ, TSLA).</div>
      ) : !reading ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          {replay ? "Empieza a leer a las 9:45 NY (necesita 15 min de flujo) — avanza la repetición." : !p.marketOpen ? "Mercado cerrado — se activa en la próxima sesión desde las 9:45 NY (o usa “Repetir sesión”)." : "Juntando 15 min de flujo para comparar… (empieza a las 9:45 NY)."}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: leanColor }}>
              {reading.lean === "alcista" ? "↑ El dinero apunta ARRIBA" : reading.lean === "bajista" ? "↓ El dinero apunta ABAJO" : "· Sin dirección clara"}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>votos {reading.score > 0 ? "+" : ""}{reading.score} de ±4{replay ? ` · ${hm(replay.tickMs)}` : ""}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 12 }}>
            {reading.votes.map((v) => (
              <span key={v.label} style={{ padding: "2px 8px", borderRadius: 999, border: `1px solid ${v.vote > 0 ? UP : v.vote < 0 ? DOWN : "var(--border)"}`, color: v.vote > 0 ? UP : v.vote < 0 ? DOWN : "var(--muted)" }}>
                {v.vote > 0 ? "↑" : v.vote < 0 ? "↓" : "·"} {v.label}: {v.detail}
              </span>
            ))}
          </div>
          {reading.msNewMoney && (() => {
            const ms = reading.msNewMoney;
            const ours = reading.votes[2]?.vote ?? 0;
            const agree = ms.vote === ours;
            return (
              <div style={{ fontSize: 12, color: "var(--muted)" }}
                title="Prima neta de calls y puts por minuto (MarketSnack). Se compara con el voto 'Dinero nuevo 15 min'; solo informa, no cuenta en la señal.">
                <span style={{ color: ms.vote > 0 ? UP : ms.vote < 0 ? DOWN : "var(--muted)", fontWeight: 600 }}>
                  {ms.vote > 0 ? "↑" : ms.vote < 0 ? "↓" : "·"} Dinero nuevo 15 min por minuto (MarketSnack):
                </span>{" "}
                {ms.detail} · {agree ? "✓ coincide con el voto 3" : <span style={{ color: "var(--amber-text)" }}>⚠ no coincide con el voto 3</span>}
              </div>
            );
          })()}

          {sig ? (
            <div style={{ border: `2px solid ${sig.side === "largo" ? UP : DOWN}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 6, background: "var(--panel-2)" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: sig.side === "largo" ? UP : DOWN }}>
                {sig.side === "largo" ? "🟢 LONG" : "🔴 SHORT"} {futOn ? ff.label : p.main}
                {open && (open.t.side === sig.side && Math.abs(open.t.entry - sig.entry) < 0.005
                  ? <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}> · ✅ tomada a las {hm(open.t.openedAt)}</span>
                  : <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}> · ya hay una operación abierta: esta señal no se toma</span>)}
              </div>
              <div style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px" }}>
                <span style={{ color: "var(--muted)" }}>Entrada</span><b>{px(sig.entry)}{eq(sig.entry)}</b>
                <span style={{ color: "var(--muted)" }}>🎯 Objetivo</span><b style={{ color: UP }}>{px(sig.target)} · {sig.targetLabel} · +{sig.rewardPts.toFixed(2)} pts{eq(sig.target)}</b>
                <span style={{ color: "var(--muted)" }}>🛑 Stop</span><b style={{ color: DOWN }}>{px(sig.stop)} · {sig.stopLabel} · −{sig.riskPts.toFixed(2)} pts{eq(sig.stop)}</b>
                <span style={{ color: "var(--muted)" }}>Gana / arriesga</span><b>{sig.rb.toFixed(2)} : 1 · {p.mult.bigLabel}: +${Math.round(sig.rewardPts * p.mult.big).toLocaleString("en-US")} / −${Math.round(sig.riskPts * p.mult.big).toLocaleString("en-US")}</b>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Cómo: {sig.side === "largo" ? p.instrumentos.largo : p.instrumentos.corto}. Es una lectura del flujo, no una recomendación.</div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>⛔ Sin señal ahora: {reading.blocked}</div>
          )}
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          Señales {replay ? "de la repetición" : "de hoy"}
          {trades.length > 0 && (
            <span style={{ fontWeight: 400, color: "var(--muted)" }}>
              {" "}· {trades.length} · {wins}G/{losses}P · <b style={{ color: total > 0 ? UP : total < 0 ? DOWN : "var(--muted)" }}>{pts(total)} pts</b> ({usd(total * p.mult.big)} {p.mult.bigLabel.replace("$ por ", "con ")})
            </span>
          )}
        </div>
        {trades.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Ninguna todavía{replay ? " (hasta este momento)" : ""}.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", width: "100%" }}>
              <thead><tr><th>Hora</th><th>Lado</th><th>Entrada</th><th>Objetivo</th><th>Stop</th><th>R:B</th><th>Estado</th><th>Puntos</th></tr></thead>
              <tbody>
                {trades.map(({ t, closed, value }) => (
                  <tr key={t.id}>
                    <td>{hm(t.openedAt)}</td>
                    <td style={{ color: t.side === "largo" ? UP : DOWN, fontWeight: 700 }}>{t.side === "largo" ? "LONG" : "SHORT"}</td>
                    <td>{px(t.entry, t.futBasis ?? null)}</td>
                    <td>{px(t.target, t.futBasis ?? null)} <span style={{ color: "var(--muted)" }}>{t.targetLabel}</span></td>
                    <td>{px(t.stop, t.futBasis ?? null)}</td>
                    <td>{t.rb.toFixed(2)}</td>
                    <td>{closed ? `${t.outcome === "objetivo" ? "🎯 objetivo" : t.outcome === "stop" ? "🛑 stop" : "⏹ cierre"} ${t.exitAt ? hm(t.exitAt) : ""}` : "abierta"}</td>
                    <td style={{ fontWeight: 700, color: value > 0 ? UP : value < 0 ? DOWN : "var(--muted)" }}>{pts(value)}{!closed && <span style={{ fontWeight: 400, color: "var(--muted)" }}> (va)</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
