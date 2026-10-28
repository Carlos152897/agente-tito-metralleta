// "Lottos al cierre" de VisionFutura (Carlos, 23-oct-2026): opciones 0DTE baratas y fuera del
// dinero que se compran en la última hora, apostando a un movimiento brusco hacia un nivel.
// PURO: sin red ni disco. Lo usan la vista en vivo, la repetición y el backtest.
//
// Regla v1 (explícita, para medirla con la bitácora diaria):
//   Lecturas 15:00, 15:15, 15:30 y 15:45 NY. Objetivos = Magneto, imanes ±, max pain, call/put wall.
//   Obligatoria: el objetivo está "al alcance" = a ≤ 1.5 σ del movimiento que queda hasta las 16:00
//   y a ≥ 5 pts (si no, es ATM). σ sale del STRADDLE ATM real (call + put en el dinero ≈ 0.8 σ):
//   el VIX sobrestima mucho la última hora (23-oct: IV real de los 0DTE 9–12% con VIX 19.7).
//   Sin straddle cotizado, σ = spot × VIX × √(minutos ÷ minutos bursátiles del año) (marcado).
//   Confirmaciones (≥ 2 de 3): GEX neto negativo (los dealers aceleran) · momentum de 15 min hacia
//   el objetivo (≥ 3 pts) · flujo de 15 min hacia el objetivo (calls − puts, net premium ≥ $250K).
//   Contrato: call (objetivo arriba) o put (abajo) fuera del dinero, con el strike ANTES del objetivo,
//   prima real entre $0.05 y $1.00; se elige el que más paga si llega: (objetivo − strike) ÷ prima ≥ 3.
//   Salida (v2, Carlos 27-oct-2026: "hagamos la regla de salida del lotto"): se compran 2 contratos;
//   uno se vende cuando el bid llega a 1.5× la prima y el otro a 3×; lo que no se venda se sostiene
//   al vencimiento. Medido con los 4 lottos reales (26–27-oct SPX, 23-oct TSLA): −$290 sosteniendo
//   todo vs +$112 con esta regla (todos llegaron a ≥1.5× y vencieron fuera del dinero).
//   El resultado ($) se expresa POR CONTRATO (promedio de los 2) para compararlo con la regla vieja.

import type { KeyLevel, KeyLevelKind } from "./visionFutura";

export const LOTTO_TUNING = {
  lecturas: ["15:00", "15:15", "15:30", "15:45"] as const,
  targets: ["magneto", "iman_positivo", "iman_negativo", "max_pain", "resistencia", "piso"] as KeyLevelKind[],
  minPrice: 0.05,
  maxPrice: 1.0,
  /** Distancia mínima al objetivo (pts de SPX, se escala por instrumento). */
  minDistPts: 5,
  /** Alcance: múltiplo de la σ que queda hasta el cierre. */
  reachSigma: 1.5,
  /** Lo que paga si llega al objetivo ÷ prima. */
  minPayoff: 3,
  minScore: 2,
  /** Momentum mínimo en 15 min (pts de SPX, escalado). */
  momentumPts: 3,
  /** Flujo mínimo en 15 min (net premium de calls − puts). */
  flowMinUsd: 250_000,
  /** Salida: cada tramo vende `frac` del lotto cuando el bid llega a `mult` × la prima. */
  exits: [{ mult: 1.5, frac: 0.5 }, { mult: 3, frac: 0.5 }] as { mult: number; frac: number }[],
};

const MIN_PER_YEAR = 252 * 390;

export interface LottoQuote {
  type: "call" | "put";
  strike: number;
  bid: number | null;
  ask: number | null;
  /** Precio de un llenado real (o cotización en vivo); false = estimado. */
  real?: boolean;
}

export interface LottoCondition { label: string; ok: boolean; detail: string }

