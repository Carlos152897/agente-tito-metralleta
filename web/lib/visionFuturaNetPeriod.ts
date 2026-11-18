// Posicionamiento NETO por periodo (PURO) — el modo "Neto" de la escalera, como la versión "v3" de
// VisionFutura (captura del 17-nov): UNA barra por strike, verde → Long / morada ← Short, con botones
// 5 · 15 · 30 min · Día y barras tenues cuando hay poco dinero. Va en dólares, como el resto de esta
// VisionFutura (MarketSnack da prima al ask / al bid por tipo; no hay contratos por lado).
//
//   neto = calls compradas + puts vendidas − calls vendidas − puts compradas
//        = callAsk + putBid − callBid − putAsk
//
// Periodo 5/15/30: a cada campo se le resta la foto de hace N min, sin bajar de 0 (solo lo que ENTRÓ).
// Si todavía no hay foto de hace N min se usa la más vieja y se marca "*". En 5 min, un strike con
// menos de 300 contratos nuevos (calls + puts) no se dibuja: es ruido.
// Fuerte = |neto| ≥ 10% del más fuerte de la pantalla; tenue = ≥ 1%; menos no se dibuja.

export type NetPeriod = 5 | 15 | 30 | "dia";
export const NET_PERIODS: NetPeriod[] = [5, 15, 30, "dia"];

export interface NetFields {
  callAsk: number;
  callBid: number;
  putAsk: number;
  putBid: number;
  /** Contratos operados (calls + puts). */
  vol: number;
}

export interface NetSourceRow {
  spx: number;
  callFlow: number;
  putFlow: number;
  callVolume?: number;
  putVolume?: number;
  callAsk?: number;
  callBid?: number;
  putAsk?: number;
  putBid?: number;
}

export interface NetSnap {
  /** ms */
  t: number;
  rows: Map<number, NetFields>;
}

export const NET_TUNING = { strong: 0.1, faint: 0.01, minContracts5m: 300 };

/** Campos del strike. Repeticiones viejas no traen ask/bid por tipo: se usa el neto de cada tipo. */
export function fieldsOf(r: NetSourceRow): NetFields {
  const has = r.callAsk != null && r.callBid != null && r.putAsk != null && r.putBid != null;
  return {
    callAsk: has ? r.callAsk! : Math.max(r.callFlow, 0),
    callBid: has ? r.callBid! : Math.max(-r.callFlow, 0),
    putAsk: has ? r.putAsk! : Math.max(r.putFlow, 0),
    putBid: has ? r.putBid! : Math.max(-r.putFlow, 0),
    vol: (r.callVolume ?? 0) + (r.putVolume ?? 0),
  };
}

export const snapOf = (rows: NetSourceRow[], t: number): NetSnap => ({ t, rows: new Map(rows.map((r) => [r.spx, fieldsOf(r)])) });

/** Foto de referencia para un periodo: la más nueva con t ≤ ahora − N min; si no hay, la más vieja ("*"). */
export function pickBase(snaps: NetSnap[], now: number, period: NetPeriod): { snap: NetSnap; stale: boolean } | null {
  if (period === "dia") return null;
  const target = now - period * 60_000;
  let best: NetSnap | null = null;
  let oldest: NetSnap | null = null;
  for (const s of snaps) {
    if (s.t >= now) continue;
    if (!oldest || s.t < oldest.t) oldest = s;
    if (s.t <= target && (!best || s.t > best.t)) best = s;
  }
  if (best) return { snap: best, stale: false };
  return oldest ? { snap: oldest, stale: true } : null;
}

export interface NetBar {
  strike: number;
  net: number;
  callsBought: number;
  putsSold: number;
  callsSold: number;
  putsBought: number;
  /** Contratos nuevos del periodo (o del día). */
  contracts: number;
}

/** Neto por strike en el periodo (sin escalar). `base` null = todo el día. */
export function netBars(rows: NetSourceRow[], base: Map<number, NetFields> | null, period: NetPeriod, tune = NET_TUNING): NetBar[] {
  const out: NetBar[] = [];
  for (const r of rows) {
    const f = fieldsOf(r);
    const b = base?.get(r.spx);
    const d = (k: keyof NetFields) => Math.max(0, f[k] - (b ? b[k] : 0));
    const bar: NetBar = {
      strike: r.spx,
      callsBought: d("callAsk"),
      callsSold: d("callBid"),
      putsBought: d("putAsk"),
      putsSold: d("putBid"),
      contracts: d("vol"),
      net: 0,
    };
    bar.net = bar.callsBought + bar.putsSold - bar.callsSold - bar.putsBought;
    if (period === 5 && bar.contracts < tune.minContracts5m) continue;
    if (bar.net !== 0) out.push(bar);
  }
  return out;
}

/** Suma las barras por fila de la cuadrícula (NQ/QQQ con filas más anchas que el strike). */
export function gridNetBars(bars: NetBar[], bucket: (s: number) => number): NetBar[] {
  const by = new Map<number, NetBar>();
  for (const x of bars) {
    const k = bucket(x.strike);
    const o = by.get(k);
    if (!o) { by.set(k, { ...x, strike: k }); continue; }
    o.net += x.net; o.callsBought += x.callsBought; o.putsSold += x.putsSold;
    o.callsSold += x.callsSold; o.putsBought += x.putsBought; o.contracts += x.contracts;
  }
  return [...by.values()];
}

export type NetTier = "fuerte" | "tenue";

/** Fuerte / tenue contra el strike más fuerte de la pantalla; los de menos de 1% no salen. */
export function tierBars(bars: NetBar[], tune = NET_TUNING): { bar: NetBar; tier: NetTier; frac: number }[] {
  const max = Math.max(0, ...bars.map((b) => Math.abs(b.net)));
  if (max <= 0) return [];
  return bars
    .map((bar) => ({ bar, frac: Math.abs(bar.net) / max }))
    .filter((x) => x.frac >= tune.faint)
    .map((x) => ({ ...x, tier: (x.frac >= tune.strong ? "fuerte" : "tenue") as NetTier }));
}
