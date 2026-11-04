"use client";

// Sección "Alertas con retest · v3" (Carlos, 3-nov-2026: "dale los dos"). Dos motores de prueba sobre
// las MISMAS alertas (lib/visionFuturaRetest.ts): la alerta queda ARMADA hasta que el precio regresa a
// probar el nivel. En vivo los calcula el servidor; en la repetición se calculan aquí con las velas de 1 min.

import { RETEST_TUNING, retestSummary, type RetestTrade } from "@/lib/visionFuturaRetest";

const UP = "var(--green)";
const DOWN = "var(--red-soft)";
const n2 = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const hm = (ms: number) => new Date(ms).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

interface Props {
  day: { retest: RetestTrade[]; v3: RetestTrade[] } | null;
  /** De dónde salieron las velas de 1 min (tastytrade o yahoo). */
  source: string | null;
  main: string;
  night: boolean;
  replay: boolean;
}

function Result({ t }: { t: RetestTrade }) {
  if (t.status === "armada") return <span style={{ color: "var(--accent)", fontWeight: 700 }}>ARMADA · esperando retest</span>;
  if (t.status === "abierta")
    return <span style={{ color: "var(--amber-text)", fontWeight: 700 }}>ABIERTA{t.t1Hit ? " · obj. 1 tocado, stop en la entrada" : ""}</span>;
  if (t.status === "cancelada") return <span style={{ color: "var(--faint)" }}>cancelada · {t.reason}</span>;
  const p = t.points ?? 0;
  const label = t.outcome === "objetivo" ? "GANADA" : t.outcome === "stop" ? "PERDIDA" : t.outcome === "en cero" ? "EN CERO" : t.outcome === "otra entrada" ? "cerrada por otra entrada" : "cierre";
  return (
    <span style={{ color: p > 0 ? UP : p < 0 ? DOWN : "var(--muted)", fontWeight: 700 }}>
      {label} {`${p > 0 ? "+" : ""}${p.toFixed(2)} pts`}{t.r != null ? ` (${t.r > 0 ? "+" : ""}${t.r}R)` : ""}{t.exitAt ? ` · ${hm(t.exitAt)}` : ""}
    </span>
  );
}

function Row({ t, main }: { t: RetestTrade; main: string }) {
  const color = t.side === "largo" ? UP : DOWN;
  return (
    <div style={{ borderLeft: `4px solid ${color}`, borderRadius: 8, padding: "6px 9px", background: "var(--panel)", display: "flex", flexDirection: "column", gap: 3, opacity: t.status === "cancelada" ? 0.65 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
        <b style={{ color }}>{t.side === "largo" ? "▲ LARGO" : "▼ CORTO"} · {t.title}</b>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>alerta {hm(t.firedAt)}{t.entryAt ? ` · entrada ${hm(t.entryAt)}` : ""}</span>
      </div>
      {t.entry != null && (
        <div style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span>Entrada <b>{main} {n2(t.entry)}</b></span>
          <span style={{ color: DOWN }}>Stop <b>{n2(t.status === "abierta" ? t.stopNow : t.stop)}</b>{t.status === "abierta" && t.stopNow !== t.stop ? ` (era ${n2(t.stop)})` : ""}</span>
          {t.t1 != null && <span style={{ color: UP }}>Obj. 1 <b>{n2(t.t1)}</b></span>}
          <span style={{ color: UP }}>{t.t1 != null ? "Obj. 2" : "Objetivo"} <b>{n2(t.t2)}</b></span>
        </div>
      )}
      <div style={{ fontSize: 12 }}><Result t={t} /></div>
    </div>
  );
}

function Column({ title, sub, list, main }: { title: string; sub: string; list: RetestTrade[]; main: string }) {
  const s = retestSummary(list);
  const live = list.filter((t) => t.status === "armada" || t.status === "abierta").sort((a, b) => b.firedAt - a.firedAt);
  const done = list.filter((t) => t.status === "cerrada").sort((a, b) => (b.entryAt ?? 0) - (a.entryAt ?? 0)).slice(0, 4);
  const lastCanceled = list.filter((t) => t.status === "cancelada").sort((a, b) => b.firedAt - a.firedAt)[0];
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--panel-2)", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>{title}</b>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          hoy {s.entries} entradas · {s.wins}G/{s.losses}P{s.even ? `/${s.even} en cero` : ""} · {s.points > 0 ? "+" : ""}{s.points} pts · {s.r > 0 ? "+" : ""}{s.r}R
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--faint)" }}>{sub} · armadas {s.armed} · canceladas {s.canceled}</div>
      {live.length === 0 && done.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Sin entradas todavía.</div>}
      {live.map((t) => <Row key={t.id} t={t} main={main} />)}
      {done.length > 0 && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Últimas cerradas</div>}
      {done.map((t) => <Row key={t.id} t={t} main={main} />)}
      {lastCanceled && live.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--faint)" }}>Última cancelada ({hm(lastCanceled.firedAt)}): {lastCanceled.title} — {lastCanceled.reason}.</div>
      )}
    </div>
  );
}

