// Cuadrícula pareja de strikes para la gráfica de VisionFutura (Carlos, 30-oct-2026: "ajústame la
// pantalla para el NQ, se ve fea"). PURO, solo de pantalla: no cambia motores ni niveles.
//
// Problemas que arregla:
//   1) La gráfica dibuja las filas una tras otra, pero ubica velas y niveles por precio con el paso
//      más chico. Si los strikes vienen mezclados (NDX: 5, 10 y 25 pts) o con huecos, velas y
//      niveles quedan desalineados respecto a las filas. Aquí cada fila es un tramo del mismo tamaño
//      y los huecos se rellenan con filas vacías.
//   2) NQ con filas de 5–10 pts se ve como un peine (100 filas). La fila se agranda según la escala
//      del instrumento: ~5 pts de SPX × escala, múltiplo del paso nativo (NQ ≈ 4.5 → 20 pts).
//      SPX/ES quedan igual.
// Lo que va por strike (agresor anterior, volumen delta, inusuales, historial) se suma en su fila.

import type { VisionStrikeRow } from "./visionFutura";
import type { FlowSnapshot, UnusualHit } from "./visionFuturaFlowChanges";
import type { StrikeMinute, VolDeltaRow, VolSpike } from "./visionFuturaVolumeDelta";

const NICE_STEPS = [0.5, 1, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500];

/** Paso mínimo entre strikes (el "nativo" de la cadena). */
export function nativeStep(strikes: number[]): number {
  const s = [...new Set(strikes)].sort((a, b) => a - b);
  let m = Infinity;
  for (let i = 1; i < s.length; i++) m = Math.min(m, s[i] - s[i - 1]);
  return Number.isFinite(m) && m > 0 ? m : 5;
}

/**
 * Tamaño de fila en pantalla: el paso "bonito" más chico que sea ≥ al nativo y ≥ ~80% de
 * 5 pts × escala (lo que mide una fila de SPX en ese instrumento). SPX (escala 1, paso 5) → 5.
 */
export function gridStepFor(native: number, scale: number | null | undefined): number {
  const target = 5 * (scale && scale > 0 ? scale : 1) * 0.8;
  const want = Math.max(native, target);
  return NICE_STEPS.find((s) => s >= want - 1e-9 && s % native < 1e-9) ?? NICE_STEPS.find((s) => s >= want - 1e-9) ?? native;
}

/** Fila (centro del tramo) a la que pertenece un strike. */
// A mitad de tramo va hacia abajo (28,510 con filas de 20 → 28,500): cada fila = su strike + el de arriba.
export const bucketOf = (strike: number, step: number) => Math.round(strike / step - 1e-9) * step;

type Row = VisionStrikeRow & Record<string, unknown>;

const SUM_KEYS = ["callGex", "putGex", "netGex", "charm", "callFlow", "putFlow", "compras", "ventas", "callVolume", "putVolume"] as const;

/** Peso de un strike dentro de su fila: el que más GEX y flujo tiene manda en lo que no se suma. */
const weight = (r: VisionStrikeRow) => Math.abs(r.netGex) + Math.abs(r.callFlow) + Math.abs(r.putFlow);

/**
 * Agrupa las filas (de mayor a menor) en tramos de `step` y rellena los huecos. Si ya son parejas
 * y del mismo paso, las devuelve igual. `cover` agrega filas vacías (máx. `maxExtra` por lado, 15) para
 * que quepa el rango del precio. Lo que no se suma (rol de dealers, una pata, otros
 * vencimientos…) viene del strike con más peso del tramo; las etiquetas se juntan.
 */
export function gridRows<R extends VisionStrikeRow>(rows: R[], step: number, cover?: { lo: number; hi: number; maxExtra?: number } | null): R[] {
  if (rows.length === 0) return rows;
  const by = new Map<number, R[]>();
  for (const r of rows) {
    const k = bucketOf(r.spx, step);
    const list = by.get(k);
    if (list) list.push(r); else by.set(k, [r]);
  }
  const keys = [...by.keys()];
  let hi = Math.max(...keys), lo = Math.min(...keys);
  // Filas vacías extra para que quepa el rango del precio (velas que se salen de los strikes con datos).
  if (cover && Number.isFinite(cover.lo) && Number.isFinite(cover.hi)) {
    const maxExtra = (cover.maxExtra ?? 15) * step;
    hi = Math.max(hi, Math.min(bucketOf(cover.hi, step) + step, hi + maxExtra));
    lo = Math.min(lo, Math.max(bucketOf(cover.lo, step) - step, lo - maxExtra));
  }
  const out: R[] = [];
  let template: R | null = null;
  for (let k = hi; k >= lo - step / 2; k = Math.round((k - step) * 1e6) / 1e6) {
    const list = by.get(k);
    if (!list) {
      // Hueco: fila vacía (sin GEX ni flujo) con la conversión de un vecino.
      const ref = template ?? rows[0];
      out.push(emptyRow(ref, k));
      continue;
    }
    const top = list.reduce((a, b) => (weight(b) > weight(a) ? b : a));
    const merged = { ...top } as Row;
    for (const key of SUM_KEYS) merged[key] = list.reduce((s, r) => s + (r[key] as number), 0);
    merged.spx = k;
    merged.spy = top.spy != null ? (top.spy * k) / top.spx : null;
    merged.es = top.es != null ? top.es + (k - top.spx) : null;
    merged.tags = [...new Set(list.flatMap((r) => r.tags))];
    merged.strongFlow = list.some((r) => r.strongFlow);
    out.push(merged as R);
    template = merged as R;
  }
  return out;
}

