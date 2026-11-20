// Vista "Prueba" de la escalera (PURO) — prompt de Carlos del 20-nov ("sesión Prueba en Longshore,
// Gamma y Neto"). Misma escalera que Neto, pero la columna de Posicionamiento sale del flujo TRADE POR
// TRADE de MarketSnack (/api/flow_feed) con la fórmula oficial:
//
//   1. Lado del agresor: ≥ ask o más cerca del ask = COMPRA; ≤ bid o más cerca del bid = VENTA; justo
//      en el mid = sin clasificar (no entra).
//   2. Spreads (5 subagentes): patas del mismo vencimiento, mismo tamaño y < 2 s de diferencia →
//      credit put (PISO), credit call (TECHO), iron condor (PISO + TECHO), debit call (OBJ↑),
//      debit put (OBJ↓). El spread cuenta UNA vez en su strike vendido (la pata de protección no suma).
//   3. delta_trade = tamaño × |delta| × 100 × spot × signo (compra call / venta put = +,
//      compra put / venta call = −). En spreads: |delta neto de las patas| con el signo del subagente.
//   4. Factor de apertura: tamaño > OI de apertura o volumen del día > OI → 1.0; si no, 0.5. Un trade
//      del lado contrario sobre el mismo contrato / la misma estructura abierta hoy = CIERRE: resta.
//   5. Posicionamiento(strike) = Σ delta_trade × factor. + = LARGO / alcista, − = CORTO / bajista.
//
// Nada de esto recomienda entrar o salir: solo describe el flujo.

import { bsDelta } from "./blackScholes";

// ───────────────────────── Tipos de entrada ─────────────────────────

/** Trade compacto (lo que guarda el colector de lib/visionFuturaPruebaData.ts). */
export interface PruebaTrade {
  id: number;
  /** ms epoch */
  t: number;
  /** Símbolo OCC, ej. SPXW261120C06900000 */
  sym: string;
  strike: number;
  cp: "C" | "P";
  /** YYYY-MM-DD */
  exp: string;
  price: number;
  bid: number;
  ask: number;
  size: number;
  premium: number;
  spot: number;
  /** Delta de MarketSnack (con signo); 0/NaN = no vino. */
  delta: number;
  iv: number;
  /** OI de apertura del contrato. */
  oi: number;
  /** Volumen acumulado del contrato en el día al momento del trade. */
  vol: number;
}

export type Side = "compra" | "venta";

export type Bucket =
  | "largoCall" | "cortoPut" | "largoPut" | "cortoCall"
  | "creditPut" | "creditCall" | "icPut" | "icCall" | "debitCall" | "debitPut";

export const BUCKETS: Bucket[] = ["largoCall", "cortoPut", "largoPut", "cortoCall", "creditPut", "creditCall", "icPut", "icCall", "debitCall", "debitPut"];
/** Los 4 casos de opciones sueltas. */
export const CASES: Bucket[] = ["largoCall", "cortoPut", "largoPut", "cortoCall"];

export const BUCKET_LABEL: Record<Bucket, string> = {
  largoCall: "Compra de call (largo call)",
  cortoPut: "Venta de put (corto put)",
  largoPut: "Compra de put (largo put)",
  cortoCall: "Venta de call (corto call)",
  creditPut: "Credit put spread",
  creditCall: "Credit call spread",
  icPut: "Iron condor · lado put",
  icCall: "Iron condor · lado call",
  debitCall: "Debit call spread",
  debitPut: "Debit put spread",
};

export type StructureKind = "suelta" | "credit_put" | "credit_call" | "iron_condor" | "debit_call" | "debit_put";

export const SUBAGENT_LABEL: Record<Exclude<StructureKind, "suelta">, string> = {
  credit_put: "Credit Put Spread",
  credit_call: "Credit Call Spread",
  iron_condor: "Iron Condor",
  debit_call: "Debit Call Spread",
  debit_put: "Debit Put Spread",
};

