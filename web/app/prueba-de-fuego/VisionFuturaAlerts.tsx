"use client";

// Área de "Alertas y órdenes" al final de VisionFutura (Carlos, oct 2026:
// "dámelo en la pantalla, pon un área debajo al final y dame las órdenes").
// Muestra las alertas de confluencia que se dispararon hoy (con su orden
// sugerida sobre el subyacente) y los setups que se están vigilando. El
// cálculo vive en lib/visionFuturaAlerts.ts; acá solo se pinta.

import type { AlertView } from "@/lib/visionFuturaAlertStore";
import type { AlertOrder, VisionAlert } from "@/lib/visionFuturaAlerts";
import type { ConvertedLevel } from "@/lib/visionFutura";
import { toFuture, useFutureFirst, useVisionLabels } from "./visionLabels";
import StopPts from "./StopPts";
import { orderSummary, type OrderResult } from "@/lib/visionFuturaAlertOutcome";

const fmt = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const hmNy = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

const UP = "var(--green)";
const DOWN = "var(--red-soft)";

function Levels({ l }: { l: ConvertedLevel | null }) {
  const lb = useVisionLabels();
  const ff = useFutureFirst();
  if (!l) return <span style={{ color: "var(--faint)" }}>sin objetivo claro</span>;
  // El /NQ guardado cuando salió la alerta; si no hay, con la base de ahora.
  const fut = ff.on ? (l.es ?? toFuture(ff, l.spx)) : null;
  if (fut != null) {
    // NQ: el futuro va primero (es lo que se opera); el índice y el ETF de referencia.
    return (
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        <b>{ff.label} {fmt(fut)}</b>
        <span style={{ color: "var(--muted)" }}> · {lb.main} {fmt(l.spx)}</span>
        {lb.etf && <span style={{ color: "var(--muted)" }}> · {lb.etf} {fmt(l.spy)}</span>}
      </span>
    );
  }
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      <b>{fmt(l.spx)}</b>
      {lb.etf && <span style={{ color: "var(--muted)" }}> · {lb.etf} {fmt(l.spy)}</span>}
      {lb.future && <span style={{ color: "var(--muted)" }}> · {lb.future} {fmt(l.es)}</span>}
    </span>
  );
}

function OrderBox({ o, color }: { o: AlertOrder; color: string }) {
  const row = (label: string, l: ConvertedLevel | null, c?: string) => (
    <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 8, fontSize: 13 }}>
      <span style={{ color: c ?? "var(--muted)", fontWeight: 600 }}>{label}</span>
      <Levels l={l} />
    </div>
  );
  return (
    <div style={{ border: `1px solid ${color}`, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, background: "var(--panel-2)" }}>
      <div style={{ fontWeight: 700, color, fontSize: 14 }}>
        Orden: {o.side === "largo" ? "LARGO ▲" : "CORTO ▼"} <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>· {o.instrumento}</span>
      </div>
      <StopPts pts={o.riskPts} />
      {row("Entrada", o.entry)}
      {row("Stop", o.stop, DOWN)}
      {row("Objetivo", o.target, UP)}
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Riesgo {fmt(o.riskPts, 1)} pts · Recompensa {o.rewardPts != null ? `${fmt(o.rewardPts, 1)} pts` : "—"} · R:B{" "}
        <b style={{ color: o.rb != null && o.rb >= 1.5 ? UP : o.rb != null && o.rb < 1 ? DOWN : "var(--text)" }}>{o.rb != null ? `${o.rb.toFixed(2)}x` : "—"}</b>
        {o.rb != null && o.rb < 1 && " (el objetivo está más cerca que el stop)"}
      </div>
    </div>
  );
}

