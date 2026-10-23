"use client";

// Barra de modo de VisionFutura: "En vivo" o "Repetir sesión" (Carlos, oct
// 2026: "reconstruir todo el día... como si el mercado hubiese abierto hoy y
// poder ir viendo los cambios de imán, Magneto, todo eso"). En la repetición:
// control deslizante 9:30–16:00 (cada 5 min), ⏮ −5 min ▶/⏸ +5 min ⏭ y velocidad.

import type { ReplayPayload } from "@/lib/visionFuturaReplay";
import { useVisionLabels } from "./visionLabels";

export interface ReplayDay {
  date: string;
  backtest: { trades: number; wins: number; losses: number; points: number } | null;
}

interface Props {
  mode: "vivo" | "repeticion";
  onMode: (m: "vivo" | "repeticion") => void;
  replay: ReplayPayload | null;
  idx: number;
  onIdx: (i: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  speedMs: number;
  onSpeed: (ms: number) => void;
  speeds: { label: string; ms: number }[];
  loading: boolean;
  error: string | null;
  onRebuild: () => void;
  /** Días con repetición guardada (más reciente primero). */
  days: ReplayDay[];
  onPickDay: (date: string) => void;
}

const hmNy = (sec: number) =>
  new Date(sec * 1000).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

const btn: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)",
  color: "var(--text)", cursor: "pointer", fontSize: 13, fontVariantNumeric: "tabular-nums",
};

export default function VisionFuturaReplayBar(p: Props) {
  const lb = useVisionLabels();
  const ticks = p.replay?.ticks ?? [];
  const last = Math.max(0, ticks.length - 1);
  const tick = ticks[Math.min(p.idx, last)];
  const first = ticks[0];
  const move = tick && first ? tick.spot.spx - first.spot.spx : 0;
  const go = (i: number) => { p.onPlaying(false); p.onIdx(Math.max(0, Math.min(last, i))); };

  return (
    <div className="card" style={{ gap: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div className="view-toggle">
          <button className={p.mode === "vivo" ? "active" : ""} onClick={() => p.onMode("vivo")}>🟢 En vivo</button>
          <button className={p.mode === "repeticion" ? "active" : ""} onClick={() => p.onMode("repeticion")}>⏪ Repetir sesión</button>
        </div>
        {p.mode === "repeticion" && p.replay && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
            <label htmlFor="vf-replay-day">Día:</label>
            <select
              id="vf-replay-day"
              value={p.replay.date}
              onChange={(e) => p.onPickDay(e.target.value)}
              style={{ background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px" }}
            >
              {(p.days.some((d) => d.date === p.replay!.date) ? p.days : [{ date: p.replay.date, backtest: null }, ...p.days]).map((d) => (
                <option key={d.date} value={d.date}>{d.date}</option>
              ))}
            </select>
            <span>{p.replay.partial ? "en curso, hasta ahora · " : ""}{ticks.length} momentos de 5 min</span>
            <a
              href="/api/vision-futura/backtest/excel"
              download
              style={{ ...btn, textDecoration: "none", fontSize: 12, padding: "4px 10px" }}
            >
              ⬇ Excel del backtest
            </a>
          </div>
        )}
      </div>

      {p.mode === "repeticion" && p.loading && (
        <div className="wheel-empty" style={{ fontSize: 13 }}>Reconstruyendo el día con los datos de MarketSnack… (la primera vez puede tardar unos segundos)</div>
      )}
      {p.mode === "repeticion" && p.error && !p.loading && (
        <div style={{ fontSize: 13, color: "var(--red-soft)" }}>
          {p.error} <button style={{ ...btn, marginLeft: 8 }} onClick={p.onRebuild}>Reintentar</button>
        </div>
      )}

      {p.mode === "repeticion" && p.replay && tick && !p.loading && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{hmNy(tick.time)} <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>NY</span></span>
            <span style={{ fontSize: 15, fontVariantNumeric: "tabular-nums" }}>
              {lb.main} <b>{tick.spot.spx.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>{" "}
              <span style={{ color: move >= 0 ? "var(--green)" : "var(--red-soft)" }}>{move >= 0 ? "+" : ""}{move.toFixed(2)} desde la apertura</span>
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>momento {Math.min(p.idx, last) + 1} de {ticks.length}</span>
          </div>

          <input
            type="range" min={0} max={last} step={1} value={Math.min(p.idx, last)}
            onChange={(e) => go(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--accent)" }}
            aria-label="Hora de la repetición"
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--faint)", marginTop: -6 }}>
            <span>{first ? hmNy(first.time) : ""}</span>
            <span>{ticks[last] ? hmNy(ticks[last].time) : ""}</span>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button style={btn} onClick={() => go(0)} title="Ir a la apertura">⏮</button>
            <button style={btn} onClick={() => go(p.idx - 1)}>−5 min</button>
            <button
              style={{ ...btn, background: "var(--accent)", borderColor: "var(--accent)", minWidth: 92, fontWeight: 600 }}
              onClick={() => { if (p.idx >= last) p.onIdx(0); p.onPlaying(!p.playing); }}
            >
              {p.playing ? "⏸ Pausa" : "▶ Reproducir"}
            </button>
            <button style={btn} onClick={() => go(p.idx + 1)}>+5 min</button>
            <button style={btn} onClick={() => go(last)} title="Ir al cierre">⏭</button>
            <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>Velocidad:</span>
            {p.speeds.map((s) => (
              <button
                key={s.ms}
                style={{ ...btn, padding: "4px 10px", borderColor: p.speedMs === s.ms ? "var(--accent)" : "var(--border)", color: p.speedMs === s.ms ? "var(--text)" : "var(--muted)" }}
                onClick={() => p.onSpeed(s.ms)}
              >
                {s.label}
              </button>
            ))}
            <button style={{ ...btn, marginLeft: "auto", fontSize: 12, color: "var(--muted)" }} onClick={p.onRebuild}>Reconstruir de nuevo</button>
          </div>

          {(() => {
            const bt = p.days.find((d) => d.date === p.replay!.date)?.backtest;
            if (p.replay.partial) return <div style={{ fontSize: 12, color: "var(--muted)" }}>El backtest de este día se guarda cuando cierre el mercado.</div>;
            if (!bt) return null;
            return (
              <div style={{ fontSize: 13 }}>
                Backtest de este día: <b>{bt.trades}</b> entradas · <b style={{ color: "var(--green)" }}>{bt.wins} ganadas</b> ·{" "}
                <b style={{ color: "var(--red-soft)" }}>{bt.losses} perdidas</b> ·{" "}
                <b style={{ color: bt.points >= 0 ? "var(--green)" : "var(--red-soft)" }}>{bt.points >= 0 ? "+" : ""}{bt.points.toFixed(2)} {lb.main === "TSLA" ? "$ por acción" : `pts ${lb.main}`}</b>
                <span style={{ color: "var(--faint)" }}> (guardado en el Excel)</span>
              </div>
            );
          })()}

          <details style={{ fontSize: 12, color: "var(--faint)" }}>
            <summary style={{ cursor: "pointer" }}>De dónde salen los datos de la repetición</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {p.replay.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
