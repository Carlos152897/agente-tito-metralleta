// Imanes por FLUJO (Carlos, 30-oct-2026: "agrégame lo del imán así como tiene esa app, imán positivo
// y negativo con su respectiva fuerza"). Definición de la guía "Escalera de gamma":
//   Imán + = strike cercano con más compra de calls + venta de puts (se posicionan para que suba)
//   Imán − = strike cercano con más venta de calls + compra de puts (se posicionan para que baje)
// Se buscan a ±70 pts del precio (SPX; otros × escala) con lo operado en los últimos 15 min.
// Fuerza = contratos netos de la ventana: (calls al ask + puts al bid) − (calls al bid + puts al ask),
// o sea el mismo Δ del volumen delta. PURO. Aparte de los imanes por GEX (esos no cambian).

import type { StrikeMinute } from "./visionFuturaVolumeDelta";

export const FLOW_MAGNET_TUNING = {
  /** Ventana de flujo (segundos). La app de referencia usa 15 min por defecto. */
  windowSec: 900,
  /** Distancia máxima al precio (pts de SPX; se multiplica por la escala del instrumento). */
  radiusPts: 70,
  /** Contratos netos mínimos para marcar un imán. */
  minContracts: 25,
};

/**
 * Modelo "imanesSofia" (Carlos, 3-nov-2026: "haz el modelo de sofia"). Copia del imán de la app SofIA:
 * sale de su columna del agresor ("▲▼ vs 1 min"): Imán + = strike con más compras netas en el ÚLTIMO
 * minuto cerrado, Imán − = el de más ventas netas; fuerza = esos contratos. Se busca en ±15 strikes
 * (±75 pts de SPX × escala). Misma Δ que el volumen delta; solo cambia la ventana (1 min vs 15 min).
 * Verificado contra la captura de SofIA 9:48 (Imán + 7,560 fuerza 212 = 212 compras en su columna).
 */
export const SOFIA_MAGNET_TUNING = {
  windowSec: 60,
  radiusPts: 75,
  minContracts: 10,
};

/**
 * Imán ACUMULADO (Carlos, 12-nov-2026, tras el video de SofIA del NQ 11-nov: Imán + 28,480 se quedó
 * FIJO de 10:19 a 11:50 con fuerza 177 → 245 → 504 → 720 → 769 y el precio llegó a 28,487). Una
 * fuerza que sube sin parar 90 min no puede ser el neto de 1 min → es lo ACUMULADO del día. Mismo Δ
 * que el resto, sumado desde la apertura. Se mide aparte (no reemplaza al de 1 min ni al de 15 min).
 */
export const CUMULATIVE_MAGNET_TUNING = {
  /** "Todo el día": más largo que cualquier sesión, la suma arranca en la apertura. */
  windowSec: 86_400,
  radiusPts: 75,
  minContracts: 25,
  /** Tendencia de la fuerza: contra cuánto tenía el mismo strike hace 15 min. */
  trendLookbackSec: 900,
};

export interface FlowMagnet {
  strike: number;
  /** Contratos netos de la ventana (siempre positivo; el lado lo dice `kind`). */
  fuerza: number;
  /** Solo imán acumulado: fuerza del MISMO strike `trendLookbackSec` antes (mismo lado, puede ser ≤0). */
  prevFuerza?: number;
  /** Solo imán acumulado: segundo desde el que es el imán sin cambiar de strike. */
  since?: number;
  /** Solo imán GEX × lado: contratos agresivos netos de la ventana que le dieron el lado (+ compras, − ventas). */
  lado?: number;
}

export interface FlowMagnets {
  pos: FlowMagnet | null;
  neg: FlowMagnet | null;
  /** Solo imán GEX × lado: de dónde sale `lado`. "5m" = contratos agresivos de 5 min (día);
   *  "sesion_usd" = $ comprado − vendido de la sesión (modo noche, streamer de futuros). */
  ladoFuente?: "5m" | "sesion_usd";
}

export interface FlowMagnetSegment {
  kind: "pos" | "neg";
  strike: number;
  /** segundos */
  start: number;
  end: number;
  /** Fuerza más grande mientras estuvo en ese strike. */
  fuerza: number;
}

const deltaOf = (m: StrikeMinute) => m.cA + m.pB - (m.cB + m.pA);

interface Opts { windowSec?: number; radius?: number; minContracts?: number }

/**
 * Contratos netos por strike en (toT − ventana, toT]. Cada minuto `t` cubre [t, t+60): entra si
 * t ≥ toT − ventana y t < toT (igual que volDeltaRows).
 */
function windowDeltas(by: Map<number, StrikeMinute[]>, toT: number, windowSec: number): Map<number, number> {
  const out = new Map<number, number>();
  const fromT = toT - windowSec;
  for (const [strike, mins] of by) {
    let d = 0;
    for (const m of mins) if (m.t >= fromT && m.t < toT) d += deltaOf(m);
    out.set(strike, d);
  }
  return out;
}