export interface LottoIdea {
  side: "call" | "put";
  target: { label: string; spx: number; kind: KeyLevelKind };
  distance: number;
  reach: number;
  strike: number | null;
  price: number | null;
  priceReal: boolean;
  /** Valor del contrato si el precio llega exacto al objetivo, en veces la prima. */
  payoff: number | null;
  conditions: LottoCondition[];
  score: number;
  fires: boolean;
  blocked: string | null;
}

export interface LottoInput {
  now: number;
  spot: number;
  keyLevels: KeyLevel[];
  regime: "positivo" | "negativo" | null;
  vix: number | null;
  /** Precio de hace 15 min (null si no hay). */
  priceAgo15: number | null;
  /** Cambio en 15 min de Σ net premium de calls − Σ net premium de puts (positivo = alcista). */
  flowChange15: number | null;
  quotes: LottoQuote[];
  scale?: number;
}

/** Minutos que faltan para las 16:00 NY (0 después del cierre). */
export function minutesToClose(ms: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", second: "numeric", hour12: false }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Math.max(0, 16 * 60 - ((g("hour") % 24) * 60 + g("minute") + g("second") / 60));
}

/** Hora NY "HH:MM" de un ms. */
export function nyHm(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
}

/** Straddle ATM (medio de call + put del strike más cercano con las dos patas cotizadas). */
export function atmStraddle(quotes: LottoQuote[], spot: number): { strike: number; price: number } | null {
  const mid = (q?: LottoQuote) => (q && q.ask != null && q.ask > 0 ? (q.bid != null && q.bid > 0 ? (q.bid + q.ask) / 2 : q.ask) : null);
  const strikes = [...new Set(quotes.map((q) => q.strike))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot));
  for (const k of strikes.slice(0, 3)) {
    const c = mid(quotes.find((q) => q.type === "call" && q.strike === k));
    const p = mid(quotes.find((q) => q.type === "put" && q.strike === k));
    if (c != null && p != null) return { strike: k, price: Math.round((c + p) * 100) / 100 };
  }
  return null;
}

