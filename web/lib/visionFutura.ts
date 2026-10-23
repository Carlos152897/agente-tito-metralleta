// VisionFutura (Prueba de Fuego, pedido explícito de Carlos, oct 2026): mapa
// de niveles de SPX con conversión a SPY y /ES — Magneto, imán positivo,
// imán negativo, pisos y resistencias, VIX, y dónde están posicionados los
// dealers según el flujo real de MarketSnack. PURO — los fetch viven en
// app/api/vision-futura/route.ts.
//
// Fuentes (las mismas que ya usa lib/spxLevels.ts):
//   - `gex_stats_chart`: call_wall / put_wall / magnet / gamma_flip / net_gex
//     YA calculados por MarketSnack (no se recalculan acá).
//   - `option_chain_extended` (0DTE): gamma REAL por contrato → GEX por strike
//     (`computeStrikeGex`), y `premium_breakdown` ask/bid → flujo de hoy.
//
// Lectura de dealers por flujo: el cliente que compra al ask (net premium > 0)
// deja al dealer CORTO ese contrato; el que vende al bid (net < 0) lo deja
// LARGO. Es una estimación del flujo de HOY — el open interest de días
// anteriores no dice de qué lado quedó cada parte, así que no se usa para
// esto (sí para el GEX).

import { bsCharm } from "./blackScholes";
import { computeStrikeGex, toStrikePremiumsFromExtendedChain, type ExtendedChainContract, type GexStatsBucket } from "./spxLevels";

export interface Conversion {
  /** SPY ≈ SPX × ratio (ratio real del momento, no un 1/10 fijo). */
  spyRatio: number | null;
  /** /ES ≈ SPX + base (base real del momento: /ES − SPX). */
  esBasis: number | null;
}

export interface ConvertedLevel {
  spx: number;
  spy: number | null;
  es: number | null;
}

export function convertLevel(spx: number, conv: Conversion): ConvertedLevel {
  return {
    spx,
    spy: conv.spyRatio != null ? spx * conv.spyRatio : null,
    es: conv.esBasis != null ? spx + conv.esBasis : null,
  };
}

export type KeyLevelKind =
  | "magneto"
  | "iman_positivo"
  | "iman_negativo"
  | "resistencia"
  | "piso"
  | "gamma_flip"
  | "max_pain"
  | "charm";

export interface KeyLevel extends ConvertedLevel {
  kind: KeyLevelKind;
  label: string;
  /** De dónde sale el nivel, dicho en corto para mostrarlo al lado. */
  fuente: string;
  /** Distancia en puntos de SPX al spot (positivo = arriba). */
  distance: number;
}

export type DealerSide = "compran" | "venden" | null;
export type DealerRole =
  | "resistencia" // dealers largos en calls arriba: venden las subidas
  | "piso" // dealers largos en puts abajo: compran las caídas
  | "acelera_arriba" // dealers cortos en calls arriba: compran si sube, lo empujan
  | "acelera_abajo" // dealers cortos en puts abajo: venden si baja, lo empujan
  | null;

export interface VisionStrikeRow extends ConvertedLevel {
  callGex: number;
  putGex: number;
  netGex: number;
  /** Exposición charm del strike: cuánto delta (en $) cambia por día solo por el paso del tiempo. */
  charm: number;
  callFlow: number;
  putFlow: number;
  /** Premium total pegando al ask (calls + puts) — el agresor comprador. */
  compras: number;
  /** Premium total pegando al bid (calls + puts) — el agresor vendedor. */
  ventas: number;
  callVolume: number;
  putVolume: number;
  /** Qué hacen los dealers con los calls de este strike según el flujo de hoy. */
  dealerCalls: DealerSide;
  dealerPuts: DealerSide;
  dealerRole: DealerRole;
  /** El flujo de este strike está en el 30% más grande del día. */
  strongFlow: boolean;
  tags: KeyLevelKind[];
}

