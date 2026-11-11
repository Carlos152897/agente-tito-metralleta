"use client";

// Barra de tiempo debajo de la escalera (Carlos, 10-nov: "en vivo puedo irme hacia atrás"):
// en vivo el cursor está pegado a "ahora"; se arrastra hacia atrás para ver cómo estaba todo a esa
// hora de HOY (usa la repetición del día en curso) y "● En vivo" regresa.

const SESSION_MIN = 390; // 9:30 → 16:00
const LABELS = ["9:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30"];

/** Fecha de hoy en Nueva York (YYYY-MM-DD). */
export function todayNy(nowMs = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
}

/** 9:30 NY de una fecha, en segundos. */
export function sessionOpenSec(date: string): number {
  const off = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${date}T16:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-05:00";
  return Date.parse(`${date}T09:30:00${off}`) / 1000;
}

const hm = (sec: number) =>
  new Date(sec * 1000).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

interface Props {
  openSec: number;
  nowSec: number;
  /** Hora que se está viendo (null = en vivo). */
  cursorSec: number | null;
  loading: boolean;
  onPick: (sec: number) => void;
  onLive: () => void;
}

export default function VisionFuturaLiveTimeline({ openSec, nowSec, cursorSec, loading, onPick, onLive }: Props) {
  const nowMin = Math.max(0, Math.min(SESSION_MIN, Math.floor((nowSec - openSec) / 60)));
  const live = cursorSec == null;
  const curMin = live ? nowMin : Math.max(0, Math.min(nowMin, Math.round((cursorSec - openSec) / 60)));
  const pct = (m: number) => `${(m / SESSION_MIN) * 100}%`;
  const pick = (m: number) => {
    const v = Math.min(m, nowMin);
    if (v >= nowMin) onLive(); else onPick(openSec + v * 60);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {live
            ? "Arrastra hacia atrás para ver cómo estaba la escalera a esa hora de hoy."
            : <>Viendo <b style={{ color: "var(--text)" }}>{hm(openSec + curMin * 60)}</b> · ahora son {hm(nowSec)}{loading ? " · cargando el día…" : ""}</>}
        </span>
        <span style={{ display: "flex", gap: 6 }}>
          {!live && <button onClick={() => pick(curMin - 5)} style={btn}>−5 min</button>}
          {!live && <button onClick={() => pick(curMin + 5)} style={btn}>+5 min</button>}
          <button
            onClick={onLive}
            style={{ ...btn, fontWeight: 700, borderColor: live ? "#12b76a" : "var(--accent)", color: live ? "#12b76a" : "var(--text)", background: live ? "transparent" : "var(--accent)" }}
          >
            {live ? "● En vivo" : "Volver a en vivo"}
          </button>
        </span>
      </div>
      <div style={{ position: "relative", padding: "0 2px" }}>
        {/* Lo que todavía no pasa (después de "ahora") va tenue. */}
        <div style={{ position: "absolute", left: pct(nowMin), right: 0, top: 8, height: 6, borderRadius: 3, background: "repeating-linear-gradient(90deg, var(--border) 0 4px, transparent 4px 8px)", pointerEvents: "none" }} />
        <input
          type="range" min={0} max={SESSION_MIN} step={1} value={curMin}
          onChange={(e) => pick(Number(e.target.value))}
          aria-label="Hora del día para comparar con en vivo"
          style={{ width: "100%", accentColor: live ? "#12b76a" : "var(--accent)", cursor: "pointer" }}
        />
        <div style={{ position: "relative", height: 16, fontSize: 11, color: "var(--faint)" }}>
          {LABELS.map((l, i) => (
            <span key={l} style={{ position: "absolute", left: pct(i * 60), transform: "translateX(-50%)" }}>{l}</span>
          ))}
          <span style={{ position: "absolute", right: 0 }}>16:00</span>
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "4px 10px", fontSize: 12, borderRadius: 999, border: "1px solid var(--border)",
  background: "transparent", color: "var(--text)", cursor: "pointer",
};