export function evaluateLottos(input: LottoInput, t = LOTTO_TUNING): LottoIdea[] {
  const scale = input.scale ?? 1;
  const vix = input.vix && input.vix > 0 ? input.vix : 18;
  const straddle = atmStraddle(input.quotes, input.spot);
  const sigma = straddle ? straddle.price / 0.8 : input.spot * (vix / 100) * Math.sqrt(minutesToClose(input.now) / MIN_PER_YEAR);
  const sigmaSrc = straddle ? `straddle ATM ${straddle.strike} $${straddle.price.toFixed(2)}` : "VIX (sin straddle)";
  const reach = t.reachSigma * sigma;
  const seen = new Set<number>();
  const ideas: LottoIdea[] = [];
  for (const kind of t.targets) {
    for (const lv of input.keyLevels.filter((k) => k.kind === kind)) {
      if (seen.has(lv.spx)) continue;
      seen.add(lv.spx);
      const d = lv.spx - input.spot;
      if (Math.abs(d) < t.minDistPts * scale) continue;
      const side = d > 0 ? "call" : "put";
      const dir = d > 0 ? 1 : -1;
      const mom = input.priceAgo15 != null ? (input.spot - input.priceAgo15) * dir : null;
      const flow = input.flowChange15 != null ? input.flowChange15 * dir : null;
      const conds: LottoCondition[] = [
        { label: "Al alcance", ok: Math.abs(d) <= reach, detail: `a ${Math.abs(d).toFixed(1)} pts · alcance ±${reach.toFixed(1)} (1.5σ, ${sigmaSrc})` },
        { label: "GEX negativo", ok: input.regime === "negativo", detail: input.regime === "negativo" ? "los dealers aceleran el movimiento" : input.regime === "positivo" ? "GEX positivo: amortigua" : "sin dato" },
        { label: "Momentum 15 min", ok: mom != null && mom >= t.momentumPts * scale, detail: mom == null ? "sin precio de hace 15 min" : `${mom >= 0 ? "+" : ""}${mom.toFixed(1)} pts hacia el objetivo` },
        { label: "Flujo 15 min", ok: flow != null && flow >= t.flowMinUsd, detail: flow == null ? "sin flujo de hace 15 min" : `${flow >= 0 ? "+" : "−"}$${(Math.abs(flow) / 1e6).toFixed(2)}M ${side === "call" ? "calls − puts" : "puts − calls"}` },
      ];
      const score = conds.slice(1).filter((c) => c.ok).length;
      // Contrato: fuera del dinero y antes del objetivo; el que más paga si llega.
      let best: { strike: number; price: number; payoff: number; real: boolean } | null = null;
      for (const q of input.quotes) {
        if (q.type !== side || q.ask == null) continue;
        const otm = side === "call" ? q.strike > input.spot : q.strike < input.spot;
        const before = side === "call" ? q.strike < lv.spx : q.strike > lv.spx;
        if (!otm || !before || q.ask < t.minPrice || q.ask > t.maxPrice) continue;
        const payoff = Math.abs(lv.spx - q.strike) / q.ask;
        if (!best || payoff > best.payoff) best = { strike: q.strike, price: q.ask, payoff, real: q.real !== false };
      }
      const reachOk = conds[0].ok;
      const blocked = !reachOk ? "objetivo fuera de alcance"
        : score < t.minScore ? `faltan confirmaciones (${score}/3)`
        : !best ? `sin contrato de $${t.minPrice.toFixed(2)}–$${t.maxPrice.toFixed(2)} antes del objetivo`
        : best.payoff < t.minPayoff ? `paga solo ${best.payoff.toFixed(1)}× si llega (mín ${t.minPayoff}×)`
        : null;
      ideas.push({
        side, target: { label: lv.label, spx: lv.spx, kind: lv.kind }, distance: Math.round(d * 100) / 100, reach: Math.round(reach * 100) / 100,
        strike: best?.strike ?? null, price: best?.price ?? null, priceReal: best?.real ?? false,
        payoff: best ? Math.round(best.payoff * 10) / 10 : null,
        conditions: conds, score, fires: blocked == null, blocked,
      });
    }
  }
  return ideas.sort((a, b) => Number(b.fires) - Number(a.fires) || Number(b.conditions[0].ok) - Number(a.conditions[0].ok) || b.score - a.score || (b.payoff ?? 0) - (a.payoff ?? 0));
}

export interface LottoTrade {
  id: string;
  /** ms de la lectura. */
  openedAt: number;
  lectura: string;
  side: "call" | "put";
  strike: number;
  price: number;
  priceReal: boolean;
  target: { label: string; spx: number };
  spotAtOpen: number;
  payoff: number | null;
  conditions: LottoCondition[];
  /** Mejor precio de venta posterior (llenado real al bid) y a qué hora; null si no hay datos. */
  bestExit: { price: number; at: number } | null;
  settle: number | null;
  /** Resultado por contrato en $ con la regla de salida (ventas en 1.5× / 3× + lo que quedó al vencimiento). */
  pnlUsd: number | null;
  /** Ventas hechas por la regla de salida (tramo, precio, hora). */
  exits?: LottoExit[];
  /** Lo que habría dado sostener todo al vencimiento (regla vieja), por contrato. */
  holdPnlUsd?: number | null;
}

export interface LottoExit {
  mult: number;
  frac: number;
  price: number;
  at: number;
}

/**
 * Ventas de la regla de salida sobre una serie de bids posteriores a la compra (en vivo: bid de cada
 * refresco; en la repetición: promedio real de llenado al bid de cada bloque de 5 min). Cada tramo
 * vende al precio objetivo (mult × prima) la primera vez que el bid lo alcanza.
 */
