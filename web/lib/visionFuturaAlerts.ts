// Alertas de confluencia de VisionFutura (Carlos, oct 2026) — se muestran en
// pantalla (área al final de la pestaña) con su orden sugerida; sin Telegram
// por ahora, a pedido de Carlos: "cuando se
// cumplan las condiciones, mezclando todo y teniendo en cuenta el VIX — si
// llega a un dealer techo probablemente se viene una caída; en un dealer piso
// están defendiendo y probablemente puede que suba". PURO: el estado entre
// ciclos (muestras de precio, VIX y agresor) vive en visionFuturaAlertStore.ts.
//
// Cuatro setups, cada uno con 5 condiciones. Las 2 primeras son
// obligatorias (el precio tiene que haber llegado al nivel y reaccionado);
// de las otras 3 se piden al menos 2 → mínimo 4 de 5.
//
//   Rechazo en techo  (posible caída):  llega al techo · se frena · techo firme (calls vendidos) · agresor vende · VIX sube
//   Defensa de piso   (posible subida): llega al piso  · rebota   · piso firme (puts vendidos)   · agresor compra · VIX baja
//   Ruptura de piso   (caída acelerada): estaba arriba · rompe y se sostiene abajo · defensa rota · agresor vende · VIX sube
//   Ruptura de techo  (subida acelerada): estaba abajo · rompe y se sostiene arriba · techo roto  · agresor compra · VIX baja
//
// El régimen de GEX no es condición: solo se informa (positivo favorece
// rechazos/defensas, negativo favorece rupturas).
//
// MODO NOCHE (🌙 /ES y /NQ, Carlos 25-oct-2026: "de noche no se ve el agresor, solo cumpliría 3
// de 5 y nunca me daría una alerta"). Con `night`, las condiciones 3–5 usan datos que SÍ existen
// de noche (las de día quedan igual):
//   3. Nivel con peso: el strike tiene |GEX| en el 30% más grande de la pantalla (OI de CME),
//      o el flujo de opciones de día si el streamer está corriendo.
//   4. Agresor del FUTURO: contratos comprados al ask vs vendidos al bid en las velas de 1 min
//      de los últimos minutos (≥ `minContracts` y desbalance ≥ `minImbalance`).
//   5. /VX (VIX en futuros, opera de noche): se movió ≥ 1 tick (0.05) en 15 min a favor.

import type { ConvertedLevel, Conversion, KeyLevel, DealerLevel, VisionStrikeRow } from "./visionFutura";
import { convertLevel } from "./visionFutura";

export type AlertKind = "rechazo_techo" | "defensa_piso" | "ruptura_piso" | "ruptura_techo";

export interface Sample { t: number; v: number } // t en ms