export interface DealerLevel extends ConvertedLevel {
  role: Exclude<DealerRole, null>;
  premium: number;
  texto: string;
}

export interface VixReading {
  last: number;
  prevClose: number;
  changePct: number;
}

export interface ExpectedMove {
  /** Movimiento esperado de 1 desvío para el día, en puntos de SPX (VIX / √252). */
  points: number;
  low: ConvertedLevel;
  high: ConvertedLevel;
}

export interface VisionFuturaReport {
  spot: ConvertedLevel;
  conversion: Conversion;
  regime: "positivo" | "negativo" | null;
  netGex: number | null;
  keyLevels: KeyLevel[];
  dealerLevels: DealerLevel[];
  rows: VisionStrikeRow[];
  vix: VixReading | null;
  expectedMove: ExpectedMove | null;
  /** Suma de la exposición charm de la ventana ($ de delta por día). */
  netCharm: number;
  resumen: string[];
}

/** Años hasta las 16:00 ET del día de vencimiento (mínimo 5 min, para no dividir por ~0 al cierre). */
export function yearsToExpiry(expiration: string, now: Date): number {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${expiration}T16:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-05:00";
  const close = Date.parse(`${expiration}T16:00:00${offset}`);
  const minYears = 5 / (365 * 24 * 60);
  return Math.max((close - now.getTime()) / (365 * 24 * 3600 * 1000), minYears);
}

/**
 * Exposición charm por strike, misma convención de signo que el GEX
 * (calls suman, puts restan — dealers largos calls / cortos puts):
 * `charm × OI × 100 × spot / 365` = $ de delta que cambia en un día solo por
 * el paso del tiempo. Usa la IV real de cada contrato de MarketSnack; el
 * charm sale de Black-Scholes (MarketSnack no lo trae).
 */
export function computeStrikeCharm(contracts: ExtendedChainContract[], spot: number, T: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of contracts) {
    const iv = c.implied_volatility;
    if (!(c.open_interest > 0) || iv == null || !(iv > 0)) continue;
    const exposure = (bsCharm(spot, c.strike, T, iv) * c.open_interest * 100 * spot) / 365;
    out.set(c.strike, (out.get(c.strike) ?? 0) + (c.type === "call" ? exposure : -exposure));
  }
  return out;
}