export const PRUEBA_TUNING = {
  /** Patas de un spread (clasificador.py VENTANA_SEG): ≤ 2 s desde la primera pata del grupo. */
  spreadMs: 2000,
  /** Factor cuando no se puede asegurar que sea apertura. */
  maybeCloseFactor: 0.5,
  /** Cambio mínimo de |neto| (relativo) para ENTRANDO / SALIENDO. */
  trendRel: 0.1,
  /** … y también ≥ 2% del strike más grande de la vista (si no, es ruido). */
  trendAbsOfMax: 0.02,
  /** Pisos y techos: solo los que superan el 20% del máximo de la vista. */
  keyMinOfMax: 0.2,
  keyCount: 3,
  gammaPosMult: 1.5,
  enteringMult: 1.25,
  leavingMult: 0.75,
  /** Conflictos: largo y corto ≥ 30% del mayor |neto|, a ≤ 10 pts. */
  conflictOfMax: 0.3,
  conflictPts: 10,
};

// ───────────────────────── Paso 1: lado del agresor ─────────────────────────

/** COMPRA / VENTA según dónde se llenó dentro del bid/ask; null = mid exacto o sin cotización. */
export function aggressorSide(price: number, bid: number, ask: number): Side | null {
  if (!(price > 0) || !(ask > 0) || !(bid >= 0) || ask < bid) return null;
  if (price >= ask) return "compra";
  if (price <= bid) return "venta";
  const dAsk = ask - price;
  const dBid = price - bid;
  if (Math.abs(dAsk - dBid) < 1e-9) return null;
  return dAsk < dBid ? "compra" : "venta";
}

// ───────────────────────── Delta ─────────────────────────

/** Años hasta el vencimiento (cierre 16:00 NY ≈ 21:00 UTC); mínimo 15 min. */
function yearsTo(exp: string, t: number): number {
  const close = Date.parse(`${exp}T21:00:00Z`);
  return Math.max(15 * 60_000, close - t) / (365 * 86_400_000);
}

/** |delta| del trade: la de MarketSnack; si no vino, Black-Scholes con su IV (o 20% si tampoco). */
export function absDelta(tr: PruebaTrade): number {
  if (Number.isFinite(tr.delta) && Math.abs(tr.delta) > 0) return Math.min(1, Math.abs(tr.delta));
  const iv = tr.iv > 0 ? tr.iv : 0.2;
  return Math.abs(bsDelta(tr.spot, tr.strike, yearsTo(tr.exp, tr.t), iv, tr.cp === "C" ? "call" : "put"));
}

/** Delta de la posición del AGRESOR por contrato: compra call / venta put > 0, compra put / venta call < 0. */
function legDelta(tr: PruebaTrade, side: Side): number {
  const d = absDelta(tr);
  const long = side === "compra";
  return tr.cp === "C" ? (long ? d : -d) : (long ? -d : d);
}

/** Factor de apertura (Paso 3.3). */
export function openingFactor(tr: PruebaTrade, tune = PRUEBA_TUNING): number {
  if (tr.oi >= 0 && (tr.size > tr.oi || tr.vol > tr.oi)) return 1;
  return tune.maybeCloseFactor;
}

// ───────────────────────── Paso 2: spreads ─────────────────────────

export interface Leg { tr: PruebaTrade; side: Side }

export interface Structure {
  kind: StructureKind;
  t: number;
  legs: Leg[];
  /** Clave para detectar cierres de la misma estructura (vencimiento + tipo + strikes). */
  key: string;
}

/**
 * `par_vertical` de clasificador.py: 2 patas del mismo tipo, una vendida y una comprada, strikes
 * distintos. Call vendida abajo = credit call (TECHO); call vendida arriba = debit call (OBJ↑);
 * put vendida arriba = credit put (PISO); put vendida abajo = debit put (OBJ↓).
 */
