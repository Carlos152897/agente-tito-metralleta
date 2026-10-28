// Resultado de cada entrada de "Alertas y órdenes" (Carlos, 27-oct-2026: "cada entrada que se haga en
// vivo, cuando llegue una nueva entrada me pongas ganada o perdida a las viejas y a la nueva entrada
// abierta"). PURO.
//
//   - La entrada más nueva queda ABIERTA hasta que toca su stop u objetivo.
//   - Si toca el objetivo → GANADA; si toca el stop → PERDIDA.
//   - Si llega una entrada nueva y la anterior sigue abierta, la anterior se cierra al precio de ese
//     momento ("nueva alerta") y queda GANADA o PERDIDA según cómo iba. Así hay una sola abierta.
//   - Al cierre del mercado, lo que siga abierto sale al último precio ("cierre").
// Mismo punto con stop y objetivo = stop (conservador).

export type OrderStatus = "abierta" | "ganada" | "perdida" | "empate";
export type OrderExitReason = "objetivo" | "stop" | "nueva alerta" | "cierre";

export interface OrderResult {
  status: OrderStatus;
  reason: OrderExitReason | null;
  exit: number | null;
  exitAt: number | null;
  /** Puntos a favor (cerrada) o "va ganando/perdiendo" (abierta, con el último precio). */
  points: number | null;
}

export interface OrderInput {
  side: "largo" | "corto";
  entry: number;
  stop: number;
  target: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pts = (o: OrderInput, px: number) => r2(o.side === "largo" ? px - o.entry : o.entry - px);
const statusOf = (p: number): OrderStatus => (p > 0 ? "ganada" : p < 0 ? "perdida" : "empate");

export const openResult = (): OrderResult => ({ status: "abierta", reason: null, exit: null, exitAt: null, points: null });

/** Cierra una orden a un precio por un motivo. */
export function closeAt(o: OrderInput, px: number, at: number, reason: OrderExitReason): OrderResult {
  const p = pts(o, px);
  return { status: statusOf(p), reason, exit: r2(px), exitAt: at, points: p };
}

/** Avanza una orden abierta con un precio nuevo: toca stop/objetivo, o sigue abierta con su "va". */
export function stepOrder(o: OrderInput, cur: OrderResult, px: number, at: number): OrderResult {
  if (cur.status !== "abierta") return cur;
  const up = o.side === "largo";
  if (up ? px <= o.stop : px >= o.stop) return closeAt(o, o.stop, at, "stop");
  if (o.target != null && (up ? px >= o.target : px <= o.target)) return closeAt(o, o.target, at, "objetivo");
  return { ...cur, points: pts(o, px) };
}

/**
 * Resultados de todas las entradas del día con una serie de precios (repetición): cada una corre
 * hasta tocar stop/objetivo o hasta que salga la siguiente. `final` = la sesión ya cerró.
 */
/** Avanza con una vela (máximo/mínimo): si en la misma vela caben stop y objetivo, cuenta el stop. */
export function stepOrderBar(o: OrderInput, cur: OrderResult, bar: { t: number; high: number; low: number; close: number }): OrderResult {
  if (cur.status !== "abierta") return cur;
  const up = o.side === "largo";
  if (up ? bar.low <= o.stop : bar.high >= o.stop) return closeAt(o, o.stop, bar.t, "stop");
  if (o.target != null && (up ? bar.high >= o.target : bar.low <= o.target)) return closeAt(o, o.target, bar.t, "objetivo");
  return { ...cur, points: pts(o, bar.close) };
}

/**
 * Resultados de todas las entradas del día con una serie de precios (puntos `v`) o de velas
 * (`high`/`low`/`close`, `t` = inicio de la vela: la vela en curso cuando salió la entrada no cuenta).
 */
export function orderResultsFromPrices(
  entries: (OrderInput & { at: number })[],
  prices: { t: number; v?: number; high?: number; low?: number; close?: number }[],
  nowMs: number,
  final: boolean,
): OrderResult[] {
  const px = prices.filter((p) => p.t <= nowMs).sort((a, b) => a.t - b.t);
  const val = (p: (typeof px)[number]) => p.close ?? p.v ?? 0;
  const order = entries.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at);
  const out: OrderResult[] = entries.map(() => openResult());
  order.forEach(({ e, i }, k) => {
    const nextAt = order[k + 1]?.e.at ?? Infinity;
    let res = openResult();
    for (const p of px) {
      if (p.t <= e.at) continue;
      if (p.t >= nextAt) break;
      res = p.high != null && p.low != null
        ? stepOrderBar(e, res, { t: p.t, high: p.high, low: p.low, close: val(p) })
        : stepOrder(e, res, val(p), p.t);
      if (res.status !== "abierta") break;
    }
    if (res.status === "abierta" && nextAt !== Infinity) {
      // La siguiente salió con esta abierta: se cierra al precio de ese momento.
      const at = px.filter((p) => p.t <= nextAt).at(-1);
      res = closeAt(e, at ? val(at) : e.entry, nextAt, "nueva alerta");
    } else if (res.status === "abierta" && final) {
      const last = px.at(-1);
      if (last && last.t > e.at) res = closeAt(e, val(last), last.t, "cierre");
    }
    out[i] = res;
  });
  return out;
}

export function orderSummary(results: OrderResult[]) {
  const closed = results.filter((r) => r.status !== "abierta");
  return {
    n: results.length,
    open: results.length - closed.length,
    wins: closed.filter((r) => r.status === "ganada").length,
    losses: closed.filter((r) => r.status === "perdida").length,
    points: r2(closed.reduce((a, r) => a + (r.points ?? 0), 0)),
  };
}