function pick(deltas: Map<number, number>, spot: number, radius: number, minContracts: number): FlowMagnets {
  let pos: FlowMagnet | null = null;
  let neg: FlowMagnet | null = null;
  for (const [strike, d] of deltas) {
    if (Math.abs(strike - spot) > radius) continue;
    if (d >= minContracts && (!pos || d > pos.fuerza || (d === pos.fuerza && Math.abs(strike - spot) < Math.abs(pos.strike - spot)))) pos = { strike, fuerza: d };
    if (-d >= minContracts && (!neg || -d > neg.fuerza || (-d === neg.fuerza && Math.abs(strike - spot) < Math.abs(neg.strike - spot)))) neg = { strike, fuerza: -d };
  }
  return { pos, neg };
}

/** Imanes de flujo en el momento `toT` (segundos) con el precio `spot`. */
export function flowMagnetsAt(by: Map<number, StrikeMinute[]>, toT: number, spot: number, o: Opts = {}): FlowMagnets {
  const t = FLOW_MAGNET_TUNING;
  return pick(windowDeltas(by, toT, o.windowSec ?? t.windowSec), spot, o.radius ?? t.radiusPts, o.minContracts ?? t.minContracts);
}

/**
 * Dónde estuvo cada imán minuto a minuto entre `fromT` y `toT` (segundos): tramos seguidos en el
 * mismo strike. `spotAt(t)` = precio en ese minuto (null = sin precio, se salta).
 */
export function flowMagnetHistory(
  by: Map<number, StrikeMinute[]>, fromT: number, toT: number, spotAt: (t: number) => number | null, o: Opts = {},
): FlowMagnetSegment[] {
  const tune = FLOW_MAGNET_TUNING;
  const windowSec = o.windowSec ?? tune.windowSec;
  const radius = o.radius ?? tune.radiusPts;
  const minC = o.minContracts ?? tune.minContracts;
  // Delta por strike y minuto, para sumar la ventana deslizándola (sin recorrer todo cada minuto).
  const perMin = new Map<number, Map<number, number>>();
  for (const [strike, mins] of by) perMin.set(strike, new Map(mins.map((m) => [m.t, deltaOf(m)])));
  const run = new Map<number, number>([...perMin.keys()].map((k) => [k, 0]));
  const start0 = Math.floor(fromT / 60) * 60;
  // Arranque: lo que ya está dentro de la ventana del primer minuto evaluado.
  for (const [k, m] of perMin) {
    let s = 0;
    for (const [t, d] of m) if (t >= start0 + 60 - windowSec && t < start0 + 60) s += d;
    run.set(k, s);
  }
  const segs: FlowMagnetSegment[] = [];
  const open: Record<"pos" | "neg", FlowMagnetSegment | null> = { pos: null, neg: null };
  for (let t = start0 + 60; t <= toT; t += 60) {
    if (t > start0 + 60) {
      for (const [k, m] of perMin) run.set(k, (run.get(k) ?? 0) + (m.get(t - 60) ?? 0) - (m.get(t - 60 - windowSec) ?? 0));
    }
    const spot = spotAt(t);
    const cur = spot == null ? { pos: null, neg: null } : pick(run, spot, radius, minC);
    for (const kind of ["pos", "neg"] as const) {
      const mg = cur[kind];
      const o2 = open[kind];
      if (o2 && mg && o2.strike === mg.strike) { o2.end = t; o2.fuerza = Math.max(o2.fuerza, mg.fuerza); continue; }
      if (o2) open[kind] = null;
      if (mg) { const s: FlowMagnetSegment = { kind, strike: mg.strike, start: t, end: t, fuerza: mg.fuerza }; segs.push(s); open[kind] = s; }
    }
  }
  return segs;
}

/**
 * Agrega a los imanes de `now` la tendencia de su fuerza (`prevFuerza` = neto acumulado del mismo
 * strike hasta `toT − lookbackSec`, con el signo del lado) y desde cuándo están fijos (`since`, del
 * tramo vigente del historial). PURA.
 */
export function withMagnetTrend(
  by: Map<number, StrikeMinute[]>, now: FlowMagnets, history: FlowMagnetSegment[], toT: number,
  lookbackSec: number = CUMULATIVE_MAGNET_TUNING.trendLookbackSec,
): FlowMagnets {
  const add = (mg: FlowMagnet | null, kind: "pos" | "neg"): FlowMagnet | null => {
    if (!mg) return null;
    let d = 0;
    for (const m of by.get(mg.strike) ?? []) if (m.t < toT - lookbackSec) d += deltaOf(m);
    const prevFuerza = kind === "pos" ? d : -d;
    // Tramo vigente = el último de ese lado; cuenta si sigue en el mismo strike hasta ~ahora.
    let since: number | undefined;
    for (let i = history.length - 1; i >= 0; i--) {
      const sg = history[i];
      if (sg.kind !== kind) continue;
      if (sg.strike === mg.strike && sg.end >= toT - 120) since = sg.start - 60;
      break;
    }
    return { ...mg, prevFuerza, since };
  };
  return { pos: add(now.pos, "pos"), neg: add(now.neg, "neg") };
}