export default function VisionFuturaRetest({ day, source, main, night, replay }: Props) {
  if (night) return null;
  const T = RETEST_TUNING;
  return (
    <div className="card" style={{ gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
        <h4 style={{ margin: 0 }}>🎯 Alertas con retest · v3 <span style={{ fontSize: 12, color: "var(--amber-text)", fontWeight: 600 }}>(prueba)</span></h4>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          las mismas alertas, entrando cuando el precio regresa a probar el nivel{source ? ` · velas 1 min ${source}` : ""}{replay ? " · repetición" : ""}
        </span>
      </div>
      {!day ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Sin alertas todavía (o sin velas de 1 min).</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 12 }}>
          <Column title="Retest" sub="stop y objetivo de la alerta (scalp)" list={day.retest} main={main} />
          <Column title="v3" sub={`stop ${T.stopAtr} ATR · obj. 1 +${T.t1R}R sube el stop a la entrada · una a la vez`} list={day.v3} main={main} />
        </div>
      )}
      <details style={{ fontSize: 12, color: "var(--muted)" }}>
        <summary style={{ cursor: "pointer" }}>Cómo funcionan</summary>
        <ul style={{ margin: "6px 0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <li><b>Entrada con retest (los dos):</b> la alerta queda ARMADA. Primero el precio se aleja del nivel ≥ {T.awayAtr} ATR, luego regresa a {T.zoneAtr} ATR del nivel o menos y una vela de 1 min cierra a favor y del lado bueno del nivel → entra al cierre de esa vela.</li>
          <li><b>Se cancela</b> si una vela cierra {T.failAtr} ATR del lado equivocado, si llega al siguiente nivel sin regresar, o a los {T.maxMinBreak} min (rupturas) / {T.maxMinReact} min (rechazos y defensas).</li>
          <li><b>Retest:</b> stop y objetivo iguales a la alerta normal, pero desde la entrada del retest.</li>
          <li><b>v3 (regla de la amiga):</b> stop {T.stopAtr} ATR detrás del nivel; al tocar el obj. 1 (+{T.t1R}R) el stop sube a la entrada (si regresa sale EN CERO); obj. 2 = siguiente nivel si está a ≥ {T.nextLevelMinR}R, si no {T.t2R}R. Una abierta a la vez: la entrada nueva cierra la anterior.</li>
          <li>ATR = {T.atrBars} velas de 5 min. Solo velas de 1 min terminadas; si en una vela caben stop y objetivo, cuenta el stop.</li>
          <li>Prueba con tus días (27-oct → 3-nov, vivo): normal −$3,648 · retest +$805 · v3 +$4,924. Pocos días: el Excel ("En vivo · resultado") los compara cada día.</li>
        </ul>
      </details>
    </div>
  );
}
