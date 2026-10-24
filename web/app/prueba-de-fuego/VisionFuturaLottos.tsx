"use client";

// Sección "Lottos al cierre" de VisionFutura (Carlos, 23-oct-2026): opciones 0DTE baratas en la
// última hora apuntando a un nivel (Magneto, imanes, paredes). Regla en lib/visionFuturaLottos.ts.
// En vivo: candidatos desde las 15:00 y los lottos "comprados" en cada lectura. En la repetición:
// los candidatos de ese momento y los lottos del día con su resultado.

import type { LottoIdea, LottoTrade } from "@/lib/visionFuturaLottos";
import type { LottoLive } from "@/lib/visionFuturaAlertStore";

const UP = "var(--green)";
const DOWN = "var(--red-soft)";
const LOTTO = "#facc15";
const usd = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const k = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const hm = (ms: number) => new Date(ms).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

interface ReplayProps {
  ideas: LottoIdea[] | undefined;
  trades: LottoTrade[];
  tickMs: number;
  spot: number;
  isLastTick: boolean;
  partial: boolean;
}

interface Props {
  live: LottoLive | null;
  replay: ReplayProps | null;
  marketOpen: boolean;
}

function Idea({ i }: { i: LottoIdea }) {
  const call = i.side === "call";
  return (
    <div style={{ border: "1px solid var(--border)", borderLeft: `4px solid ${i.fires ? LOTTO : "var(--border)"}`, borderRadius: 10, padding: 10, background: "var(--panel-2)", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
        <b style={{ color: call ? UP : DOWN }}>{call ? "▲ Call" : "▼ Put"} hacia {i.target.label} {k(i.target.spx)}</b>
        <span style={{ color: i.fires ? LOTTO : "var(--muted)", fontWeight: 700 }}>{i.fires ? "🎟️ CUMPLE" : `⛔ ${i.blocked}`}</span>
      </div>
      {i.strike != null && i.price != null ? (
        <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
          <b style={{ color: "var(--accent)" }}>COMPRAR</b> {call ? "CALL" : "PUT"} <b>{k(i.strike)}</b>{" "}
          <span style={{ color: "var(--muted)" }}>@ ask ${i.price.toFixed(2)} (${Math.round(i.price * 100)} por contrato)</span>
          {i.payoff != null && <> · si llega a {k(i.target.spx)} vale ~<b>{i.payoff}×</b> la prima</>}
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, fontSize: 12 }}>
        {i.conditions.map((c) => (
          <span key={c.label} title={c.detail} style={{ padding: "1px 7px", borderRadius: 999, border: `1px solid ${c.ok ? UP : "var(--border)"}`, color: c.ok ? UP : "var(--muted)" }}>
            {c.ok ? "✓" : "✗"} {c.label}: {c.detail}
          </span>
        ))}
      </div>
    </div>
  );
}

function TradeRow({ t, valueNow, final, bestExit }: { t: LottoTrade; valueNow: number | null; final: boolean; bestExit: boolean }) {
  const pnl = valueNow != null ? Math.round((valueNow - t.price) * 100) : null;
  return (
    <tr>
      <td>{t.lectura}</td>
      <td style={{ color: t.side === "call" ? UP : DOWN, fontWeight: 700 }}>{t.side === "call" ? "CALL" : "PUT"} {k(t.strike)}</td>
      <td>${t.price.toFixed(2)}{t.priceReal ? "" : " (est.)"}</td>
      <td>{t.target.label} {k(t.target.spx)}</td>
      <td>{k(t.spotAtOpen)}</td>
      {bestExit && <td>{t.bestExit ? `$${t.bestExit.price.toFixed(2)} · ${hm(t.bestExit.at)}` : "—"}</td>}
      <td>{valueNow != null ? `$${valueNow.toFixed(2)}` : "—"}</td>
      <td style={{ fontWeight: 700, color: pnl == null ? "var(--muted)" : pnl > 0 ? UP : DOWN }}>
        {pnl == null ? "—" : usd(pnl)}{pnl != null && <span style={{ fontWeight: 400, color: "var(--muted)" }}> {final ? (pnl > 0 ? "GANADA" : "PERDIDA") : pnl > 0 ? "va ganando" : "va perdiendo"}</span>}
      </td>
    </tr>
  );
}

const intrinsic = (t: LottoTrade, s: number) => (t.side === "call" ? Math.max(0, s - t.strike) : Math.max(0, t.strike - s));

export default function VisionFuturaLottos({ live, replay, marketOpen }: Props) {
  const ideas = replay ? replay.ideas ?? [] : live?.ideas ?? [];
  const trades: { t: LottoTrade; value: number | null; final: boolean }[] = replay
    ? replay.trades.filter((t) => t.openedAt <= replay.tickMs).map((t) => {
        const final = replay.isLastTick && !replay.partial && t.settle != null;
        return { t, value: final ? intrinsic(t, t.settle!) : intrinsic(t, replay.spot), final };
      })
    : (live?.trades ?? []).map((t) => ({ t, value: t.settle != null ? intrinsic(t, t.settle) : t.markNow, final: t.settle != null }));
  const total = trades.reduce((a, x) => a + (x.value != null ? Math.round((x.value - x.t.price) * 100) : 0), 0);
  const invested = trades.reduce((a, x) => a + Math.round(x.t.price * 100), 0);
  const replayNoIdeas = replay && (replay.ideas == null);

  return (
    <div className="card" style={{ gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
        <h4 style={{ margin: 0 }}>🎟️ Lottos al cierre</h4>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>0DTE baratas ($0.05–$1.00) hacia un nivel · lecturas 15:00 · 15:15 · 15:30 · 15:45 NY · 1 contrato, al vencimiento</span>
      </div>

      <details style={{ fontSize: 12, color: "var(--muted)" }}>
        <summary style={{ cursor: "pointer" }}>Las reglas</summary>
        <ul style={{ margin: "6px 0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <li>Objetivo: Magneto, imán +/−, max pain o pared de calls/puts, a 5 pts o más del precio.</li>
          <li><b>Obligatorio — al alcance:</b> a ≤ 1.5σ del movimiento que queda. σ sale del straddle ATM real (call + put en el dinero ≈ 0.8σ), no del VIX: en la última hora el VIX exagera mucho.</li>
          <li><b>2 de 3 confirmaciones:</b> GEX neto negativo (los dealers aceleran) · momentum de 15 min hacia el objetivo (≥ 3 pts) · flujo de 15 min hacia el objetivo (calls − puts ≥ $250K).</li>
          <li>Contrato: call si el objetivo está arriba, put si está abajo; fuera del dinero y ANTES del objetivo; prima $0.05–$1.00; el que más paga si llega (mínimo 3× la prima).</li>
          <li>En cada lectura se compra el mejor que cumpla (máx. 1). Se sostiene hasta el vencimiento: casi siempre se pierde la prima; cuando pega, paga varias veces.</li>
        </ul>
      </details>

      {!replay && live && !live.zeroDte && marketOpen && (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Los lottos solo aplican al vencimiento de hoy (0DTE). Elige “Hoy” en los vencimientos.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{replay ? `Candidatos a las ${hm(replay.tickMs)}` : "Candidatos ahora"}</div>
        {ideas.length > 0 ? ideas.map((i) => <Idea key={`${i.side}-${i.target.spx}`} i={i} />) : (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {replayNoIdeas ? (hm(replay!.tickMs) >= "16:00" ? "Sesión cerrada: ya no hay candidatos (abajo, el resultado de los comprados)." : "Se activa a las 3:00 pm NY — avanza la repetición a la última hora.")
              : !replay && !marketOpen ? "Mercado cerrado — se activa en la próxima sesión a las 3:00 pm NY. Para ver cómo funciona, usa “Repetir sesión” y avanza a la última hora."
              : "Se activa a las 3:00 pm NY (o no hay niveles al alcance)."}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          Comprados {replay ? "en la repetición" : "hoy"}
          {trades.length > 0 && <span style={{ fontWeight: 400, color: "var(--muted)" }}> · {trades.length} · invertido ${invested.toLocaleString("en-US")} · resultado <b style={{ color: total > 0 ? UP : total < 0 ? DOWN : "var(--muted)" }}>{usd(total)}</b></span>}
        </div>
        {trades.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Ninguno todavía{replay ? " (hasta este momento)" : ""}.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", width: "100%" }}>
              <thead>
                <tr>
                  <th>Lectura</th><th>Contrato</th><th>Prima</th><th>Objetivo</th><th>Spot</th>
                  {replay && <th>Mejor venta</th>}
                  <th>{trades.some((x) => x.final) ? "Valor al cierre" : "Valor ahora"}</th><th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((x) => <TradeRow key={x.t.id} t={x.t} valueNow={x.value} final={x.final} bestExit={!!replay} />)}
              </tbody>
            </table>
          </div>
        )}
        {replay && <div style={{ fontSize: 12, color: "var(--muted)" }}>“Mejor venta” = el promedio real de llenado al bid más alto después de la compra (si se hubiera vendido en ese momento en lugar de esperar al cierre).</div>}
      </div>
    </div>
  );
}