export interface AlertCondition {
  key: "llega" | "reaccion" | "firme" | "agresor" | "vix";
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * Orden sugerida del setup — referencia sobre el SUBYACENTE (no un contrato):
 * largo = calls / comprar /ES o SPY; corto = puts / vender /ES o SPY.
 * Stop: del otro lado del nivel que define el setup (+/− `stopBufferPts`).
 */
export interface AlertOrder {
  side: "largo" | "corto";
  instrumento: string;
  entry: ConvertedLevel;
  stop: ConvertedLevel;
  target: ConvertedLevel | null;
  /** Recompensa / riesgo en puntos; null sin objetivo. */
  rb: number | null;
  riskPts: number;
  rewardPts: number | null;
}

export interface VisionAlert {
  /** Identidad estable del setup (tipo + nivel), para no repetir el aviso. */
  id: string;
  kind: AlertKind;
  direction: "alcista" | "bajista";
  title: string;
  level: ConvertedLevel;
  levelSources: string[];
  price: ConvertedLevel;
  conditions: AlertCondition[];
  score: number;
  fires: boolean;
  /** Las condiciones se cumplen pero la orden no pasa un filtro (R:B, objetivo, duplicada). */
  blocked: string | null;
  /**
   * "Piso/techo con trampa": el strike del nivel tiene GEX negativo grande
   * (top 30% de la pantalla). Se defiende mientras aguanta, pero si se rompe
   * los dealers aceleran el movimiento. No bloquea la alerta: es una advertencia.
   */
  trap: string | null;
  target: (ConvertedLevel & { label: string }) | null;
  order: AlertOrder;
  regimeNote: string | null;
}

/** Confirmaciones del modo noche (ver arriba). */
export interface NightConfirm {
  /** Agresor del futuro en la ventana corta (contratos). */
  futFlow: { symbol: string; buy: number; sell: number; minutes: number } | null;
  /** /VX hace ~15 min y ahora. */
  vx: { symbol: string; from: number; to: number } | null;
}

export const NIGHT_TUNING = {
  /** Minutos de velas de 1 min que suma el agresor del futuro. */
  flowMinutes: 5,
  /** Contratos mínimos en esa ventana (de noche hay poco volumen: menos que esto es ruido). */
  minContracts: 30,
  /** (compras − ventas) ÷ total mínimo para decir que un lado domina. */
  minImbalance: 0.15,
  /** Movimiento mínimo del /VX en 15 min (1 tick = 0.05). */
  vxMinMove: 0.05,
};

export const ALERT_TUNING = {
  /** Distancia en pts de SPX para considerar que el precio "llegó" al nivel. */
  touchPts: 3,
  /** Retroceso mínimo desde el extremo para decir que "se frenó"/"rebotó". */
  reactionPts: 3,
  /** Cuánto tiene que pasar el nivel para contar como ruptura. */
  breakPts: 2,
  /** Ventana que se mira hacia atrás (precio y VIX). */
  windowMs: 15 * 60_000,
  /** La ruptura tiene que sostenerse al menos este tiempo. */
  holdMs: 60_000,
  /** Cambio mínimo del VIX en la ventana para decir que sube/baja (en %). */
  vixMovePct: 0.5,
  /** Solo se vigilan niveles a esta distancia del precio. */
  maxDistance: 40,
  /** Zona del agresor alrededor del nivel (pts). */
  aggressorZone: 5,
  /** La entrada tiene que estar a esta distancia del nivel o menos (no perseguir un rebote ya hecho). */
  maxEntryPts: 8,
  /**
   * Objetivo de scalp: Carlos opera desplazamientos de 2–3 puntos de SPX por
   * entrada, así que el objetivo es FIJO desde la entrada (no "el siguiente
   * nivel"). Exige además que no haya un nivel en contra a menos de esta
   * distancia en el camino (frenaría el movimiento antes del objetivo).
   */
  targetPts: 3,
  /**
   * Stop: "fijo" = `stopPts` desde la entrada; "nivel" = del otro lado del
   * nivel + `stopBufferPts` (el piso/techo funciona como zona, así que un
   * buffer chico se barre fácil — ver backtest del 2026-10-22).
   */
  stopMode: "fijo" as "fijo" | "nivel",
  stopPts: 3,
  stopBufferPts: 3,
  /** Recompensa/riesgo mínimo para disparar (0 = sin filtro). */
  minRb: 0,
  /** "Con trampa" = GEX neto negativo del strike en este percentil de |GEX| o más (0.7 = top 30%). */
  trapPercentile: 0.7,
  /** Trampa "fuerte" = el GEX del strike es al menos esta fracción del más negativo de la pantalla. */
  trapStrongRatio: 0.7,
  /**
   * Sin alertas en sentido contrario encimadas (Carlos, 26-oct: "casi a la misma hora pero en
   * sentido contrario, evitemos eso" — 15:02 rechazo techo 7680 CORTO y 15:04 defensa piso 7670
   * LARGO, las dos activas). Mientras la orden de una alerta siga abierta (no tocó ni stop ni
   * objetivo) no se dispara una del lado contrario. Se probó bloquear 15 min fijos y salía peor:
   * el 23-oct bloqueaba solo ganadoras (la primera ya había tocado su stop y la contraria era la
   * buena). Tope: pasado este tiempo la orden vieja ya no bloquea aunque siga abierta.
   */
  oppositeMaxMs: 30 * 60_000,
};

interface LevelCandidate { spx: number; sources: string[] }

function collectLevels(keyLevels: KeyLevel[], dealerLevels: DealerLevel[], side: "techo" | "piso", spot: number, maxDistance: number): LevelCandidate[] {
  const map = new Map<number, string[]>();
  const add = (spx: number, src: string) => {
    if (Math.abs(spx - spot) > maxDistance) return;
    map.set(spx, [...(map.get(spx) ?? []), src]);
  };
  for (const k of keyLevels) {
    if (side === "techo" && k.kind === "resistencia") add(k.spx, k.label);
    if (side === "piso" && k.kind === "piso") add(k.spx, k.label);
  }
  for (const d of dealerLevels) {
    if (side === "techo" && d.role === "resistencia") add(d.spx, "Dealers: techo");
    if (side === "piso" && d.role === "piso") add(d.spx, "Dealers: piso");
  }
  return [...map.entries()].map(([spx, sources]) => ({ spx, sources: [...new Set(sources)] }));
}

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtM = (v: number) => `${v < 0 ? "−" : "+"}$${(Math.abs(v) / 1e6).toFixed(1)}M`;

function nearestRow(rows: VisionStrikeRow[], spx: number): VisionStrikeRow | null {
  let best: VisionStrikeRow | null = null;
  for (const r of rows) if (!best || Math.abs(r.spx - spx) < Math.abs(best.spx - spx)) best = r;
  return best && Math.abs(best.spx - spx) <= 2.5 ? best : null;
}

/** Cambio neto (compras − ventas) del agresor en la zona del nivel desde el snapshot anterior. */
function aggressorDelta(
  level: number,
  current: Map<number, { compras: number; ventas: number }>,
  previous: Map<number, { compras: number; ventas: number }> | null,
  zone: number,
): number | null {
  if (!previous) return null;
  let d = 0;
  let any = false;
  for (const [strike, cur] of current) {
    if (Math.abs(strike - level) > zone) continue;
    const prev = previous.get(strike);
    if (!prev) continue;
    any = true;
    d += (cur.compras - cur.ventas) - (prev.compras - prev.ventas);
  }
  return any ? d : null;
}

function vixTrend(vix: Sample[], now: number): { pct: number; from: number; to: number } | null {
  const win = vix.filter((s) => s.t >= now - ALERT_TUNING.windowMs);
  if (win.length < 2) return null;
  const from = win[0].v, to = win[win.length - 1].v;
  if (!(from > 0)) return null;
  return { pct: ((to - from) / from) * 100, from, to };
}

export interface EvaluateInput {
  now: number;
  spot: number;
  conversion: Conversion;
  keyLevels: KeyLevel[];
  dealerLevels: DealerLevel[];
  rows: VisionStrikeRow[];
  regime: "positivo" | "negativo" | null;
  /** Muestras de precio SPX (ms), ordenadas. Incluir el spot actual. */
  prices: Sample[];
  /** Muestras del VIX (ms), ordenadas. */
  vix: Sample[];
  vixMagnet: number | null;
  aggressorNow: Map<number, { compras: number; ventas: number }>;
  aggressorPrev: Map<number, { compras: number; ventas: number }> | null;
  /**
   * Escala de los umbrales en puntos (1 = SPX). Ver lib/visionFuturaInstruments.ts:
   * NQ/TSLA multiplican toque, rebote, ruptura, distancias, zona del agresor y el scalp.
   */
  scale?: number;
  /** Cómo operar cada lado en el instrumento (texto de la orden). */
  instrumentos?: { largo: string; corto: string };
  /** Modo noche: confirmaciones con el agresor del futuro y el /VX (ver NightConfirm). */
  night?: NightConfirm | null;
  /**
   * Alertas que ya dispararon antes, con su orden. Si la de un lado sigue abierta (según
   * `priceHistory`), no se dispara una del lado contrario (`oppositeMaxMs`).
   */
  recentFired?: FiredRef[];
  /** Precio de todo el día hasta `now` (para saber si la orden de una alerta anterior sigue abierta). Por defecto `prices`. */
  priceHistory?: Sample[];
}

export interface FiredRef {
  direction: "alcista" | "bajista";
  firedAt: number;
  title: string;
  order: { side: "largo" | "corto"; stop: { spx: number }; target: { spx: number } | null };
}

/** ¿La orden de esta alerta sigue abierta en `now`? (ningún precio posterior tocó su stop ni su objetivo) */
export function orderStillOpen(f: FiredRef, prices: Sample[], now: number): boolean {
  const stop = f.order.stop.spx;
  const target = f.order.target?.spx ?? null;
  for (const p of prices) {
    if (p.t <= f.firedAt || p.t > now) continue;
    if (f.order.side === "corto" ? p.v >= stop || (target != null && p.v <= target) : p.v <= stop || (target != null && p.v >= target)) return false;
  }
  return true;
}

/** Evalúa todos los setups posibles. Devuelve también los que NO disparan (para el "vigilando" de la pantalla). */
export function evaluateVisionAlerts(input: EvaluateInput): VisionAlert[] {
  const { now, spot, conversion, keyLevels, dealerLevels, rows, regime, vix, vixMagnet, aggressorNow, aggressorPrev } = input;
  // Umbrales en puntos escalados al instrumento (SPX = 1, sin cambios).
  const S = input.scale && input.scale > 0 ? input.scale : 1;
  const sc = (v: number) => Math.round(v * S * 100) / 100;
  const T = {
    ...ALERT_TUNING,
    touchPts: sc(ALERT_TUNING.touchPts),
    reactionPts: sc(ALERT_TUNING.reactionPts),
    breakPts: sc(ALERT_TUNING.breakPts),
    maxDistance: sc(ALERT_TUNING.maxDistance),
    aggressorZone: sc(ALERT_TUNING.aggressorZone),
    maxEntryPts: sc(ALERT_TUNING.maxEntryPts),
    targetPts: sc(ALERT_TUNING.targetPts),
    stopPts: sc(ALERT_TUNING.stopPts),
    stopBufferPts: sc(ALERT_TUNING.stopBufferPts),
  };  const prices = input.prices.filter((p) => p.t >= now - ALERT_TUNING.windowMs);
  if (prices.length === 0) return [];
  const hi = Math.max(...prices.map((p) => p.v));
  const lo = Math.min(...prices.map((p) => p.v));
  const conv = (s: number) => convertLevel(s, conversion);
  const vt = vixTrend(vix, now);
  const vixUp = vt != null && vt.pct >= ALERT_TUNING.vixMovePct;
  const vixDown = vt != null && vt.pct <= -ALERT_TUNING.vixMovePct;
  const vixDetail = (want: "sube" | "baja") => {
    if (!vt) return "sin suficientes datos del VIX todavía";
    const mag = vixMagnet != null ? ` · Magneto VIX ${fmt(vixMagnet)}` : "";
    const dir = vt.pct > 0 ? "subiendo" : vt.pct < 0 ? "bajando" : "plano";
    const okWord = (want === "sube" ? vixUp : vixDown) ? "" : ` (se busca que ${want})`;
    return `${dir} ${fmt(vt.from)} → ${fmt(vt.to)} (${vt.pct >= 0 ? "+" : ""}${vt.pct.toFixed(2)}%)${mag}${okWord}`;
  };

  // Objetivos: el próximo nivel relevante en la dirección del movimiento.
  const downTargets = [
    ...keyLevels.filter((k) => k.kind === "piso" || k.kind === "iman_negativo" || k.kind === "magneto").map((k) => ({ spx: k.spx, label: k.label })),
    ...dealerLevels.filter((d) => d.role === "piso" || d.role === "acelera_abajo").map((d) => ({ spx: d.spx, label: d.role === "piso" ? "Dealers: piso" : "Dealers: acelera ↓" })),
  ];
  const upTargets = [
    ...keyLevels.filter((k) => k.kind === "resistencia" || k.kind === "iman_positivo" || k.kind === "magneto").map((k) => ({ spx: k.spx, label: k.label })),
    ...dealerLevels.filter((d) => d.role === "resistencia" || d.role === "acelera_arriba").map((d) => ({ spx: d.spx, label: d.role === "resistencia" ? "Dealers: techo" : "Dealers: acelera ↑" })),
  ];

  // El primer nivel en la dirección del trade (más allá de la entrada): si
  // está más cerca que el objetivo del scalp, está "en el camino".
  const nextLevel = (dir: "up" | "down") => {
    const list = (dir === "down" ? downTargets.filter((t) => t.spx < spot - 0.5) : upTargets.filter((t) => t.spx > spot + 0.5))
      .sort((a, b) => (dir === "down" ? b.spx - a.spx : a.spx - b.spx));
    return list[0] ?? null;
  };

  const regimeNote = (bias: "reaccion" | "ruptura") =>
    regime == null ? null
      : regime === "positivo"
        ? bias === "reaccion" ? "GEX positivo: favorece que el nivel aguante" : "GEX positivo: las rupturas suelen tener menos recorrido"
        : bias === "reaccion" ? "GEX negativo: ojo, los niveles se rompen más fácil" : "GEX negativo: favorece rupturas con recorrido";

  const heldSince = (pred: (v: number) => boolean) => {
    // Cuánto tiempo seguido (ms) lleva cumpliéndose `pred` hasta ahora.
    let since: number | null = null;
    for (let i = prices.length - 1; i >= 0; i--) {
      if (!pred(prices[i].v)) break;
      since = prices[i].t;
    }
    return since == null ? 0 : now - since;
  };

  // Umbral de "trampa": |GEX neto| del percentil `trapPercentile` de la pantalla.
  const gexMags = rows.map((r) => Math.abs(r.netGex)).filter((v) => v > 0).sort((a, b) => a - b);
  const trapThreshold = gexMags.length
    ? gexMags[Math.min(gexMags.length - 1, Math.floor(T.trapPercentile * (gexMags.length - 1)))]
    : 0;
  const fmtB = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(0)}M`).replace("-", "−");
  // En un día con GEX negativo en casi todos los strikes, casi todos los
  // niveles califican: por eso se gradúa contra el MÁS negativo de la pantalla
  // (fuerte = zona del Imán −; moderada = negativo grande pero lejos del peor).
  const mostNegative = Math.min(0, ...rows.map((r) => r.netGex));
  const trapFor = (kind: AlertKind, spx: number): string | null => {
    if (kind !== "defensa_piso" && kind !== "rechazo_techo") return null;
    const r = nearestRow(rows, spx);
    if (!r || !(r.netGex < 0) || trapThreshold <= 0 || Math.abs(r.netGex) < trapThreshold) return null;
    const strong = mostNegative < 0 && r.netGex / mostNegative >= T.trapStrongRatio;
    const grade = strong ? "fuerte" : "moderada";
    const pct = mostNegative < 0 ? Math.round((r.netGex / mostNegative) * 100) : 0;
    return kind === "defensa_piso"
      ? `Piso con trampa ${grade}: GEX ${fmtB(r.netGex)} en ${fmt(spx, 0)} (${pct}% del más negativo). Se defiende mientras aguante, pero si se rompe la caída puede ser rápida — respeta el stop.`
      : `Techo con trampa ${grade}: GEX ${fmtB(r.netGex)} en ${fmt(spx, 0)} (${pct}% del más negativo). Frena mientras aguante, pero si se rompe la subida puede ser rápida — respeta el stop.`;
  };
  const aggMissing = aggressorPrev ? "sin operaciones nuevas en la zona del nivel" : "esperando el siguiente refresco para comparar";

  // ── Modo noche: reemplaza las condiciones 3–5 por datos que existen de noche ──
  const N = input.night ?? null;
  const nightize = (c: AlertCondition, kind: AlertKind, direction: "alcista" | "bajista", L: number): AlertCondition => {
    if (!N) return c;
    const wantBuy = direction === "alcista";
    if (c.key === "firme") {
      const r = nearestRow(rows, L);
      const strong = r != null && trapThreshold > 0 && Math.abs(r.netGex) >= trapThreshold;
      const reaction = kind === "rechazo_techo" || kind === "defensa_piso";
      const gexTxt = r ? `GEX ${fmtB(r.netGex)} en ${fmt(L, 0)}` : "sin datos del strike";
      return {
        key: "firme",
        label: c.ok ? c.label : reaction ? "Nivel con peso de opciones" : "Rompió un nivel con peso de opciones",
        ok: c.ok || strong,
        detail: c.ok ? c.detail : strong ? `${gexTxt} · de los más grandes de la pantalla (OI de CME)` : `${gexTxt} · chico (se pide ≥ ${fmtB(trapThreshold)})`,
      };
    }
    if (c.key === "agresor") {
      const f = N.futFlow;
      const label = `Agresor del futuro ${wantBuy ? "comprando" : "vendiendo"}`;
      if (!f) return { key: "agresor", label, ok: c.ok, detail: c.ok ? c.detail : "sin velas de 1 min del futuro todavía" };
      const total = f.buy + f.sell;
      const net = f.buy - f.sell;
      const imb = total > 0 ? net / total : 0;
      const ok = total >= NIGHT_TUNING.minContracts && Math.abs(imb) >= NIGHT_TUNING.minImbalance && (wantBuy ? net > 0 : net < 0);
      const why = total < NIGHT_TUNING.minContracts ? ` · poco volumen (se piden ≥ ${NIGHT_TUNING.minContracts})` : "";
      return {
        key: "agresor", label, ok: c.ok || ok,
        detail: `${f.symbol} últimos ${f.minutes} min: ${f.buy} comprados al ask · ${f.sell} vendidos al bid (neto ${net >= 0 ? "+" : ""}${net}, ${Math.round(imb * 100)}%)${why}`,
      };
    }
    if (c.key === "vix") {
      const v = N.vx;
      const label = `/VX ${wantBuy ? "bajando" : "subiendo"}`;
      if (!v) return { key: "vix", label, ok: false, detail: "sin datos del /VX" };
      const d = Math.round((v.to - v.from) * 100) / 100;
      const ok = wantBuy ? d <= -NIGHT_TUNING.vxMinMove + 1e-9 : d >= NIGHT_TUNING.vxMinMove - 1e-9;
      return { key: "vix", label, ok, detail: `${v.symbol} ${fmt(v.from)} → ${fmt(v.to)} en 15 min (${d >= 0 ? "+" : ""}${d.toFixed(2)}) · de noche cuenta 1 tick (0.05)` };
    }
    return c;
  };

  const out: VisionAlert[] = [];
  const build = (
    kind: AlertKind, lvl: LevelCandidate, conditions: AlertCondition[], title: string,
    direction: "alcista" | "bajista", note: string | null,
  ) => {
    conditions = conditions.map((c) => nightize(c, kind, direction, lvl.spx));
    const [a, b, ...rest] = conditions;
    const score = conditions.filter((c) => c.ok).length;
    const conditionsOk = a.ok && b.ok && rest.filter((c) => c.ok).length >= 2;
    // Rechazo en techo / ruptura de piso → corto, stop arriba del nivel.
    // Defensa de piso / ruptura de techo → largo, stop abajo del nivel.
    const side: AlertOrder["side"] = direction === "alcista" ? "largo" : "corto";
    const stopSpx = T.stopMode === "fijo"
      ? side === "corto" ? spot + T.stopPts : spot - T.stopPts
      : side === "corto" ? Math.max(lvl.spx, spot) + T.stopBufferPts : Math.min(lvl.spx, spot) - T.stopBufferPts;
    const targetSpx = side === "corto" ? spot - T.targetPts : spot + T.targetPts;
    const target = { ...conv(targetSpx), label: `Scalp ${side === "corto" ? "−" : "+"}${T.targetPts} pts` };
    const riskPts = Math.abs(spot - stopSpx);
    const rewardPts = T.targetPts;
    const rb = riskPts > 0 ? rewardPts / riskPts : null;
    const inTheWay = nextLevel(side === "corto" ? "down" : "up");
    let blocked: string | null = null;
    if (conditionsOk) {
      if (inTheWay && Math.abs(inTheWay.spx - spot) < T.targetPts) {
        blocked = `${inTheWay.label} ${fmt(inTheWay.spx, 0)} está a ${fmt(Math.abs(inTheWay.spx - spot), 1)} pts, en el camino del objetivo`;
      } else if (T.minRb > 0 && (rb == null || rb < T.minRb)) {
        blocked = `R:B ${rb?.toFixed(2) ?? "—"} menor a ${T.minRb}`;
      }
    }
    out.push({
      id: `${kind}:${lvl.spx}`, kind, direction, title, level: conv(lvl.spx), levelSources: lvl.sources,
      price: conv(spot), conditions, score, fires: conditionsOk && blocked == null, blocked, trap: trapFor(kind, lvl.spx), target, regimeNote: note,
      order: {
        side,
        instrumento: input.instrumentos
          ? (side === "largo" ? input.instrumentos.largo : input.instrumentos.corto)
          : side === "largo" ? "Calls de SPX/SPY · comprar /ES" : "Puts de SPX/SPY · vender /ES",
        entry: conv(spot),
        stop: conv(stopSpx),
        target: conv(targetSpx),
        rb,
        riskPts,
        rewardPts,
      },
    });
  };


  // ── Techos ──
  for (const lvl of collectLevels(keyLevels, dealerLevels, "techo", spot, T.maxDistance)) {
    const L = lvl.spx;
    const row = nearestRow(rows, L);
    const agg = aggressorDelta(L, aggressorNow, aggressorPrev, T.aggressorZone);

    // Rechazo: tocó el techo y ahora está debajo, retrocediendo.
    const llega = hi >= L - T.touchPts;
    const reaccion = llega && spot < L && hi - spot >= T.reactionPts && L - spot <= T.maxEntryPts;
    const firme = row != null && row.callFlow < 0;
    build("rechazo_techo", lvl, [
      { key: "llega", label: "Llegó al techo", ok: llega, detail: `máximo de 15 min ${fmt(hi)} vs techo ${fmt(L)}` },
      { key: "reaccion", label: "Se frenó y bajó", ok: reaccion, detail: `retrocede ${fmt(Math.max(0, hi - spot))} pts desde el máximo · a ${fmt(Math.abs(L - spot), 1)} pts del techo (máx ${T.maxEntryPts})` },
      { key: "firme", label: "Techo firme (calls vendidos)", ok: firme, detail: row ? `flujo de calls ${fmtM(row.callFlow)}` : "sin datos del strike" },
      { key: "agresor", label: "Agresor vendiendo", ok: agg != null && agg < 0, detail: agg == null ? aggMissing : `compras − ventas ${fmtM(agg)} en la zona` },
      { key: "vix", label: "VIX subiendo", ok: vixUp, detail: vixDetail("sube") },
    ], `Rechazo en TECHO ${fmt(L, 0)} — posible caída`, "bajista", regimeNote("reaccion"));

    // Ruptura de techo: estaba debajo, lo pasó y se sostiene arriba.
    const estabaAbajo = prices.some((p) => p.v < L);
    const sostiene = spot > L + T.breakPts && spot - L <= T.maxEntryPts && heldSince((v) => v > L) >= T.holdMs;
    const roto = row != null && (row.callFlow > 0 || row.dealerRole === "acelera_arriba");
    build("ruptura_techo", lvl, [
      { key: "llega", label: "Venía de abajo del techo", ok: estabaAbajo, detail: `mínimo de 15 min ${fmt(lo)}` },
      { key: "reaccion", label: "Lo rompió y se sostiene arriba", ok: sostiene, detail: `precio ${fmt(spot)} vs techo ${fmt(L)} (entrada máx ${T.maxEntryPts} pts arriba)` },
      { key: "firme", label: "Techo roto (compran calls)", ok: roto, detail: row ? `flujo de calls ${fmtM(row.callFlow)}` : "sin datos del strike" },
      { key: "agresor", label: "Agresor comprando", ok: agg != null && agg > 0, detail: agg == null ? aggMissing : `compras − ventas ${fmtM(agg)} en la zona` },
      { key: "vix", label: "VIX bajando", ok: vixDown, detail: vixDetail("baja") },
    ], `Ruptura de TECHO ${fmt(L, 0)} — posible subida acelerada`, "alcista", regimeNote("ruptura"));
  }

  // ── Pisos ──
  for (const lvl of collectLevels(keyLevels, dealerLevels, "piso", spot, T.maxDistance)) {
    const L = lvl.spx;
    const row = nearestRow(rows, L);
    const agg = aggressorDelta(L, aggressorNow, aggressorPrev, T.aggressorZone);

    const llega = lo <= L + T.touchPts;
    const reaccion = llega && spot > L && spot - lo >= T.reactionPts && spot - L <= T.maxEntryPts;
    const firme = row != null && row.putFlow < 0;
    build("defensa_piso", lvl, [
      { key: "llega", label: "Llegó al piso", ok: llega, detail: `mínimo de 15 min ${fmt(lo)} vs piso ${fmt(L)}` },
      { key: "reaccion", label: "Rebotó", ok: reaccion, detail: `sube ${fmt(Math.max(0, spot - lo))} pts desde el mínimo · a ${fmt(Math.abs(spot - L), 1)} pts del piso (máx ${T.maxEntryPts})` },
      { key: "firme", label: "Piso firme (puts vendidos)", ok: firme, detail: row ? `flujo de puts ${fmtM(row.putFlow)}` : "sin datos del strike" },
      { key: "agresor", label: "Agresor comprando", ok: agg != null && agg > 0, detail: agg == null ? aggMissing : `compras − ventas ${fmtM(agg)} en la zona` },
      { key: "vix", label: "VIX bajando", ok: vixDown, detail: vixDetail("baja") },
    ], `Defensa de PISO ${fmt(L, 0)} — posible subida`, "alcista", regimeNote("reaccion"));

    const estabaArriba = prices.some((p) => p.v > L);
    const sostiene = spot < L - T.breakPts && L - spot <= T.maxEntryPts && heldSince((v) => v < L) >= T.holdMs;
    const roto = row != null && (row.putFlow > 0 || row.dealerRole === "acelera_abajo");
    build("ruptura_piso", lvl, [
      { key: "llega", label: "Venía de arriba del piso", ok: estabaArriba, detail: `máximo de 15 min ${fmt(hi)}` },
      { key: "reaccion", label: "Lo rompió y se sostiene abajo", ok: sostiene, detail: `precio ${fmt(spot)} vs piso ${fmt(L)} (entrada máx ${T.maxEntryPts} pts abajo)` },
      { key: "firme", label: "Defensa rota (compran puts)", ok: roto, detail: row ? `flujo de puts ${fmtM(row.putFlow)}` : "sin datos del strike" },
      { key: "agresor", label: "Agresor vendiendo", ok: agg != null && agg < 0, detail: agg == null ? aggMissing : `compras − ventas ${fmtM(agg)} en la zona` },
      { key: "vix", label: "VIX subiendo", ok: vixUp, detail: vixDetail("sube") },
    ], `Ruptura de PISO ${fmt(L, 0)} — posible caída acelerada`, "bajista", regimeNote("ruptura"));
  }

  // Una sola alerta por lado en cada momento: si varios niveles vecinos
  // disparan juntos es la misma entrada — gana la de más condiciones y,
  // empatadas, la del nivel más cercano al precio.
  for (const dir of ["alcista", "bajista"] as const) {
    const firing = out.filter((x) => x.fires && x.direction === dir)
      .sort((x, y) => y.score - x.score || Math.abs(x.level.spx - spot) - Math.abs(y.level.spx - spot));
    for (const dup of firing.slice(1)) {
      dup.fires = false;
      dup.blocked = `misma entrada que ${firing[0].title.split(" — ")[0]}`;
    }
  }

  // Nunca dos lados opuestos seguidos: el mismo momento o una alerta contraria activa hace poco.
  const up = out.find((x) => x.fires && x.direction === "alcista");
  const down = out.find((x) => x.fires && x.direction === "bajista");
  if (up && down) {
    // Las dos en el mismo momento: gana la de más condiciones; empatadas, ninguna.
    const short = (a: VisionAlert) => a.title.split(" — ")[0];
    if (up.score === down.score) {
      up.fires = false; up.blocked = `señales encontradas: también se cumple ${short(down)}`;
      down.fires = false; down.blocked = `señales encontradas: también se cumple ${short(up)}`;
    } else {
      const [win, lose] = up.score > down.score ? [up, down] : [down, up];
      lose.fires = false;
      lose.blocked = `contraria a ${short(win)}, que cumple más condiciones`;
    }
  }
  const history = input.priceHistory ?? input.prices;
  for (const a of out.filter((x) => x.fires)) {
    const contra = (input.recentFired ?? [])
      .filter((f) => f.direction !== a.direction && f.firedAt < now && now - f.firedAt < T.oppositeMaxMs && orderStillOpen(f, history, now))
      .sort((x, y) => y.firedAt - x.firedAt)[0];
    if (contra) {
      const min = Math.max(0, Math.round((now - contra.firedAt) / 60_000));
      a.fires = false;
      a.blocked = `sentido contrario a ${contra.title.split(" — ")[0]} (de hace ${min} min), que sigue abierta: espera a que toque su stop u objetivo`;
    }
  }
  return out;
}