export function lottoExitsFrom(t: Pick<LottoTrade, "price" | "openedAt">, bids: { at: number; bid: number }[], tune = LOTTO_TUNING): LottoExit[] {
  const out: LottoExit[] = [];
  const path = [...bids].filter((b) => b.at > t.openedAt && b.bid > 0).sort((a, b) => a.at - b.at);
  for (const e of tune.exits) {
    const goal = Math.round(e.mult * t.price * 100) / 100;
    const hit = path.find((b) => b.bid >= goal);
    if (hit) out.push({ mult: e.mult, frac: e.frac, price: goal, at: hit.at });
  }
  return out;
}

/** Salidas aproximadas cuando solo se sabe la mejor venta (repeticiones viejas): todo tramo ≤ mejor venta se vendió. */
export function lottoExitsFromBest(t: Pick<LottoTrade, "price" | "bestExit">, tune = LOTTO_TUNING): LottoExit[] {
  if (!t.bestExit) return [];
  return tune.exits
    .filter((e) => t.bestExit!.price >= Math.round(e.mult * t.price * 100) / 100)
    .map((e) => ({ mult: e.mult, frac: e.frac, price: Math.round(e.mult * t.price * 100) / 100, at: t.bestExit!.at }));
}

/** Resultado por contrato con la regla: lo vendido en los tramos + lo que quedó al vencimiento. */
export function lottoPnlWithExits(t: Pick<LottoTrade, "side" | "strike" | "price">, exits: LottoExit[], settle: number | null): number | null {
  const sold = exits.reduce((a, e) => a + e.frac, 0);
  const left = Math.max(0, 1 - sold);
  if (left > 1e-9 && settle == null) return null;
  const intr = settle == null ? 0 : t.side === "call" ? Math.max(0, settle - t.strike) : Math.max(0, t.strike - settle);
  const value = exits.reduce((a, e) => a + e.frac * e.price, 0) + left * intr;
  return Math.round((value - t.price) * 100);
}

/** Aplica la regla a un lotto ya liquidado (o con mejor venta conocida): rellena exits, pnlUsd y holdPnlUsd. */
export function settleLottoWithRule(t: LottoTrade, exits?: LottoExit[]): LottoTrade {
  const ex = exits ?? t.exits ?? lottoExitsFromBest(t);
  const hold = t.settle != null ? lottoPnlAtExpiry(t, t.settle) : null;
  return { ...t, exits: ex, holdPnlUsd: hold, pnlUsd: lottoPnlWithExits(t, ex, t.settle) };
}

export function lottoTradeFrom(idea: LottoIdea, now: number, spot: number): LottoTrade | null {
  if (!idea.fires || idea.strike == null || idea.price == null) return null;
  return {
    id: `${nyHm(now)}:${idea.side}:${idea.strike}`, openedAt: now, lectura: nyHm(now), side: idea.side, strike: idea.strike,
    price: idea.price, priceReal: idea.priceReal, target: { label: idea.target.label, spx: idea.target.spx }, spotAtOpen: spot,
    payoff: idea.payoff, conditions: idea.conditions, bestExit: null, settle: null, pnlUsd: null,
  };
}

/** Resultado al vencimiento de un lotto (1 contrato, $100 por punto). */
export function lottoPnlAtExpiry(t: Pick<LottoTrade, "side" | "strike" | "price">, settle: number): number {
  const intr = t.side === "call" ? Math.max(0, settle - t.strike) : Math.max(0, t.strike - settle);
  return Math.round((intr - t.price) * 100);
}

/** ¿Toca leer ahora? Devuelve la lectura ("15:00"…) si `ms` cae en sus primeros `graceMin` minutos. */
export function lecturaAt(ms: number, graceMin = 5, t = LOTTO_TUNING): string | null {
  const left = minutesToClose(ms);
  const nowMin = 16 * 60 - left;
  for (const l of t.lecturas) {
    const [h, m] = l.split(":").map(Number);
    const lm = h * 60 + m;
    if (nowMin >= lm && nowMin < lm + graceMin) return l;
  }
  return null;
}