function Conditions({ a, compact }: { a: VisionAlert; compact?: boolean }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
      {a.conditions.map((c) => (
        <li key={c.key} style={{ fontSize: compact ? 12 : 13, display: "flex", gap: 6 }}>
          <span style={{ color: c.ok ? UP : "var(--faint)", fontWeight: 700, width: 14 }}>{c.ok ? "✓" : "✗"}</span>
          <span style={{ color: c.ok ? "var(--text)" : "var(--muted)" }}>
            {c.label}
            {!compact && <span style={{ color: "var(--faint)" }}> — {c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TrapBanner({ text }: { text: string }) {
  return (
    <div style={{ border: "1px solid var(--amber-border)", background: "var(--amber-bg)", color: "var(--amber-text)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }}>
      ⚠ <b>{text.split(":")[0]}</b>:{text.slice(text.indexOf(":") + 1)}
    </div>
  );
}

/** GANADA / PERDIDA / ABIERTA de la orden, con sus puntos y por qué se cerró. */
function ResultBadge({ r, basis }: { r: OrderResult | undefined; basis: number | null }) {
  const lb = useVisionLabels();
  const ff = useFutureFirst();
  if (!r) return null;
  const exitFut = r.exit != null ? toFuture(ff, r.exit, basis ?? ff.basis) : null;
  const unit = ff.on && ff.basis != null ? ff.label : lb.main;
  const p = r.points;
  const ptsTxt = p == null ? "" : ` ${p > 0 ? "+" : ""}${fmt(p, 2)} pts ${unit}`;
  if (r.status === "abierta") {
    return (
      <span style={{ padding: "2px 10px", borderRadius: 999, background: "var(--amber-bg)", border: "1px solid var(--amber-border)", color: "var(--amber-text)", fontWeight: 700, fontSize: 12 }}>
        ABIERTA{p != null ? ` · va ${p > 0 ? "+" : ""}${fmt(p, 2)}` : ""}
      </span>
    );
  }
  const win = r.status === "ganada";
  const color = win ? UP : r.status === "perdida" ? DOWN : "var(--muted)";
  const why = r.reason === "objetivo" ? "tocó el objetivo" : r.reason === "stop" ? "tocó el stop" : r.reason === "nueva alerta" ? "cerrada por la nueva alerta" : "al cierre";
  return (
    <span style={{ padding: "2px 10px", borderRadius: 999, border: `1px solid ${color}`, color, fontWeight: 700, fontSize: 12 }}>
      {win ? "GANADA" : r.status === "perdida" ? "PERDIDA" : "EMPATE"}{ptsTxt}
      <span style={{ fontWeight: 400, color: "var(--muted)" }}> · {why}{r.exitAt ? ` ${hmNy(r.exitAt)}` : ""}{r.exit != null ? ` a ${exitFut != null ? `${ff.label} ${fmt(exitFut)}` : fmt(r.exit)}` : ""}</span>
    </span>
  );
}

function AlertCard({ a }: { a: AlertView }) {
  const color = a.direction === "alcista" ? UP : DOWN;
  return (
    <div style={{ border: "1px solid var(--border)", borderLeft: `4px solid ${color}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10, opacity: a.result ? (a.result.status === "abierta" ? 1 : 0.75) : a.activa ? 1 : 0.7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
        <div style={{ fontWeight: 700, fontSize: 15, color }}>{a.direction === "alcista" ? "🟢" : "🔴"} {a.title}</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {hmNy(a.firedAt)} NY ·{" "}
          {a.activa
            ? <b style={{ color }}>ACTIVA</b>
            : <span>ya no se cumple (último {hmNy(a.lastSeenAt)})</span>}
        </div>
      </div>
      <div><ResultBadge r={a.result} basis={a.order.entry.es != null ? a.order.entry.es - a.order.entry.spx : null} /></div>
      {a.trap && <TrapBanner text={a.trap} />}
      <div style={{ fontSize: 13, color: "var(--muted)" }}>
        Nivel: <Levels l={a.level} /> <span style={{ color: "var(--faint)" }}>({a.levelSources.join(", ")})</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Conditions a={a} />
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Cumple <b>{a.score}/5</b>{a.regimeNote ? ` · ${a.regimeNote}` : ""}
            {a.target && <> · objetivo: {a.target.label}</>}
          </div>
          {a.singleLeg && (
            <div style={{ fontSize: 12, color: a.singleLeg.share != null && a.singleLeg.share >= 0.5 ? "var(--text)" : "var(--amber-text)" }}
              title="Prima del día en este strike: operaciones de una pata (apuestas de dirección) vs spreads (varias patas). Dato de MarketSnack; solo informa, no cambia si la alerta dispara.">
              {a.singleLeg.share != null && a.singleLeg.share >= 0.5 ? "◆" : "⚠"} Una pata: {a.singleLeg.text}
            </div>
          )}
        </div>
        <OrderBox o={a.order} color={color} />
      </div>
    </div>
  );
}

/** Aviso con NQ: en vivo, los precios van en el futuro; en la repetición no hay base histórica. */
export function FutureFirstNote() {
  const ff = useFutureFirst();
  const lb = useVisionLabels();
  if (!ff.on) return null;
  return ff.basis != null
    ? <div style={{ fontSize: 12, color: "var(--muted)" }}>Precios en <b>{ff.label}</b> (base {ff.basis > 0 ? "+" : ""}{fmt(ff.basis)} pts sobre {lb.main}); stop y objetivo a la misma distancia en puntos.</div>
    : <div style={{ fontSize: 12, color: "var(--amber-text)" }}>En la repetición no hay {ff.label ?? "futuro"} histórico: los precios se muestran en {lb.main}.</div>;
}

export default function VisionFuturaAlerts({ alerts, watch, marketOpen }: { alerts: AlertView[]; watch: VisionAlert[]; marketOpen: boolean }) {
  return (
    <div className="card" style={{ gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
        <h4 style={{ margin: 0 }}>Alertas y órdenes</h4>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Mínimo 4 de 5 (llegar al nivel + reaccionar a ≤8 pts, obligatorias; y 2 de: nivel firme, agresor, VIX) · scalp: objetivo 3 pts, stop 3 pts · sin nivel en el camino · una alerta por lado
        </span>
      </div>

      <FutureFirstNote />

      {!marketOpen && (
        <div className="wheel-empty" style={{ fontSize: 13 }}>
          Mercado cerrado: las alertas se evalúan con el mercado abierto y esta pestaña abierta (cada refresco de 30 s revisa las condiciones).
        </div>
      )}

      {alerts.some((a) => a.result) && (() => {
        const sm = orderSummary(alerts.filter((a) => a.result).map((a) => a.result!));
        return (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Hoy: <b style={{ color: "var(--text)" }}>{sm.n}</b> entradas · <b style={{ color: UP }}>{sm.wins} ganadas</b> · <b style={{ color: DOWN }}>{sm.losses} perdidas</b>
            {sm.open > 0 && <> · <b style={{ color: "var(--amber-text)" }}>{sm.open} abierta</b></>} · cerradas{" "}
            <b style={{ color: sm.points > 0 ? UP : sm.points < 0 ? DOWN : "var(--text)" }}>{sm.points > 0 ? "+" : ""}{fmt(sm.points, 2)} pts</b>
            <span style={{ color: "var(--faint)" }}> · cuando llega una nueva, la anterior se cierra a ese precio</span>
          </div>
        );
      })()}

      {alerts.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {alerts.map((a) => <AlertCard key={`${a.id}-${a.firedAt}`} a={a} />)}
        </div>
      ) : marketOpen ? (
        <div className="wheel-empty" style={{ fontSize: 13 }}>Todavía no hay alertas hoy. Abajo ves qué se está vigilando.</div>
      ) : null}

      {watch.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>Vigilando (más cerca de cumplirse)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 10 }}>
            {watch.map((w) => (
              <div key={w.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: w.direction === "alcista" ? UP : DOWN }}>{w.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{w.score}/5 condiciones</div>
                {w.trap && <div style={{ fontSize: 12, color: "var(--amber-text)", fontWeight: 600 }}>⚠ {w.trap.split(":")[0]}</div>}
                {w.blocked && (
                  <div style={{ fontSize: 12, color: "var(--amber-text)" }}>No se dispara: {w.blocked}</div>
                )}
                <Conditions a={w} compact />
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--faint)" }}>
        La orden es una referencia de scalp sobre el subyacente (largo = calls / comprar /ES; corto = puts / vender /ES): objetivo y stop fijos de 3 pts desde la entrada.
        Es una lectura del flujo, no una recomendación de compra o venta.
      </div>
    </div>
  );
}