export function verticalKind(legs: Leg[]): Exclude<StructureKind, "suelta" | "iron_condor"> | null {
  if (legs.length !== 2 || legs[0].tr.cp !== legs[1].tr.cp) return null;
  const sold = legs.find((l) => l.side === "venta");
  const bought = legs.find((l) => l.side === "compra");
  if (!sold || !bought || sold.tr.strike === bought.tr.strike) return null;
  if (sold.tr.cp === "C") return sold.tr.strike < bought.tr.strike ? "credit_call" : "debit_call";
  return sold.tr.strike > bought.tr.strike ? "credit_put" : "debit_put";
}

/** `clasificar` de clasificador.py: grupo de 2 = vertical; de 4 = iron condor (2 calls + 2 puts, los dos de crédito). */
export function classifyGroup(g: Leg[]): StructureKind | null {
  if (g.length === 2) return verticalKind(g);
  if (g.length !== 4) return null;
  const calls = g.filter((l) => l.tr.cp === "C");
  const puts = g.filter((l) => l.tr.cp === "P");
  if (calls.length === 2 && puts.length === 2 && verticalKind(calls) === "credit_call" && verticalKind(puts) === "credit_put") return "iron_condor";
  return null;
}

/**
 * Paso 2 = la lógica de clasificador.py (Carlos, 20-nov), portada tal cual:
 *   agrupar: patas con el mismo vencimiento y el mismo tamaño, dentro de 2 s CONTANDO DESDE LA PRIMERA
 *   pata del grupo (≤ 2 s); un trade fuera de la ventana cierra el grupo y abre otro.
 *   Solo los grupos de 2 o 4 patas pueden ser spread; `clasificar` decide cuál.
 * Todo lo que no salga como spread (grupos de 1, 3, 5+ patas o estructuras raras) se trata como opciones
 * sueltas (regla del prompt). El "ticker" del script es el subyacente: aquí todo es SPX.
 * Recibe SOLO trades clasificados (con lado): el script también descarta los del mid.
 */
export function groupStructures(legs: Leg[], tune = PRUEBA_TUNING): Structure[] {
  const sorted = [...legs].sort((a, b) => a.tr.t - b.tr.t || a.tr.id - b.tr.id);
  const groups: Leg[][] = [];
  const open = new Map<string, Leg[]>();
  for (const l of sorted) {
    const k = `${l.tr.exp}|${l.tr.size}`;
    const g = open.get(k);
    if (g && l.tr.t - g[0].tr.t <= tune.spreadMs) g.push(l);
    else {
      if (g) groups.push(g);
      open.set(k, [l]);
    }
  }
  groups.push(...open.values());
  const out: Structure[] = [];
  for (const g of groups) {
    const kind = classifyGroup(g);
    if (kind) {
      // Iron condor: patas de put primero y luego las de call (como el script: piso y techo).
      const legsOrdered = kind === "iron_condor" ? [...g.filter((l) => l.tr.cp === "P"), ...g.filter((l) => l.tr.cp === "C")] : g;
      out.push({ kind, t: g[0].tr.t, legs: legsOrdered, key: "" });
    } else {
      for (const l of g) out.push({ kind: "suelta", t: l.tr.t, legs: [l], key: "" });
    }
  }
  for (const s of out) s.key = structureKey(s);
  return out.sort((a, b) => a.t - b.t);
}

/** Vencimiento + tipo(s) + strikes ordenados: la misma estructura vista desde los dos lados. */
function structureKey(s: Structure): string {
  if (s.kind === "suelta") return s.legs[0].tr.sym;
  const parts = s.legs.map((l) => `${l.tr.cp}${l.tr.strike}`).sort();
  return `${s.legs[0].tr.exp}|${parts.join(",")}`;
}

// ───────────────────────── Paso 3: contribuciones ─────────────────────────