/** Percentil simple (p en 0..1) sobre una lista ya filtrada. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function sideOf(flow: number): DealerSide {
  // Cliente compra al ask → dealer queda corto (vende); al bid → dealer compra.
  if (flow > 0) return "venden";
  if (flow < 0) return "compran";
  return null;
}

function roleOf(strike: number, spot: number, callFlow: number, putFlow: number): DealerRole {
  if (strike > spot) {
    if (callFlow < 0) return "resistencia";
    if (callFlow > 0) return "acelera_arriba";
  } else if (strike < spot) {
    if (putFlow < 0) return "piso";
    if (putFlow > 0) return "acelera_abajo";
  }
  return null;
}

const ROLE_TEXT: Record<Exclude<DealerRole, null>, string> = {
  resistencia: "Dealers COMPRARON calls acá (el público los vendió) → venden las subidas: resistencia",
  piso: "Dealers COMPRARON puts acá (el público los vendió) → compran las caídas: piso",
  acelera_arriba: "Dealers VENDIERON calls acá (el público los compró) → si sube, cubren comprando: acelera hacia arriba",
  acelera_abajo: "Dealers VENDIERON puts acá (el público los compró) → si baja, cubren vendiendo: acelera hacia abajo",
};

export function buildVisionFutura(input: {
  contracts: ExtendedChainContract[];
  spot: number;
  gexStats: GexStatsBucket | null;
  spy: number | null;
  es: number | null;
  vix: VixReading | null;
  /** Años al vencimiento, para el charm. Sin esto el charm queda en 0. */
  yearsToExpiry?: number;
  /** Ventana de strikes alrededor del spot, en puntos de SPX. */
  radius?: number;
}): VisionFuturaReport {
  const { contracts, spot, gexStats, vix } = input;
  const radius = input.radius ?? 60;

  const conversion: Conversion = {
    spyRatio: input.spy && input.spy > 0 ? input.spy / spot : null,
    esBasis: input.es && input.es > 0 ? input.es - spot : null,
  };
  const conv = (s: number) => convertLevel(s, conversion);

  const gexByStrike = computeStrikeGex(contracts, spot);
  const charmByStrike = input.yearsToExpiry ? computeStrikeCharm(contracts, spot, input.yearsToExpiry) : new Map<number, number>();
  const premiums = toStrikePremiumsFromExtendedChain(contracts);
  const volume = new Map<number, { call: number; put: number }>();
  for (const c of contracts) {
    const v = volume.get(c.strike) ?? { call: 0, put: 0 };
    if (c.type === "call") v.call += c.volume || 0; else v.put += c.volume || 0;
    volume.set(c.strike, v);
  }

  const allStrikes = [...new Set([...premiums.keys(), ...gexByStrike.keys()])];
  const inWindow = allStrikes.filter((s) => Math.abs(s - spot) <= radius).sort((a, b) => b - a);

  // ── Niveles clave ──
  const keyLevels: KeyLevel[] = [];
  const push = (kind: KeyLevelKind, label: string, strike: number | null | undefined, fuente: string) => {
    if (strike == null || !Number.isFinite(strike) || strike <= 0) return;
    keyLevels.push({ kind, label, fuente, distance: strike - spot, ...conv(strike) });
  };

  push("magneto", "Magneto", gexStats?.magnet, "imán del GEX de MarketSnack");

  // Imán positivo/negativo: el strike con más GEX neto a favor / en contra,
  // dentro de un rango operable (2× la ventana visible).
  const near = allStrikes.filter((s) => Math.abs(s - spot) <= radius * 2);
  let maxPos: number | null = null;
  let maxNeg: number | null = null;
  for (const s of near) {
    const g = gexByStrike.get(s)?.netGex ?? 0;
    if (g > 0 && (maxPos == null || g > (gexByStrike.get(maxPos)?.netGex ?? 0))) maxPos = s;
    if (g < 0 && (maxNeg == null || g < (gexByStrike.get(maxNeg)?.netGex ?? 0))) maxNeg = s;
  }
  push("iman_positivo", "Imán positivo", maxPos, "mayor GEX neto positivo (frena y atrae, pinea)");
  push("iman_negativo", "Imán negativo", maxNeg, "mayor GEX neto negativo (acelera al tocarlo)");

  push("resistencia", "Resistencia (Call Wall)", gexStats?.call_wall, "pared de calls del GEX");
  push("piso", "Piso (Put Wall)", gexStats?.put_wall, "pared de puts del GEX");

  // Resistencias/pisos secundarios: los 2 strikes con más GEX de calls arriba
  // y de puts abajo que no sean ya la pared principal.
  const taken = new Set(keyLevels.map((k) => k.spx));
  const secondary = (side: "above" | "below") =>
    near
      .filter((s) => (side === "above" ? s > spot : s < spot) && !taken.has(s))
      .map((s) => ({ s, g: side === "above" ? gexByStrike.get(s)?.callGex ?? 0 : gexByStrike.get(s)?.putGex ?? 0 }))
      .filter((x) => x.g > 0)
      .sort((a, b) => b.g - a.g)
      .slice(0, 2);
  for (const { s } of secondary("above")) push("resistencia", "Resistencia", s, "GEX de calls alto");
  for (const { s } of secondary("below")) push("piso", "Piso", s, "GEX de puts alto");

  push("gamma_flip", "Gamma flip", gexStats?.gamma_flip, "arriba: GEX positivo (calma) · abajo: negativo (volátil)");
  push("max_pain", "Max pain", gexStats?.max_pain, "donde más opciones vencen sin valor");

  // Charm + y Charm −: los strikes cercanos con más exposición charm de cada
  // signo — ahí es donde el paso del tiempo más mueve el delta de los
  // dealers, y su re-cobertura tiende a arrastrar el precio rumbo al cierre.
  // Los dos van bajo el mismo `kind` (un solo interruptor en la gráfica).
  let charmPos: number | null = null;
  let charmNeg: number | null = null;
  for (const s of near) {
    const c = charmByStrike.get(s) ?? 0;
    if (c > 0 && (charmPos == null || c > (charmByStrike.get(charmPos) ?? 0))) charmPos = s;
    if (c < 0 && (charmNeg == null || c < (charmByStrike.get(charmNeg) ?? 0))) charmNeg = s;
  }
  push("charm", "Charm +", charmPos, "mayor exposición charm positiva cerca del spot");
  push("charm", "Charm −", charmNeg, "mayor exposición charm negativa cerca del spot");

  keyLevels.sort((a, b) => b.spx - a.spx);

  // ── Dealers por strike ──
  const flowMagnitudes = allStrikes
    .filter((s) => Math.abs(s - spot) <= radius * 2)
    .flatMap((s) => {
      const p = premiums.get(s);
      return [Math.abs(p?.call?.netPremium ?? 0), Math.abs(p?.put?.netPremium ?? 0)];
    })
    .filter((v) => v > 0);
  const strongThreshold = percentile(flowMagnitudes, 0.7);

  const tagsAt = new Map<number, KeyLevelKind[]>();
  for (const k of keyLevels) {
    // Los niveles del GEX agregado pueden no caer justo en un strike listado.
    const nearestStrike = inWindow.reduce<number | null>(
      (best, s) => (best == null || Math.abs(s - k.spx) < Math.abs(best - k.spx) ? s : best),
      null,
    );
    if (nearestStrike == null || Math.abs(nearestStrike - k.spx) > 2.5) continue;
    tagsAt.set(nearestStrike, [...(tagsAt.get(nearestStrike) ?? []), k.kind]);
  }

  const rows: VisionStrikeRow[] = inWindow.map((strike) => {
    const g = gexByStrike.get(strike) ?? { callGex: 0, putGex: 0, netGex: 0 };
    const p = premiums.get(strike);
    const callFlow = p?.call?.netPremium ?? 0;
    const putFlow = p?.put?.netPremium ?? 0;
    const v = volume.get(strike) ?? { call: 0, put: 0 };
    const relevantFlow = strike >= spot ? Math.abs(callFlow) : Math.abs(putFlow);
    return {
      ...conv(strike),
      callGex: g.callGex, putGex: g.putGex, netGex: g.netGex,
      charm: charmByStrike.get(strike) ?? 0,
      callFlow, putFlow,
      compras: (p?.call?.askPremium ?? 0) + (p?.put?.askPremium ?? 0),
      ventas: (p?.call?.bidPremium ?? 0) + (p?.put?.bidPremium ?? 0),
      callVolume: v.call, putVolume: v.put,
      dealerCalls: sideOf(callFlow),
      dealerPuts: sideOf(putFlow),
      dealerRole: roleOf(strike, spot, callFlow, putFlow),
      strongFlow: strongThreshold > 0 && relevantFlow >= strongThreshold,
      tags: tagsAt.get(strike) ?? [],
    };
  });

  // Los niveles de dealers más pesados: por cada rol, los 2 strikes con más
  // premium del lado que define ese rol.
  const dealerLevels: DealerLevel[] = [];
  for (const role of ["resistencia", "acelera_arriba", "piso", "acelera_abajo"] as const) {
    const candidates = near
      .filter((s) => {
        const p = premiums.get(s);
        return roleOf(s, spot, p?.call?.netPremium ?? 0, p?.put?.netPremium ?? 0) === role;
      })
      .map((s) => {
        const p = premiums.get(s);
        const premium = role === "resistencia" || role === "acelera_arriba" ? p?.call?.netPremium ?? 0 : p?.put?.netPremium ?? 0;
        return { s, premium };
      })
      .filter((x) => strongThreshold === 0 || Math.abs(x.premium) >= strongThreshold)
      .sort((a, b) => Math.abs(b.premium) - Math.abs(a.premium))
      .slice(0, 2);
    for (const { s, premium } of candidates) {
      dealerLevels.push({ ...conv(s), role, premium, texto: ROLE_TEXT[role] });
    }
  }
  dealerLevels.sort((a, b) => b.spx - a.spx);

  // ── VIX → rango esperado del día ──
  let expectedMove: ExpectedMove | null = null;
  if (vix && vix.last > 0) {
    const points = spot * (vix.last / 100) / Math.sqrt(252);
    expectedMove = { points, low: conv(spot - points), high: conv(spot + points) };
  }

  const regime = gexStats ? (gexStats.net_gex >= 0 ? "positivo" : "negativo") : null;

  const netCharm = near.reduce((acc, s) => acc + (charmByStrike.get(s) ?? 0), 0);

  // ── Resumen en texto ──
  const resumen: string[] = [];
  if (regime === "positivo") resumen.push("GEX neto POSITIVO: los dealers amortiguan el movimiento — rangos cortos, tiende a pinear en los imanes.");
  if (regime === "negativo") resumen.push("GEX neto NEGATIVO: los dealers amplifican el movimiento — rupturas más largas, cuidado con los imanes negativos.");
  const withGex = rows.filter((r) => r.netGex !== 0);
  if (withGex.length >= 5 && withGex.filter((r) => r.netGex < 0).length / withGex.length >= 0.9) {
    resumen.push("⚠ Día de trampas: casi todos los strikes tienen GEX negativo — cualquier piso o techo que se rompa puede correr rápido.");
  }
  if (gexStats?.gamma_flip != null) {
    resumen.push(
      spot >= gexStats.gamma_flip
        ? `Precio ARRIBA del gamma flip (${gexStats.gamma_flip}): zona más tranquila.`
        : `Precio ABAJO del gamma flip (${gexStats.gamma_flip}): zona más volátil.`,
    );
  }
  const magneto = keyLevels.find((k) => k.kind === "magneto");
  if (magneto) {
    const d = magneto.distance;
    resumen.push(`El Magneto está ${Math.abs(d).toFixed(1)} pts ${d >= 0 ? "arriba" : "abajo"} del spot (${magneto.spx}).`);
  }
  const topRes = dealerLevels.filter((d) => d.role === "resistencia").sort((a, b) => a.spx - b.spx)[0];
  const topPiso = dealerLevels.filter((d) => d.role === "piso").sort((a, b) => b.spx - a.spx)[0];
  if (topRes) resumen.push(`Resistencia más cercana por dealers: ${topRes.spx}.`);
  if (topPiso) resumen.push(`Piso más cercano por dealers: ${topPiso.spx}.`);
  if (charmByStrike.size > 0) {
    const fmtM = (v: number) => `${v < 0 ? "−" : "+"}$${(Math.abs(v) / 1e6).toFixed(0)}M`;
    resumen.push(`Charm neto ${fmtM(netCharm)}${charmPos != null ? ` · Charm + en ${charmPos}` : ""}${charmNeg != null ? ` · Charm − en ${charmNeg}` : ""}.`);
  }
  if (expectedMove && vix) {
    resumen.push(
      `VIX ${vix.last.toFixed(2)} → movimiento esperado de hoy ±${expectedMove.points.toFixed(1)} pts (${expectedMove.low.spx.toFixed(0)}–${expectedMove.high.spx.toFixed(0)}).`,
    );
  }

  return {
    spot: conv(spot),
    conversion,
    regime,
    netGex: gexStats?.net_gex ?? null,
    keyLevels,
    dealerLevels,
    rows,
    vix,
    expectedMove,
    netCharm,
    resumen,
  };
}