function emptyRow<R extends VisionStrikeRow>(ref: R, k: number): R {
  const r = { ...ref } as Row;
  for (const key of SUM_KEYS) r[key] = 0;
  r.spx = k;
  r.spy = ref.spy != null ? (ref.spy * k) / ref.spx : null;
  r.es = ref.es != null ? ref.es + (k - ref.spx) : null;
  r.tags = [];
  r.strongFlow = false;
  r.dealerCalls = null;
  r.dealerPuts = null;
  r.dealerRole = null;
  delete r.legs;
  delete r.multiExp;
  delete r.backing;
  return r as R;
}

/** Foto anterior del agresor sumada por fila. */
export function gridSnapshot(prev: Map<number, FlowSnapshot> | null, step: number): Map<number, FlowSnapshot> | null {
  if (!prev) return prev;
  const out = new Map<number, FlowSnapshot>();
  for (const [s, v] of prev) {
    const k = bucketOf(s, step);
    const o = out.get(k) ?? { compras: 0, ventas: 0, up: 0, down: 0 };
    out.set(k, { compras: o.compras + v.compras, ventas: o.ventas + v.ventas, up: o.up + v.up, down: o.down + v.down });
  }
  return out;
}

/** Inusuales en su fila: si caen dos en la misma, se queda el más grande. */
export function gridUnusual(list: UnusualHit[] | undefined, step: number): UnusualHit[] | undefined {
  if (!list) return list;
  const by = new Map<number, UnusualHit>();
  for (const u of list) {
    const k = bucketOf(u.strike, step);
    const cur = by.get(k);
    if (!cur || u.delta > cur.delta) by.set(k, { ...u, strike: k });
  }
  return [...by.values()];
}

/** Volumen delta sumado por fila (contratos), posición dominante del strike con más peso. */
export function gridVolRows(rows: VolDeltaRow[], step: number): VolDeltaRow[] {
  const by = new Map<number, VolDeltaRow[]>();
  for (const r of rows) {
    const k = bucketOf(r.strike, step);
    const l = by.get(k);
    if (l) l.push(r); else by.set(k, [r]);
  }
  return [...by.entries()].map(([k, l]) => {
    const sum = (f: (r: VolDeltaRow) => number) => l.reduce((s, r) => s + f(r), 0);
    const anyPrev = l.some((r) => r.prevDelta != null);
    const top = l.reduce((a, b) => ((b.position?.contracts ?? 0) > (a.position?.contracts ?? 0) ? b : a));
    return {
      strike: k,
      cA: sum((r) => r.cA), cB: sum((r) => r.cB), cV: sum((r) => r.cV),
      pA: sum((r) => r.pA), pB: sum((r) => r.pB), pV: sum((r) => r.pV),
      delta: sum((r) => r.delta),
      prevDelta: anyPrev ? sum((r) => r.prevDelta ?? 0) : null,
      position: top.position,
    };
  });
}

/** Minuto a minuto sumado por fila. */
export function gridMinutes(by: Map<number, StrikeMinute[]>, step: number): Map<number, StrikeMinute[]> {
  const acc = new Map<number, Map<number, StrikeMinute>>();
  for (const [s, mins] of by) {
    const k = bucketOf(s, step);
    let m = acc.get(k);
    if (!m) acc.set(k, (m = new Map()));
    for (const x of mins) {
      const o = m.get(x.t) ?? { t: x.t, cA: 0, cB: 0, cV: 0, pA: 0, pB: 0, pV: 0 };
      m.set(x.t, { t: x.t, cA: o.cA + x.cA, cB: o.cB + x.cB, cV: o.cV + x.cV, pA: o.pA + x.pA, pB: o.pB + x.pB, pV: o.pV + x.pV });
    }
  }
  return new Map([...acc.entries()].map(([k, m]) => [k, [...m.values()].sort((a, b) => a.t - b.t)]));
}

/** Saltos de volumen en su fila: el más grande por fila. */
export function gridSpikes(list: VolSpike[], step: number): VolSpike[] {
  const by = new Map<number, VolSpike>();
  for (const v of list) {
    const k = bucketOf(v.strike, step);
    const cur = by.get(k);
    if (!cur || v.contracts > cur.contracts) by.set(k, { ...v, strike: k });
  }
  return [...by.values()];
}