interface Contribution {
  strike: number;
  bucket: Bucket;
  /** $ delta con signo. */
  delta: number;
  factor: number;
  subagent: StructureKind;
}

/** A qué strike/bucket va cada estructura y con cuánto delta (sin factor). */
export function contributionsOf(s: Structure): Contribution[] {
  const notional = (l: Leg) => l.tr.size * 100 * l.tr.spot;
  if (s.kind === "suelta") {
    const l = s.legs[0];
    const d = legDelta(l.tr, l.side) * notional(l);
    const bucket: Bucket = l.tr.cp === "C" ? (l.side === "compra" ? "largoCall" : "cortoCall") : (l.side === "compra" ? "largoPut" : "cortoPut");
    return [{ strike: l.tr.strike, bucket, delta: d, factor: openingFactor(l.tr), subagent: "suelta" }];
  }
  const vertical = (legs: Leg[], bucket: Bucket, sign: 1 | -1): Contribution => {
    const sold = legs.find((l) => l.side === "venta")!;
    const net = legs.reduce((acc, l) => acc + legDelta(l.tr, l.side) * notional(l), 0);
    return { strike: sold.tr.strike, bucket, delta: sign * Math.abs(net), factor: openingFactor(sold.tr), subagent: s.kind };
  };
  switch (s.kind) {
    case "credit_put": return [vertical(s.legs, "creditPut", 1)];
    case "credit_call": return [vertical(s.legs, "creditCall", -1)];
    case "debit_call": return [vertical(s.legs, "debitCall", 1)];
    case "debit_put": return [vertical(s.legs, "debitPut", -1)];
    case "iron_condor": return [
      vertical(s.legs.filter((l) => l.tr.cp === "P"), "icPut", 1),
      vertical(s.legs.filter((l) => l.tr.cp === "C"), "icCall", -1),
    ];
  }
}

/** Dirección de apertura de la estructura: para saber si otra igual del lado contrario la cierra. */
function directionOf(s: Structure): string {
  return `${s.legs[0].tr.exp}|${s.legs.map((l) => `${l.tr.cp}${l.tr.strike}${l.side === "compra" ? "+" : "-"}`).sort().join(",")}`;
}
function flipped(s: Structure): string {
  return `${s.legs[0].tr.exp}|${s.legs.map((l) => `${l.tr.cp}${l.tr.strike}${l.side === "compra" ? "-" : "+"}`).sort().join(",")}`;
}

// ───────────────────────── Paso 3.4: posicionamiento por strike ─────────────────────────

export interface StrikePos {
  strike: number;
  net: number;
  buckets: Record<Bucket, number>;
  trades: number;
  /** Σ delta × factor / Σ delta de las aperturas (0–1). */
  openShare: number;
  /** Cierres detectados (trades que restaron). */
  closes: number;
}

export interface PositionResult {
  byStrike: Map<number, StrikePos>;
  /** Trades al mid (no clasificados) dentro de la ventana. */
  unclassified: number;
  classified: number;
  /** Totales por subagente en la ventana ($ delta con signo). */
  bySubagent: Record<StructureKind, number>;
  structures: Record<StructureKind, number>;
}

const emptyBuckets = (): Record<Bucket, number> => Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
const emptyKinds = (): Record<StructureKind, number> => ({ suelta: 0, credit_put: 0, credit_call: 0, iron_condor: 0, debit_call: 0, debit_put: 0 });

/** Trades → estructuras, una sola vez por lote (las ventanas reusan esto). */
export function prepare(trades: PruebaTrade[]): { structures: Structure[]; mids: number[] } {
  const legs: Leg[] = [];
  const mids: number[] = [];
  for (const tr of trades) {
    const side = aggressorSide(tr.price, tr.bid, tr.ask);
    if (side) legs.push({ tr, side }); else mids.push(tr.t);
  }
  return { structures: groupStructures(legs), mids };
}

