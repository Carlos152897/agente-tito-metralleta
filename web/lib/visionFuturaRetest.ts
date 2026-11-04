// Dos motores de prueba sobre las MISMAS alertas de VisionFutura (Carlos, 3-nov-2026: "dale los dos"),
// tomados de la v3 de la amiga y medidos antes con los días de Carlos (retest gana en vivo y en repetición):
//
//   - "Retest": la alerta no entra en el momento; queda ARMADA hasta que el precio se aleja del nivel,
//     regresa a probarlo y una vela de 1 min cierra a favor. Stop y objetivo = los de la alerta (scalp).
//   - "v3": el mismo retest + stop a 0.75 ATR detrás del nivel + dos objetivos (Obj. 1 a +0.75R sube el
//     stop a la entrada; Obj. 2 = siguiente nivel si está a ≥ 0.8R, si no 1.5R) + una abierta a la vez
//     (una entrada nueva cierra la anterior).
//
// PURO y sin estado: se recalcula entero en cada ciclo con las alertas del día y las velas de 1 min
// TERMINADAS. Así no se desincroniza si se reinicia la vigilancia, y sirve igual en vivo, en la
// repetición (navegador) y en el backtest del cierre. Si en una vela caben stop y objetivo, cuenta el stop.

export const RETEST_TUNING = {
  /** Primero se aleja del nivel al menos esto (× ATR). */
  awayAtr: 0.25,
  /** Zona del retest: regresa a esta distancia del nivel o menos (× ATR). */
  zoneAtr: 0.6,
  /** Se cancela si una vela cierra esto del lado equivocado del nivel (× ATR). */
  failAtr: 0.25,
  /** Tiempo máximo armada (min): rupturas / rechazos y defensas. */
  maxMinBreak: 10,
  maxMinReact: 20,
  /** v3: stop detrás del nivel (× ATR), objetivo 1 (× R), objetivo 2 mínimo al siguiente nivel (× R) o fijo (× R). */
  stopAtr: 0.75,
  t1R: 0.75,
  nextLevelMinR: 0.8,
  t2R: 1.5,
  /** ATR: velas de 5 min (armadas con las de 1 min). */
  atrBars: 12,
};

export type RetestVariant = "retest" | "v3";
export type RetestKind = "defensa_piso" | "rechazo_techo" | "ruptura_piso" | "ruptura_techo";

export interface RetestBar { time: number; open: number; high: number; low: number; close: number }

export interface RetestAlertIn {
  id: string;
  kind: RetestKind | string;
  title: string;
  side: "largo" | "corto";
  level: number;
  firedAt: number;
  /** Precio cuando salió la alerta. */
  price: number;
  /** Stop y objetivo de la alerta original (puntos; scalp). */
  riskPts: number;
  rewardPts: number;
  /** Niveles de la pantalla cuando salió (para "siguiente nivel"); vacío = sin dato. */
  levels?: number[];
}

export type RetestStatus = "armada" | "cancelada" | "abierta" | "cerrada";
export type RetestOutcome = "objetivo" | "stop" | "en cero" | "otra entrada" | "cierre";

export interface RetestTrade {
  id: string;
  variant: RetestVariant;
  alertId: string;
  title: string;
  side: "largo" | "corto";
  level: number;
  firedAt: number;
  status: RetestStatus;
  /** Por qué se canceló (si status = cancelada). */
  reason: string | null;
  atr: number | null;
  entryAt: number | null;
  entry: number | null;
  stop: number | null;
  /** Stop vigente (v3: sube a la entrada después del objetivo 1). */
  stopNow: number | null;
  t1: number | null;
  t2: number | null;
  t1Hit: boolean;
  exit: number | null;
  exitAt: number | null;
  outcome: RetestOutcome | null;
  points: number | null;
  /** Puntos ÷ riesgo. */
  r: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** ATR de las últimas 12 velas de 5 min terminadas antes de `ms` (armadas con velas de 1 min). */
export function atrAt(bars: RetestBar[], ms: number, n = RETEST_TUNING.atrBars): number | null {
  const fives: RetestBar[] = [];
  for (const b of bars) {
    if (b.time * 1000 + 60_000 > ms) break;
    const k = Math.floor(b.time / 300);
    const last = fives.at(-1);
    if (last && Math.floor(last.time / 300) === k) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
    } else fives.push({ ...b });
  }
  const w = fives.slice(-(n + 1));
  if (w.length < 4) return null;
  const tr = w.slice(1).map((b, i) => Math.max(b.high - b.low, Math.abs(b.high - w[i].close), Math.abs(b.low - w[i].close)));
  return tr.reduce((a, b) => a + b, 0) / tr.length;
}

type Armed =
  | { kind: "entrada"; sec: number; entry: number }
  | { kind: "cancelada"; reason: string }
  | { kind: "armada" };

