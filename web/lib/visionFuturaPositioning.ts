// Posicionamiento Long/Short por strike y su historial del día (PURO). Traído del zip
// "visionfutura-main" (versión reconstruida de VisionFutura, oct-2026) y adaptado a las filas de
// este proyecto, que traen el flujo neto en dólares (callFlow / putFlow = ask − bid), no contratos.
//
//   Long  = calls compradas + puts vendidas  > calls vendidas + puts compradas → gana si sube.
//   Short = al revés.                         Neto del strike = callFlow − putFlow.
//
// Un strike cuenta como posicionado si su neto es ≥ 10% del más fuerte de la pantalla. El historial
// guarda franjas (desde cuándo un strike está Long o Short) y eventos: entra, cambia de lado, sale,
// se prende (agresor inusual) y "presión" (el precio está a ≤ 1 strike de un strike posicionado y
// entra dinero nuevo a favor de su lado). La presión es una marca para observar y medir — a
// cuántos puntos estuvo el precio 15/30/60 min después (`markOutcome`) — no una alerta de entrada.

import { detectUnusual, snapshotOf } from "./visionFuturaFlowChanges";

export type PosSide = "L" | "S";
export type PosSegment = { strike: number; side: PosSide; start: number; end: number | null };
export type PosEvent = { t: number; strike: number; kind: "entra" | "cambia" | "sale" | "prende" | "presion"; side?: PosSide; text?: string };
export type PosHistory = {
  segments: PosSegment[];
  events: PosEvent[];
  /** Cambios esperando confirmación: lado candidato, lecturas seguidas y desde cuándo (ms). */
  pending: Record<string, { side: PosSide | null; n: number; since?: number }>;
};

/** Lo mínimo de una fila de strike que usa este módulo. */
export interface PosRow {
  spx: number;
  callFlow: number;
  putFlow: number;
}

/** Salto inusual de compras/ventas (lib/visionFuturaFlowChanges.ts → UnusualHit). */
export interface PosUnusual {
  strike: number;
  side: "compra" | "venta";
  delta: number;
  /** Compra y venta del mismo tamaño en el mismo strike (no direccional). */
  cruce?: boolean;
}

export const POS_TUNING = {
  /** Un strike cuenta como posicionado si su neto es ≥ 10% del neto del strike más fuerte. */
  minOfMax: 0.1,
  /** Lecturas seguidas y tiempo mínimo sostenido para aceptar un cambio (que un strike en el límite no llene la lista). */
  confirm: 2,
  confirmMs: 60_000,
  maxEvents: 200,
};

export const emptyPosHistory = (): PosHistory => ({ segments: [], events: [], pending: {} });

/** Neto Long − Short del strike en dólares. */
export const netOf = (r: Pick<PosRow, "callFlow" | "putFlow">) => r.callFlow - r.putFlow;