/**
 * Posicionamiento en la ventana (from, to]. Recorre TODO lo anterior a `to` en orden para saber qué se
 * abrió hoy (y poder detectar cierres), pero solo suma lo que pasó dentro de la ventana.
 */
export function positionWindow(prep: { structures: Structure[]; mids: number[] }, from: number, to: number): PositionResult {
  const byStrike = new Map<number, StrikePos>();
  const openGross = new Map<number, number>(); // strike → Σ |delta| de aperturas en la ventana
  const openWeighted = new Map<number, number>();
  // Lo abierto hoy por dirección de estructura: dirección → [{strike, bucket, restante (con signo)}]
  const opened = new Map<string, { strike: number; bucket: Bucket; left: number }[]>();
  const bySubagent = emptyKinds();
  const structures = emptyKinds();
  let classified = 0;
  const get = (k: number) => {
    let p = byStrike.get(k);
    if (!p) { p = { strike: k, net: 0, buckets: emptyBuckets(), trades: 0, openShare: 0, closes: 0 }; byStrike.set(k, p); }
    return p;
  };
  for (const s of prep.structures) {
    if (s.t > to) break;
    const inWin = s.t > from;
    if (inWin) { classified += s.legs.length; structures[s.kind] += 1; }
    const contribs = contributionsOf(s);
    // ¿Cierra algo abierto hoy en la dirección contraria?
    const against = opened.get(flipped(s));
    const closedBy: number[] = contribs.map(() => 0);
    if (against && against.length) {
      contribs.forEach((c, ci) => {
        let want = Math.abs(c.delta);
        for (const o of against) {
          if (want <= 0) break;
          if (o.left === 0) continue;
          const take = Math.min(want, Math.abs(o.left));
          const sign = Math.sign(o.left);
          o.left -= sign * take;
          want -= take;
          closedBy[ci] += take;
          if (inWin) {
            const p = get(o.strike);
            p.buckets[o.bucket] -= sign * take;
            p.closes += 1;
            p.trades += 1;
            bySubagent[s.kind] -= sign * take;
          }
        }
      });
    }
    // Lo que no cerró nada es apertura (con su factor).
    const dir = directionOf(s);
    contribs.forEach((c, ci) => {
      const rest = Math.abs(c.delta) - closedBy[ci];
      if (rest <= 1e-9) return;
      const signed = Math.sign(c.delta) * rest * c.factor;
      const list = opened.get(dir) ?? [];
      list.push({ strike: c.strike, bucket: c.bucket, left: signed });
      opened.set(dir, list);
      if (!inWin) return;
      const p = get(c.strike);
      p.buckets[c.bucket] += signed;
      p.trades += 1;
      bySubagent[s.kind] += signed;
      openGross.set(c.strike, (openGross.get(c.strike) ?? 0) + rest);
      openWeighted.set(c.strike, (openWeighted.get(c.strike) ?? 0) + rest * c.factor);
    });
  }
  for (const p of byStrike.values()) {
    p.net = BUCKETS.reduce((acc, b) => acc + p.buckets[b], 0);
    const g = openGross.get(p.strike) ?? 0;
    p.openShare = g > 0 ? (openWeighted.get(p.strike) ?? 0) / g : 0;
  }
  const unclassified = prep.mids.filter((t) => t > from && t <= to).length;
  return { byStrike, unclassified, classified, bySubagent, structures };
}

// ───────────────────────── Intervalos ─────────────────────────

export type PruebaWindow = 5 | 15 | 30 | 60 | "1D";
export const PRUEBA_WINDOWS: PruebaWindow[] = [5, 15, 30, 60, "1D"];
export const windowLabel = (w: PruebaWindow) => (w === "1D" ? "1D" : w === 60 ? "1h" : `${w}m`);
/** En 1D la "ventana anterior" es el día hasta hace 15 min (no hay otro día igual con qué comparar). */
export const DAY_PREV_MS = 15 * 60_000;

