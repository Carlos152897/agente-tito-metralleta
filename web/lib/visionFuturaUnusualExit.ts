// ¿Ya salieron de la operación inusual? (28-oct-2026: "cuando entran una forma inusual, desaparecer
// la bola cuando ya se salgan y dejarlas mientras sigan dentro" → círculo vacío y tenue al salir).
// PURO. Durante el día nadie publica cierres (el OI llega hasta mañana), así que es una ESTIMACIÓN:
//   - Fuerte: MarketSnack reporta después otra inusual en el MISMO contrato, del lado contrario y de
//     tamaño parecido (≥ 75%). Ej.: 250 PUT 7,720 compradas al ask … luego ~250 vendidas al bid.
//   - Estimada: el NETO del lado contrario en ese contrato (al bid − al ask si fue compra; bloques de
//     5 min de trade_summaries que empiezan DESPUÉS de la bola) ya suma su tamaño. Si hay varias bolas
//     del mismo lado en el contrato, se reparte en orden (la más vieja se cierra primero).
// Las bolas a mitad (MID) no tienen lado: no se marcan.

import type { MsUnusualTrade } from "./marketsnack";
import type { TradeSummaryBucket } from "./neighborContracts";

export const EXIT_TUNING = {
  /** Tamaño mínimo de la contraria inusual, como fracción de la bola. */
  strongRatio: 0.75,
  bucketMs: 5 * 60_000,
};

export interface DotExit {
  id: number;
  /** segundos */
  at: number;
  /** fuerte / estimada = esta bola ya salió; cierre = esta bola ES la salida de otra (no es posición nueva). */
  kind: "fuerte" | "estimada" | "cierre";
  /** Contratos del lado contrario que cuentan como salida. */
  qty: number;
  text: string;
}

const sideOf = (s: string): "compra" | "venta" | null => {
  const u = (s ?? "").toUpperCase();
  return u.includes("ASK") ? "compra" : u.includes("BID") ? "venta" : null;
};

/**
 * Salidas estimadas de las inusuales del día. `flow` = bloques de 5 min por símbolo OCC.
 * `nowMs` limita la hora (una salida "estimada" se conoce al terminar su bloque).
 */
export function unusualExits(trades: MsUnusualTrade[], flow: Record<string, TradeSummaryBucket[] | undefined>, nowMs: number, t = EXIT_TUNING): Record<number, DotExit> {
  const out: Record<number, DotExit> = {};
  const bySym = new Map<string, MsUnusualTrade[]>();
  for (const u of trades) {
    if (!Number.isFinite(Date.parse(u.timestamp))) continue;
    (bySym.get(u.symbol) ?? bySym.set(u.symbol, []).get(u.symbol)!).push(u);
  }
  for (const [sym, list] of bySym) {
    list.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const exits = new Map<number, DotExit>();

    // 1) Fuerte: la contraria inusual de tamaño parecido (cada contraria cierra una sola bola).
    const used = new Set<number>();
    for (const d of list) {
      const s = sideOf(d.side);
      if (!s || !(d.size > 0)) continue;
      const tm = Date.parse(d.timestamp);
      if (used.has(d.id)) continue; // esta ya es el cierre de otra
      const opp = list.find((o) => !used.has(o.id) && o.id !== d.id && Date.parse(o.timestamp) > tm && sideOf(o.side) === (s === "compra" ? "venta" : "compra") && o.size >= t.strongRatio * d.size);
      if (opp) {
        used.add(opp.id);
        exits.set(d.id, {
          id: d.id, at: Math.floor(Date.parse(opp.timestamp) / 1000), kind: "fuerte", qty: opp.size,
          text: `${s === "compra" ? "vendieron" : "compraron"} ${opp.size} ${s === "compra" ? "al bid" : "al ask"} (inusual de MarketSnack)`,
        });
        const hhmm = new Date(tm).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
        exits.set(opp.id, {
          id: opp.id, at: Math.floor(Date.parse(opp.timestamp) / 1000), kind: "cierre", qty: d.size,
          text: `parece el cierre de la ${s} de ${d.size} de las ${hhmm}, no una posición nueva`,
        });
      }
    }

    // 2) Estimada: volumen del lado contrario después de la bola, repartido en orden.
    const buckets = (flow[sym] ?? []).map((b) => ({ ...b, ms: Date.parse(b.t) })).filter((b) => Number.isFinite(b.ms)).sort((a, b) => a.ms - b.ms);
    for (const s of ["compra", "venta"] as const) {
      const dots = list.filter((d) => sideOf(d.side) === s && d.size > 0 && exits.get(d.id)?.kind !== "cierre").map((d) => {
        const tm = Date.parse(d.timestamp);
        return { d, startMs: Math.floor(tm / t.bucketMs) * t.bucketMs + t.bucketMs, left: d.size, seen: 0 };
      });
      if (!dots.length) continue;
      // NETO del lado contrario (en los 0DTE siempre hay otros operando de los dos lados): lo que se
      // compra del mismo lado después de la entrada primero se descuenta ("deuda") antes de cerrar.
      let debt = 0;
      for (const b of buckets) {
        const end = b.ms + t.bucketMs;
        if (end > nowMs) break;
        if (!dots.some((q) => q.left > 0 && b.ms >= q.startMs)) continue;
        const opp = s === "compra" ? b.bid_volume ?? 0 : b.ask_volume ?? 0;
        const same = s === "compra" ? b.ask_volume ?? 0 : b.bid_volume ?? 0;
        let vol = opp - same;
        if (vol < 0) { debt += -vol; continue; }
        const pay = Math.min(debt, vol);
        debt -= pay;
        vol -= pay;
        for (const q of dots) {
          if (vol <= 0) break;
          if (q.left <= 0 || b.ms < q.startMs) continue;
          const take = Math.min(vol, q.left);
          q.left -= take;
          q.seen += take;
          vol -= take;
          // Se queda la salida que pasó primero (la fuerte, si fue antes que esta).
          const prev = exits.get(q.d.id);
          if (q.left <= 0 && (!prev || prev.at > Math.floor(end / 1000))) {
            exits.set(q.d.id, {
              id: q.d.id, at: Math.floor(end / 1000), kind: "estimada", qty: q.seen,
              text: `el contrato ${s === "compra" ? "se vendió" : "se compró"} neto ${q.seen} ${s === "compra" ? "al bid" : "al ask"} desde la entrada (estimado: puede ser de otros)`,
            });
          }
        }
      }
    }
    for (const [id, e] of exits) out[id] = e;
  }
  return out;
}

/** Símbolos que vale la pena seguir (inusuales con lado). */
export function symbolsToTrack(trades: MsUnusualTrade[]): string[] {
  return [...new Set(trades.filter((u) => sideOf(u.side) && u.size > 0).map((u) => u.symbol))];
}
