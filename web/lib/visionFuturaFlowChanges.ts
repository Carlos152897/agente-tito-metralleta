// Cambios de flujo por strike entre dos refrescos de VisionFutura (Carlos, 23-oct-2026):
//   1) Posicionamiento por LADO: cuánto creció "arriba" (compra calls + venta puts) y
//      "abajo" (venta calls + compra puts), para ver si están aumentando los dos lados.
//   2) Agresor inusual: un salto grande de compras al ask o ventas al bid en un strike
//      (ej. 7,625: compras de $14.9M a $17M) → el strike se enciende en amarillo.
// PURO: sin red ni estado.

export interface FlowRow {
  spx: number;
  callFlow: number;
  putFlow: number;
  compras: number;
  ventas: number;
}

export interface FlowSnapshot {
  compras: number;
  ventas: number;
  up: number;
  down: number;
}

/** Posicionamiento de un strike separado por lado (los dos pueden crecer a la vez). */
export function positioningSides(r: Pick<FlowRow, "callFlow" | "putFlow">): { up: number; down: number } {
  return {
    up: Math.max(r.callFlow, 0) + Math.max(-r.putFlow, 0),
    down: Math.max(-r.callFlow, 0) + Math.max(r.putFlow, 0),
  };
}

export function snapshotOf(rows: FlowRow[]): Map<number, FlowSnapshot> {
  return new Map(rows.map((r) => [r.spx, { compras: r.compras, ventas: r.ventas, ...positioningSides(r) }]));
}

export const UNUSUAL_TUNING = {
  /** Salto mínimo en $ (filtra el ruido cuando el mercado está quieto). */
  minUsd: 250_000,
  /** …y al menos este % de la barra más grande de la pantalla (escala sola por instrumento). */
  pctOfMax: 0.1,
  /** …y si se movieron ≥ 3 strikes de ese lado, al menos N veces la mediana de sus saltos. */
  medianMult: 4,
  /** …y debe llevarse al menos este % de TODO lo nuevo de ese lado en el refresco (que destaque). */
  shareOfFlow: 0.12,
  /** Máximo de strikes encendidos por lado y refresco. */
  maxPerSide: 2,
  /** Minutos después de las 9:30 NY sin alertas: en la apertura todo es nuevo y todo parece inusual. */
  warmupMin: 15,
  /** Cuánto tiempo queda encendido el strike en vivo. */
  holdMs: 3 * 60_000,
};

export interface UnusualHit {
  strike: number;
  side: "compra" | "venta";
  delta: number;
  before: number;
  after: number;
  /** ms en que se detectó (lo pone quien llama). */
  at: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Minutos desde las 9:30 NY del mismo día (negativo antes de la apertura). */
export function minutesSinceOpen(atMs: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(atMs));
  const h = Number(p.find((x) => x.type === "hour")?.value) % 24;
  const m = Number(p.find((x) => x.type === "minute")?.value);
  return h * 60 + m - (9 * 60 + 30);
}

/**
 * Saltos inusuales de compras/ventas contra el refresco anterior.
 * `dayWarmup` (sesión de día): sin alertas en los primeros `warmupMin` minutos después de las 9:30.
 */
export function detectUnusual(rows: FlowRow[], prev: Map<number, FlowSnapshot> | null, at: number, t = UNUSUAL_TUNING, dayWarmup = true): UnusualHit[] {
  if (!prev || prev.size === 0) return [];
  if (dayWarmup) {
    const m = minutesSinceOpen(at);
    if (m >= 0 && m < t.warmupMin) return [];
  }
  const maxAgg = Math.max(1, ...rows.map((r) => Math.max(r.compras, r.ventas)));
  const hits: UnusualHit[] = [];
  for (const side of ["compra", "venta"] as const) {
    const key = side === "compra" ? "compras" : "ventas";
    const moves = rows
      .map((r) => {
        const p = prev.get(r.spx);
        return p ? { strike: r.spx, before: p[key], after: r[key], delta: r[key] - p[key] } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m != null && m.delta > 0);
    if (moves.length === 0) continue;
    const med = moves.length >= 3 ? median(moves.map((m) => m.delta)) : 0;
    const total = moves.reduce((a, m) => a + m.delta, 0);
    const floor = Math.max(t.minUsd, t.pctOfMax * maxAgg, t.medianMult * med, t.shareOfFlow * total);
    moves
      .filter((m) => m.delta >= floor)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, t.maxPerSide)
      .forEach((m) => hits.push({ ...m, side, at }));
  }
  return hits.sort((a, b) => b.delta - a.delta);
}

/** Junta los aciertos nuevos con los que siguen vigentes (uno por strike y lado, el más reciente). */
export function mergeUnusual(current: UnusualHit[], fresh: UnusualHit[], now: number, holdMs = UNUSUAL_TUNING.holdMs): UnusualHit[] {
  const byKey = new Map<string, UnusualHit>();
  for (const h of [...current, ...fresh]) {
    if (now - h.at > holdMs) continue;
    byKey.set(`${h.strike}:${h.side}`, h);
  }
  return [...byKey.values()];
}