/** Ventana actual y anterior del mismo tamaño. */
export function windowBounds(w: PruebaWindow, now: number, dayStart: number): { cur: [number, number]; prev: [number, number] } {
  if (w === "1D") return { cur: [dayStart, now], prev: [dayStart, now - DAY_PREV_MS] };
  const ms = w * 60_000;
  return { cur: [now - ms, now], prev: [now - 2 * ms, now - ms] };
}

// ───────────────────────── Escalera: barras, tendencia, pisos/techos, imanes ─────────────────────────

export type Trend = "entrando" | "saliendo" | "igual";

export type BaseLabel = "LARGO CALL" | "CORTO PUT" | "LARGO PUT" | "CORTO CALL" | "PISO" | "TECHO" | "OBJ↑" | "OBJ↓";
/** "CIERRE …" = en la ventana pesan más los cierres de esas posiciones que las aperturas. */
export type DominantLabel = BaseLabel | `CIERRE ${BaseLabel}`;

/** Signo natural de cada grupo al abrir (+ alcista, − bajista). */
const GROUPS: [BaseLabel, Bucket[], 1 | -1][] = [
  ["LARGO CALL", ["largoCall"], 1],
  ["CORTO PUT", ["cortoPut"], 1],
  ["LARGO PUT", ["largoPut"], -1],
  ["CORTO CALL", ["cortoCall"], -1],
  ["PISO", ["creditPut", "icPut"], 1],
  ["TECHO", ["creditCall", "icCall"], -1],
  ["OBJ↑", ["debitCall"], 1],
  ["OBJ↓", ["debitPut"], -1],
];

/** Etiqueta del caso que más pesa en el strike; si su neto va al revés de su signo natural, es CIERRE. */
export function dominantOf(b: Record<Bucket, number>): DominantLabel | null {
  let best: { label: DominantLabel; abs: number } | null = null;
  for (const [label, keys, sign] of GROUPS) {
    const v = keys.reduce((a, k) => a + b[k], 0);
    const abs = Math.abs(v);
    if (abs <= 0 || (best && abs <= best.abs)) continue;
    best = { label: Math.sign(v) === sign ? label : `CIERRE ${label}`, abs };
  }
  return best ? best.label : null;
}

/** true si el bucket va al revés de su signo natural (pesan más los cierres). */
export function isClosing(k: Bucket, v: number): boolean {
  const g = GROUPS.find((x) => x[1].includes(k));
  return !!g && v !== 0 && Math.sign(v) !== g[2];
}

export function trendOf(cur: number, prev: number, maxAbs: number, tune = PRUEBA_TUNING): Trend {
  const a = Math.abs(cur), p = Math.abs(prev);
  const minAbs = maxAbs * tune.trendAbsOfMax;
  if (a > p * (1 + tune.trendRel) && a - p >= minAbs) return "entrando";
  if (a < p * (1 - tune.trendRel) && p - a >= minAbs) return "saliendo";
  return "igual";
}

export interface PruebaBar {
  strike: number;
  net: number;
  prevNet: number;
  trend: Trend;
  dominant: DominantLabel | null;
  buckets: Record<Bucket, number>;
  trades: number;
  openShare: number;
  closes: number;
  /** |neto| / mayor |neto| de la vista (0–1). */
  frac: number;
  defensePiso: number;
  defenseTecho: number;
}

export interface KeyLevel { strike: number; kind: "techo" | "piso"; rank: number; score: number }
export interface PruebaMagnet { strike: number; kind: "pos" | "neg"; score: number; distPts: number; distPct: number; why: string }

export interface PruebaLadder {
  bars: PruebaBar[];
  techos: KeyLevel[];
  pisos: KeyLevel[];
  magnetPos: PruebaMagnet | null;
  magnetNeg: PruebaMagnet | null;
}

const sumAbs = (b: Record<Bucket, number>, keys: Bucket[]) => keys.reduce((a, k) => a + Math.abs(b[k]), 0);