export function fmtUsd(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}K` : `${Math.round(a)}`;
  return `${n < 0 ? "−" : ""}$${s}`;
}

/** Strikes posicionados ahora: Long o Short (los que no llegan al mínimo no aparecen). */
export function classify(rows: PosRow[], t = POS_TUNING): Map<number, PosSide> {
  const nets = rows.map((r) => [r.spx, netOf(r)] as const);
  const max = Math.max(0, ...nets.map(([, n]) => Math.abs(n)));
  const out = new Map<number, PosSide>();
  if (max <= 0) return out;
  for (const [k, n] of nets) if (n !== 0 && Math.abs(n) >= t.minOfMax * max) out.set(k, n > 0 ? "L" : "S");
  return out;
}

export const sideName = (s: PosSide) => (s === "L" ? "Long" : "Short");

/** Texto de un salto inusual: "▲ compra +$9.6M". */
export function unusualText(u: PosUnusual): string {
  if (u.cruce) return `⇄ cruce compra/venta +${fmtUsd(u.delta)} (no direccional)`;
  return `${u.side === "compra" ? "▲ compra" : "▼ venta"} +${fmtUsd(u.delta)} (agresor inusual)`;
}

export type PressureMark = {
  t: number;
  strike: number;
  side: PosSide;
  /** Neto nuevo a favor del lado ($). */
  amount: number;
  /** Cambio del neto de puts y de calls contra la lectura anterior ($; negativo = vendidas). */
  putNet: number;
  callNet: number;
  spot: number;
  text: string;
  /** Puntos a favor 15, 30 y 60 min después (null si todavía no pasa ese tiempo). */
  after?: { m15: number | null; m30: number | null; m60: number | null };
};

export const PRESSURE_TUNING = { minUsd: 250_000, maxSteps: 1 };

/** Marcas de presión de esta lectura contra la anterior (ver arriba). `minUsd` se escala por instrumento. */
export function pressureMarks(rows: PosRow[], prev: PosRow[] | null, spot: number, step: number, t: number, tune = PRESSURE_TUNING): PressureMark[] {
  if (!prev || prev.length === 0) return [];
  const before = new Map(prev.map((r) => [r.spx, r]));
  const pos = classify(rows);
  const out: PressureMark[] = [];
  for (const r of rows) {
    const side = pos.get(r.spx);
    const p = before.get(r.spx);
    if (!side || !p) continue;
    if (Math.abs(r.spx - spot) > tune.maxSteps * step + 1e-9) continue;
    const putNet = r.putFlow - p.putFlow;
    const callNet = r.callFlow - p.callFlow;
    const amount = side === "S" ? putNet - callNet : callNet - putNet;
    if (amount < tune.minUsd) continue;
    // Solo las patas que van a favor del lado: Short = compran puts / venden calls; Long = compran calls / venden puts.
    const parts = side === "S"
      ? [putNet > 0 ? `compran PUT +${fmtUsd(putNet)}` : null, callNet < 0 ? `venden CALL +${fmtUsd(-callNet)}` : null]
      : [callNet > 0 ? `compran CALL +${fmtUsd(callNet)}` : null, putNet < 0 ? `venden PUT +${fmtUsd(-putNet)}` : null];
    const text = `● ${sideName(side)} · ${parts.filter(Boolean).join(" · ")} · presión ${side === "S" ? "abajo" : "arriba"}`;
    out.push({ t, strike: r.spx, side, amount, putNet, callNet, spot, text });
  }
  return out;
}

/** Puntos a favor de una marca 15, 30 y 60 min después, con la serie de precio del día (t en ms). */
export function markOutcome(m: PressureMark, prices: { t: number; v: number }[]): NonNullable<PressureMark["after"]> {
  const dir = m.side === "L" ? 1 : -1;
  const last = prices[prices.length - 1];
  const at = (min: number) => {
    const target = m.t + min * 60_000;
    if (!last || last.t < target) return null;
    let v: number | null = null;
    for (const p of prices) {
      if (p.t <= target) v = p.v;
      else break;
    }
    return v == null ? null : Math.round((v - m.spot) * dir * 100) / 100;
  };
  return { m15: at(15), m30: at(30), m60: at(60) };
}

/**
 * Avanza el historial con una lectura. La primera lectura del día se acepta tal cual; después,
 * un strike entra, cambia de lado o sale solo si se sostiene `confirm` lecturas seguidas y `confirmMs`.
 */
export function stepPositions(h: PosHistory, rows: PosRow[], t: number, unusual: PosUnusual[] = [], marks: PressureMark[] = [], tune = POS_TUNING): PosHistory {
  const segments = h.segments.map((s) => ({ ...s }));
  const events = [...h.events];
  const pending: PosHistory["pending"] = {};
  const first = segments.length === 0 && events.length === 0;
  const now = classify(rows, tune);
  const open = new Map(segments.filter((s) => s.end == null).map((s) => [s.strike, s]));
  // Un strike abierto que quedó fuera de la ventana de la escalera no se cierra: no hay lectura de él.
  const visible = new Set(rows.map((r) => r.spx));
  const strikes = new Set([...now.keys(), ...[...open.keys()].filter((k) => visible.has(k))]);

  for (const k of strikes) {
    const cand = now.get(k) ?? null;
    const cur = open.get(k) ?? null;
    if ((cur?.side ?? null) === cand) continue;
    const p = h.pending[String(k)];
    const same = p && p.side === cand;
    const n = same ? p.n + 1 : 1;
    const since = same ? (p.since ?? t) : t;
    if (!first && (n < tune.confirm || t - since < tune.confirmMs)) {
      pending[String(k)] = { side: cand, n, since };
      continue;
    }
    if (cur) cur.end = t;
    if (cand) segments.push({ strike: k, side: cand, start: t, end: null });
    if (!first) {
      if (cur && cand) events.push({ t, strike: k, kind: "cambia", side: cand, text: `pasó de ${sideName(cur.side)} a ${sideName(cand)}` });
      else if (cand) events.push({ t, strike: k, kind: "entra", side: cand, text: `entra ${sideName(cand)}` });
      else if (cur) events.push({ t, strike: k, kind: "sale", side: cur.side, text: "sale (ya no está posicionado)" });
    }
  }
  const seenCruce = new Set<number>();
  for (const u of unusual) {
    if (u.cruce) { if (seenCruce.has(u.strike)) continue; seenCruce.add(u.strike); }
    events.push({ t, strike: u.strike, kind: "prende", text: unusualText(u) });
  }
  for (const m of marks) events.push({ t, strike: m.strike, kind: "presion", side: m.side, text: m.text });
  return { segments, events: events.slice(-tune.maxEvents), pending };
}

/** El historial visto en el momento `t` (para la repetición): lo que pasó hasta ese momento. */
export function historyAt(h: Pick<PosHistory, "segments" | "events">, t: number): Pick<PosHistory, "segments" | "events"> {
  return {
    segments: h.segments.filter((s) => s.start <= t).map((s) => (s.end != null && s.end > t ? { ...s, end: null } : s)),
    events: h.events.filter((e) => e.t <= t),
  };
}

/** Paso guardado de una repetición: hora (s), spot y filas con compras/ventas (ver ReplayTick). */
export interface PosTick {
  time: number;
  spot: { spx: number };
  rows: (PosRow & { compras: number; ventas: number })[];
}

/**
 * Historial Long/Short y marcas de presión de una repetición, calculados desde sus pasos guardados
 * (sirve también para días viejos: no hace falta rearmar la repetición). Cada marca trae su
 * resultado a 15/30/60 min con el precio de los mismos pasos.
 */
export function positionsFromTicks(ticks: PosTick[], night = false): { history: PosHistory; pressure: PressureMark[] } {
  let h = emptyPosHistory();
  const pressure: PressureMark[] = [];
  let prev: PosTick | null = null;
  for (const tk of ticks) {
    if (tk.rows.length === 0) continue;
    const t = tk.time * 1000;
    const rows: PosRow[] = tk.rows.map((r) => ({ spx: r.spx, callFlow: r.callFlow, putFlow: r.putFlow }));
    const step = rows.length > 1 ? Math.abs(rows[1].spx - rows[0].spx) : 5;
    const unusual = prev ? detectUnusual(tk.rows, snapshotOf(prev.rows), t, undefined, !night).map((u) => ({ strike: u.strike, side: u.side, delta: u.delta, cruce: u.cruce })) : [];
    const marks = prev ? pressureMarks(rows, prev.rows, tk.spot.spx, step, t) : [];
    pressure.push(...marks);
    // En la repetición cada paso es de 5 min: un cambio sostenido 2 pasos ya pasó el minuto de confirmación.
    h = stepPositions(h, rows, t, unusual, marks);
    prev = tk;
  }
  const prices = ticks.map((tk) => ({ t: tk.time * 1000, v: tk.spot.spx }));
  return { history: h, pressure: pressure.map((m) => ({ ...m, after: markOutcome(m, prices) })) };
}