/** Busca la entrada con retest en las velas terminadas (`bars`). */
function findRetest(bars: RetestBar[], a: RetestAlertIn, atr: number, final: boolean): Armed {
  const T = RETEST_TUNING;
  const up = a.side === "largo";
  const sgn = up ? 1 : -1;
  const dist = (p: number) => sgn * (p - a.level); // + = lado bueno del nivel
  const isBreak = String(a.kind).startsWith("ruptura");
  const maxSec = Math.floor(a.firedAt / 1000) + (isBreak ? T.maxMinBreak : T.maxMinReact) * 60;
  const next = (a.levels ?? []).filter((l) => sgn * (l - a.level) > 0.5 && sgn * (l - a.price) > 0.5).sort((x, y) => sgn * (x - y))[0] ?? null;
  let away = dist(a.price) >= T.awayAtr * atr;
  const startSec = Math.floor(a.firedAt / 60_000) * 60 + 60; // la vela siguiente a la del disparo
  for (const b of bars) {
    if (b.time < startSec) continue;
    if (b.time > maxSec) return { kind: "cancelada", reason: "pasó el tiempo sin retest" };
    if (-dist(b.close) >= T.failAtr * atr) return { kind: "cancelada", reason: "el nivel falló" };
    const best = up ? b.high : b.low;
    const worst = up ? b.low : b.high;
    if (!away) {
      if (dist(best) >= T.awayAtr * atr) away = true;
      continue;
    }
    if (next != null && sgn * (best - next) >= 0) return { kind: "cancelada", reason: "se fue al siguiente nivel sin retest" };
    const inZone = dist(worst) <= T.zoneAtr * atr;
    const favor = up ? b.close > b.open : b.close < b.open;
    if (inZone && favor && dist(b.close) > 0) return { kind: "entrada", sec: b.time, entry: b.close };
  }
  const last = bars.at(-1);
  if (final || (last && last.time >= maxSec)) return { kind: "cancelada", reason: "pasó el tiempo sin retest" };
  return { kind: "armada" };
}

/** Avanza una operación abierta con las velas posteriores a su entrada. */
function manage(bars: RetestBar[], tr: RetestTrade, untilSec: number | null, untilPrice: number | null, final: boolean): RetestTrade {
  const up = tr.side === "largo";
  const entry = tr.entry!, t2 = tr.t2!;
  let st = tr.stop!;
  let t1Hit = false;
  const fromSec = Math.floor(tr.entryAt! / 1000);
  const done = (exit: number, exitSec: number, outcome: RetestOutcome): RetestTrade => {
    const points = r2(up ? exit - entry : entry - exit);
    const risk = Math.abs(entry - tr.stop!);
    return { ...tr, status: "cerrada", stopNow: st, t1Hit, exit: r2(exit), exitAt: exitSec * 1000, outcome, points, r: risk > 0 ? r2(points / risk) : null };
  };
  for (const b of bars) {
    if (b.time <= fromSec) continue;
    if (untilSec != null && b.time >= untilSec) return done(untilPrice!, untilSec, "otra entrada");
    const hitStop = up ? b.low <= st : b.high >= st;
    const hitT2 = up ? b.high >= t2 : b.low <= t2;
    if (hitStop) return done(st, b.time, t1Hit && st === entry ? "en cero" : "stop");
    if (hitT2) return done(t2, b.time, "objetivo");
    if (tr.t1 != null && !t1Hit && (up ? b.high >= tr.t1 : b.low <= tr.t1)) {
      t1Hit = true; // el stop sube desde la vela siguiente
      st = entry;
    }
  }
  if (untilSec != null) return done(untilPrice!, untilSec, "otra entrada");
  const last = bars.at(-1);
  if (final && last) return done(last.close, last.time, "cierre");
  return { ...tr, status: "abierta", stopNow: st, t1Hit };
}

/**
 * Los dos motores del día. `bars` = velas de 1 min de la sesión (se usan solo las terminadas antes de
 * `nowMs`); `final` = la sesión ya cerró (lo armado se cancela y lo abierto sale al último precio).
 */