/**
 * Arma la escalera para los strikes a la vista: barras, tendencia, defensa, pisos/techos clave e imanes.
 * `gexBy` = GEX neto por strike (columna Gamma); `strikes` = filas a la vista.
 */
export function buildLadder(
  cur: Map<number, StrikePos>,
  prev: Map<number, StrikePos>,
  strikes: number[],
  gexBy: Map<number, number>,
  spot: number,
  tune = PRUEBA_TUNING,
): PruebaLadder {
  const step = strikes.length > 1 ? Math.min(...strikes.slice(1).map((s, i) => Math.abs(s - strikes[i])).filter((d) => d > 0)) || 5 : 5;
  const inView = (k: number) => strikes.some((s) => Math.abs(s - k) < step / 2);
  const ks = [...new Set([...cur.keys(), ...prev.keys()])].filter(inView);
  const maxAbs = Math.max(0, ...ks.map((k) => Math.abs(cur.get(k)?.net ?? 0)));
  const bars: PruebaBar[] = ks.map((k) => {
    const c = cur.get(k);
    const p = prev.get(k);
    const net = c?.net ?? 0;
    const prevNet = p?.net ?? 0;
    const buckets = c?.buckets ?? emptyBuckets();
    const trend = trendOf(net, prevNet, maxAbs, tune);
    const g = gexBy.get(k) ?? 0;
    const mult = (g > 0 ? tune.gammaPosMult : 1) * (trend === "entrando" ? tune.enteringMult : trend === "saliendo" ? tune.leavingMult : 1);
    return {
      strike: k, net, prevNet, trend, dominant: dominantOf(buckets), buckets,
      trades: c?.trades ?? 0, openShare: c?.openShare ?? 0, closes: c?.closes ?? 0,
      frac: maxAbs > 0 ? Math.abs(net) / maxAbs : 0,
      defensePiso: sumAbs(buckets, ["cortoPut", "creditPut", "icPut"]) * mult,
      defenseTecho: sumAbs(buckets, ["cortoCall", "creditCall", "icCall"]) * mult,
    };
  }).sort((a, b) => b.strike - a.strike);

  // Pisos / techos clave: el strike del spot puede ser los dos. El 20% se mide contra el mayor de los
  // candidatos de ese lado (techos arriba del spot, pisos abajo): un corto put enorme ARRIBA del spot no
  // puede ser piso y no debe borrar a los pisos de verdad.
  const upC = bars.filter((b) => b.strike > spot - step / 2 && b.defenseTecho > 0);
  const dnC = bars.filter((b) => b.strike < spot + step / 2 && b.defensePiso > 0);
  const floorT = Math.max(0, ...upC.map((b) => b.defenseTecho)) * tune.keyMinOfMax;
  const floorP = Math.max(0, ...dnC.map((b) => b.defensePiso)) * tune.keyMinOfMax;
  const techos = upC
    .filter((b) => b.defenseTecho >= floorT)
    .sort((a, b) => b.defenseTecho - a.defenseTecho).slice(0, tune.keyCount)
    .map((b, i): KeyLevel => ({ strike: b.strike, kind: "techo", rank: i + 1, score: b.defenseTecho }));
  const pisos = dnC
    .filter((b) => b.defensePiso >= floorP)
    .sort((a, b) => b.defensePiso - a.defensePiso).slice(0, tune.keyCount)
    .map((b, i): KeyLevel => ({ strike: b.strike, kind: "piso", rank: i + 1, score: b.defensePiso }));

  // Imán + : objetivos de débito + largos direccionales, × gamma + y × entrando.
  let magnetPos: PruebaMagnet | null = null;
  for (const b of bars) {
    const base = sumAbs(b.buckets, ["debitCall", "debitPut", "largoCall", "largoPut"]);
    if (base <= 0) continue;
    const g = gexBy.get(b.strike) ?? 0;
    const score = base * (g > 0 ? tune.gammaPosMult : 1) * (b.trend === "entrando" ? tune.enteringMult : 1);
    if (!magnetPos || score > magnetPos.score) {
      const deb = sumAbs(b.buckets, ["debitCall", "debitPut"]);
      magnetPos = { strike: b.strike, kind: "pos", score, ...dist(b.strike, spot), why: deb >= base / 2 ? "objetivos de débito" : "largos direccionales" };
    }
  }
  // Imán − : el piso o techo clave con más defensa.
  const keys = [...techos, ...pisos].sort((a, b) => b.score - a.score);
  const magnetNeg: PruebaMagnet | null = keys[0]
    ? { strike: keys[0].strike, kind: "neg", score: keys[0].score, ...dist(keys[0].strike, spot), why: keys[0].kind === "techo" ? "techo clave" : "piso clave" }
    : null;
  return { bars, techos, pisos, magnetPos, magnetNeg };
}