/**
 * Imán GEX × lado (12-nov-2026, capturas de SofIA SPX/NQ 11:08). En SofIA el número de su columna
 * agresor es el GEX en $M del strike (|agresor| vs su GEX: correlación 0.99) y el imán es el mayor de
 * cada lado. Su lado no se pudo deducir; usamos el que más coincidió con el suyo (64–72%): comprador
 * agresivo vs vendedor agresivo de los últimos 5 min, sin importar call/put (cA + pA − cB − pB).
 * Fuerza = |GEX neto| del strike en millones. PURO.
 */
export const GEX_SIDE_MAGNET_TUNING = {
  windowSec: 300,
  /** Modo noche: $ netos (comprado − vendido de la sesión) mínimos para darle lado a un strike. */
  minSideUsdNight: 10_000,
  /** ±20 pts como SofIA (13-nov: con 75 agarraba el Put Wall a 33 pts como Imán +; el suyo queda pegado al precio). */
  radiusPts: 20,
  /** GEX mínimo (millones de $) para marcar un imán. */
  minGexM: 5,
  /** Contratos agresivos netos mínimos para darle lado a un strike. */
  minSideContracts: 5,
  /**
   * NQ: las opciones del NDX operan ~10× menos que las de SPX (12-nov: con 5 solo 5 strikes tenían
   * lado y el imán caía en strikes de GEX chico); con 1 cae en los de mayor GEX total.
   */
  minSideContractsThin: 1,
};

/** Lado agresivo por strike en (toT − ventana, toT]: >0 compran al ask, <0 venden al bid. */
export function aggressorSides(by: Map<number, StrikeMinute[]>, toT: number, windowSec: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const [strike, mins] of by) {
    let d = 0;
    for (const m of mins) if (m.t >= toT - windowSec && m.t < toT) d += m.cA + m.pA - (m.cB + m.pB);
    out.set(strike, d);
  }
  return out;
}

export function gexSideMagnets(
  gexRows: { strike: number; netGex: number }[], sides: Map<number, number>, spot: number,
  o: { radius?: number; minGexM?: number; minSideContracts?: number } = {},
): FlowMagnets {
  const t = GEX_SIDE_MAGNET_TUNING;
  const radius = o.radius ?? t.radiusPts;
  const minG = o.minGexM ?? t.minGexM;
  const minS = o.minSideContracts ?? t.minSideContracts;
  let pos: FlowMagnet | null = null;
  let neg: FlowMagnet | null = null;
  for (const r of gexRows) {
    if (Math.abs(r.strike - spot) > radius) continue;
    const g = Math.abs(r.netGex) / 1e6;
    if (g < minG) continue;
    const side = sides.get(r.strike) ?? 0;
    if (side >= minS && (!pos || g > pos.fuerza)) pos = { strike: r.strike, fuerza: g, lado: side };
    if (side <= -minS && (!neg || g > neg.fuerza)) neg = { strike: r.strike, fuerza: g, lado: side };
  }
  return { pos, neg };
}

/**
 * GEX del ETF pasado a strikes del índice (NQ: QQQ → NDX), para SUMARLO al GEX propio del NDX: las
 * NDXP tienen poco OI y la exposición real de los dealers al Nasdaq-100 está repartida entre las dos
 * cadenas (mismo criterio que el pre-mercado, que usa QQQ para NQ). Cada strike del ETF × `ratio` (índice ÷ ETF) se suma a la fila del
 * índice más cercana (si cae a ≤ medio paso). El GEX ya está en $ por 1 %, no se reescala. PURO.
 */
export function etfGexToIndex(
  etfGex: Map<number, { netGex: number }>, ratio: number, indexStrikes: number[],
): { strike: number; netGex: number }[] {
  const ks = [...indexStrikes].sort((a, b) => a - b);
  if (ks.length === 0 || !(ratio > 0)) return [];
  let step = Infinity;
  for (let i = 1; i < ks.length; i++) if (ks[i] - ks[i - 1] > 0) step = Math.min(step, ks[i] - ks[i - 1]);
  const half = Number.isFinite(step) ? step / 2 : Infinity;
  const sum = new Map<number, number>(ks.map((k) => [k, 0]));
  for (const [s, g] of etfGex) {
    const px = s * ratio;
    let best = ks[0];
    for (const k of ks) if (Math.abs(k - px) < Math.abs(best - px)) best = k;
    if (Math.abs(best - px) <= half) sum.set(best, (sum.get(best) ?? 0) + g.netGex);
  }
  return ks.map((k) => ({ strike: k, netGex: sum.get(k) ?? 0 }));
}

/** "2.6K", "591". */
export function fmtFuerza(n: number): string {
  const a = Math.abs(n);
  return a >= 1000 ? `${(a / 1000).toFixed(1)}K` : `${Math.round(a)}`;
}