export function runRetestDay(input: { alerts: RetestAlertIn[]; bars: RetestBar[]; nowMs: number; final: boolean }): { retest: RetestTrade[]; v3: RetestTrade[] } {
  const T = RETEST_TUNING;
  const bars = [...input.bars].filter((b) => b.time * 1000 + 60_000 <= input.nowMs).sort((a, b) => a.time - b.time);
  const alerts = [...input.alerts].filter((a) => a.firedAt <= input.nowMs).sort((a, b) => a.firedAt - b.firedAt);
  const out: Record<RetestVariant, RetestTrade[]> = { retest: [], v3: [] };
  for (const variant of ["retest", "v3"] as RetestVariant[]) {
    const list: RetestTrade[] = [];
    for (const a of alerts) {
      const base: RetestTrade = {
        id: `${variant}:${a.id}:${a.firedAt}`, variant, alertId: a.id, title: a.title, side: a.side, level: a.level, firedAt: a.firedAt,
        status: "armada", reason: null, atr: null, entryAt: null, entry: null, stop: null, stopNow: null, t1: null, t2: null, t1Hit: false,
        exit: null, exitAt: null, outcome: null, points: null, r: null,
      };
      const atr = atrAt(bars, a.firedAt);
      if (atr == null || atr <= 0) { list.push({ ...base, status: "cancelada", reason: "sin ATR todavía (primeros 20 min)" }); continue; }
      base.atr = r2(atr);
      const f = findRetest(bars, a, atr, input.final);
      if (f.kind === "cancelada") { list.push({ ...base, status: "cancelada", reason: f.reason }); continue; }
      if (f.kind === "armada") { list.push(base); continue; }
      const sgn = a.side === "largo" ? 1 : -1;
      let stop: number, t1: number | null, t2: number;
      if (variant === "retest") {
        stop = f.entry - sgn * a.riskPts;
        t2 = f.entry + sgn * a.rewardPts;
        t1 = null;
      } else {
        stop = a.level - sgn * T.stopAtr * atr;
        const R = Math.abs(f.entry - stop);
        const next = (a.levels ?? []).filter((l) => sgn * (l - f.entry) > 0).sort((x, y) => sgn * (x - y))[0];
        t2 = next != null && Math.abs(next - f.entry) >= T.nextLevelMinR * R ? next : f.entry + sgn * T.t2R * R;
        t1 = f.entry + sgn * T.t1R * R;
      }
      // La misma vela de entrada y el mismo lado ya tomados por otra alerta: no se duplica.
      if (list.some((x) => x.entryAt === f.sec * 1000 && x.side === a.side)) { list.push({ ...base, status: "cancelada", reason: "misma entrada que otra alerta" }); continue; }
      list.push({ ...base, status: "abierta", entryAt: f.sec * 1000, entry: r2(f.entry), stop: r2(stop), stopNow: r2(stop), t1: t1 == null ? null : r2(t1), t2: r2(t2) });
    }
    // Resultado de cada entrada; en v3, la entrada siguiente cierra la anterior (una a la vez).
    const entered = list.filter((x) => x.entryAt != null).sort((a, b) => a.entryAt! - b.entryAt!);
    for (let i = 0; i < entered.length; i++) {
      const nx = variant === "v3" ? entered[i + 1] ?? null : null;
      const res = manage(bars, entered[i], nx ? nx.entryAt! / 1000 : null, nx ? nx.entry : null, input.final);
      // Si la anterior ya había salido antes de la siguiente, `manage` la cierra por su cuenta.
      list[list.indexOf(entered[i])] = res;
    }
    out[variant] = list;
  }
  return out;
}

export interface RetestSummary { entries: number; wins: number; losses: number; even: number; open: number; armed: number; canceled: number; points: number; r: number }

export function retestSummary(list: RetestTrade[]): RetestSummary {
  const closed = list.filter((t) => t.status === "cerrada");
  return {
    entries: list.filter((t) => t.entryAt != null).length,
    wins: closed.filter((t) => (t.points ?? 0) > 0).length,
    losses: closed.filter((t) => (t.points ?? 0) < 0).length,
    even: closed.filter((t) => (t.points ?? 0) === 0).length,
    open: list.filter((t) => t.status === "abierta").length,
    armed: list.filter((t) => t.status === "armada").length,
    canceled: list.filter((t) => t.status === "cancelada").length,
    points: r2(closed.reduce((a, t) => a + (t.points ?? 0), 0)),
    r: r2(closed.reduce((a, t) => a + (t.r ?? 0), 0)),
  };
}

/** Convierte una alerta disparada (en vivo o de la repetición) a la entrada del motor. */
export function retestAlertFrom(f: { id: string; kind: string; title: string; level: { spx: number }; price: { spx: number }; firedAt: number; order?: { side: "largo" | "corto"; entry: { spx: number }; riskPts?: number | null; rewardPts?: number | null } | null; levelsAt?: number[] }): RetestAlertIn | null {
  if (!f.order || f.order.riskPts == null || f.order.riskPts <= 0) return null;
  return { id: f.id, kind: f.kind, title: f.title, side: f.order.side, level: f.level.spx, firedAt: f.firedAt, price: f.order.entry.spx, riskPts: f.order.riskPts, rewardPts: f.order.rewardPts ?? f.order.riskPts, levels: f.levelsAt };
}

/** Niveles de la pantalla (para "siguiente nivel"): niveles clave + niveles de dealers. */
export function screenLevels(p: { keyLevels?: { spx: number | null }[]; dealerLevels?: { spx: number | null }[] }): number[] {
  return [...new Set([...(p.keyLevels ?? []), ...(p.dealerLevels ?? [])].map((l) => l.spx).filter((v): v is number => typeof v === "number" && Number.isFinite(v)))];
}