const dist = (k: number, spot: number) => ({ distPts: k - spot, distPct: spot > 0 ? ((k - spot) / spot) * 100 : 0 });

// ───────────────────────── Panel de resumen ─────────────────────────

export interface Conflict { long: number; short: number; longAmt: number; shortAmt: number }

/** Largos y cortos grandes en el mismo strike o a ≤ 10 pts. */
export function findConflicts(bars: PruebaBar[], tune = PRUEBA_TUNING): Conflict[] {
  const maxAbs = Math.max(0, ...bars.map((b) => Math.abs(b.net)));
  if (maxAbs <= 0) return [];
  const longOf = (b: PruebaBar) => BUCKETS.reduce((a, k) => a + Math.max(0, b.buckets[k]), 0);
  const shortOf = (b: PruebaBar) => BUCKETS.reduce((a, k) => a + Math.max(0, -b.buckets[k]), 0);
  const min = maxAbs * tune.conflictOfMax;
  const out: Conflict[] = [];
  for (const a of bars) {
    const la = longOf(a);
    if (la < min) continue;
    for (const b of bars) {
      if (Math.abs(a.strike - b.strike) > tune.conflictPts) continue;
      const sb = shortOf(b);
      if (sb < min) continue;
      out.push({ long: a.strike, short: b.strike, longAmt: la, shortAmt: sb });
    }
  }
  return out.sort((x, y) => Math.min(y.longAmt, y.shortAmt) - Math.min(x.longAmt, x.shortAmt)).slice(0, 3);
}

// ───────────────────────── Respuesta de /api/vision-futura/prueba ─────────────────────────

export interface PruebaAgg { strike: number; buy: number; sell: number; prevBuy: number; prevSell: number }

export interface PruebaResponse {
  inst: string;
  date: string;
  window: PruebaWindow;
  asOf: number;
  cur: StrikePos[];
  prev: StrikePos[];
  unclassified: number;
  classified: number;
  bySubagent: Record<StructureKind, number>;
  prevBySubagent: Record<StructureKind, number>;
  structures: Record<StructureKind, number>;
  agg: PruebaAgg[];
  /** Ventana actual [desde, hasta] y anterior (ms). */
  bounds: { cur: [number, number]; prev: [number, number] };
  coveredFrom: number;
  segmentsDone: number;
  segmentsTotal: number;
  tradesTotal: number;
  lastTradeT: number | null;
  minPremium: number;
  cookieExpired: boolean;
  error: string | null;
}

/** Σ por bucket de todos los strikes de la vista. */
export function totalsByBucket(m: Map<number, StrikePos>, strikes?: Set<number>): Record<Bucket, number> {
  const t = emptyBuckets();
  for (const p of m.values()) {
    if (strikes && !strikes.has(p.strike)) continue;
    for (const b of BUCKETS) t[b] += p.buckets[b];
  }
  return t;
}
