// Instrumentos de VisionFutura (Carlos, oct 2026: "algo así como el selector de
// Agente 0DTE: SPX con SPY y /ES, NQ con QQQ y /NQ transformado, y TSLA solo con
// el valor de la acción"). Todo lo que antes estaba fijo a SPX sale de acá.
//
// Escala: los umbrales del motor (toque 3 pts, scalp 3/3, ventana ±60, etc.) están
// calibrados para SPX. Para otro instrumento se multiplican por
//   escala = movimiento diario esperado del instrumento / movimiento diario de referencia de SPX
// (movimiento diario = precio × IV ATM / √252; referencia SPX = 80 pts). SPX usa
// escala 1 fija para no cambiar nada de lo ya calibrado y backtesteado.

export type InstrumentId = "SPX" | "NQ" | "TSLA" | "ESN" | "NQN";

export interface InstrumentConfig {
  id: InstrumentId;
  /** Nombre en el selector. */
  label: string;
  /** Subyacente de las opciones (precio principal). */
  main: string;
  /** Ticker en MarketSnack (GEX, cadena, flujo, gráfica). */
  msTicker: string;
  /** Raíz OCC de las opciones diarias (para el flujo por contrato). */
  occRoot: string;
  /** Símbolo de la cadena anidada en tastytrade. */
  tastyChain: string;
  /** El subyacente en tastytrade: índice o acción. */
  tastyMain: { index?: string; equity?: string };
  /** Conversión 1: ETF equivalente (ratio). */
  etf: string | null;
  /** Conversión 2: futuro equivalente (base). Código de producto de CME. */
  future: string | null;
  /** Índice de volatilidad propio (VIX para SPX); null → IV ATM de su cadena. */
  volIndex: string | null;
  /** MarketSnack no tiene gráfica intradía del índice: se arma con el ETF × ratio. */
  chartFromEtf: boolean;
  /** Tiene opciones que vencen TODOS los días (0DTE diario). */
  dailyExpirations: boolean;
  /**
   * Modo noche 🌙: el instrumento ES el futuro (/ES, /NQ) y los niveles salen de sus
   * opciones de CME en tastytrade (operan casi 24 h), no de MarketSnack.
   * `mult` = $ por punto de la opción sobre el futuro (/ES $50, /NQ $20).
   */
  night?: { product: "ES" | "NQ"; mult: number; micro: string };
}

export const INSTRUMENTS: Record<InstrumentId, InstrumentConfig> = {
  SPX: {
    id: "SPX", label: "SPX", main: "SPX", msTicker: "SPX", occRoot: "SPXW", tastyChain: "SPX",
    tastyMain: { index: "SPX" }, etf: "SPY", future: "ES", volIndex: "VIX", chartFromEtf: false, dailyExpirations: true,
  },
  NQ: {
    id: "NQ", label: "NQ", main: "NDX", msTicker: "NDX", occRoot: "NDXP", tastyChain: "NDX",
    tastyMain: { index: "NDX" }, etf: "QQQ", future: "NQ", volIndex: null, chartFromEtf: true, dailyExpirations: true,
  },
  TSLA: {
    id: "TSLA", label: "TSLA", main: "TSLA", msTicker: "TSLA", occRoot: "TSLA", tastyChain: "TSLA",
    tastyMain: { equity: "TSLA" }, etf: null, future: null, volIndex: null, chartFromEtf: false, dailyExpirations: false,
  },
  ESN: {
    id: "ESN", label: "🌙 /ES noche", main: "/ES", msTicker: "", occRoot: "", tastyChain: "ES",
    tastyMain: {}, etf: null, future: null, volIndex: null, chartFromEtf: false, dailyExpirations: true,
    night: { product: "ES", mult: 50, micro: "/MES" },
  },
  NQN: {
    id: "NQN", label: "🌙 /NQ noche", main: "/NQ", msTicker: "", occRoot: "", tastyChain: "NQ",
    tastyMain: {}, etf: null, future: null, volIndex: null, chartFromEtf: false, dailyExpirations: true,
    night: { product: "NQ", mult: 20, micro: "/MNQ" },
  },
};

export const isNight = (cfg: InstrumentConfig | InstrumentId | string | null | undefined): boolean =>
  !!(typeof cfg === "object" && cfg ? cfg.night : instrumentOf(cfg as string).night);

export function instrumentOf(id: string | null | undefined): InstrumentConfig {
  return INSTRUMENTS[(id ?? "SPX").toUpperCase() as InstrumentId] ?? INSTRUMENTS.SPX;
}

/** Nombres que muestra la pantalla para cada instrumento. */
export interface InstrumentLabels {
  main: string;
  etf: string | null;
  future: string | null;
  vol: string;
}

export function labelsOf(cfg: InstrumentConfig, futureSymbol?: string | null): InstrumentLabels {
  if (cfg.night) return { main: futureSymbol ?? cfg.main, etf: null, future: null, vol: "IV ATM" };
  return {
    main: cfg.main,
    etf: cfg.etf,
    future: cfg.future ? futureSymbol ?? `/${cfg.future}` : null,
    vol: cfg.volIndex ?? "IV ATM",
  };
}

/**
 * Volatilidad relativa a SPX cuando el instrumento no tiene una IV confiable propia:
 * el Nasdaq 100 se mueve típicamente ~20% más que el S&P 500.
 */
export const REL_VOL: Partial<Record<InstrumentId, number>> = { NQ: 1.2, NQN: 1.2 };

/**
 * Escala de los umbrales = cuánto se mueve el instrumento en un día comparado con SPX.
 *   SPX: 1 (fijo, no cambia nada de lo calibrado).
 *   /ES noche: 1 (mismo índice, distinta base).
 *   NQ:  (NDX ÷ SPX) × 1.2 (de noche: /NQ ÷ /ES × 1.2) — estable; la IV de las opciones de NDX de corto plazo sale
 *        inflada fuera de horario (vista en 37% el 2026-10-22 de noche).
 *   TSLA (y acciones): (precio × IV ATM) ÷ (SPX × VIX/100).
 */
export function scaleFor(
  cfg: InstrumentConfig,
  spot: number,
  ref: { spxSpot: number | null; vix: number | null; atmIv: number | null },
): number {
  // /ES de noche se mueve igual que SPX (solo cambia la base): mismos umbrales.
  if (cfg.id === "SPX" || cfg.id === "ESN") return 1;
  const spx = ref.spxSpot && ref.spxSpot > 0 ? ref.spxSpot : 7000;
  const rel = REL_VOL[cfg.id];
  let scale: number;
  if (rel) scale = (spot / spx) * rel;
  else {
    const iv = ref.atmIv && ref.atmIv > 0.05 && ref.atmIv < 3 ? ref.atmIv : 0.45;
    const vix = ref.vix && ref.vix > 5 ? ref.vix / 100 : 0.18;
    scale = (spot * iv) / (spx * vix);
  }
  return Math.round(scale * 1000) / 1000;
}

/** Paso más común entre strikes cerca del precio (5 en SPX, 10 en NDX, 2.5/5 en TSLA…). */
export function strikeStepNear(strikes: number[], spot: number): number {
  const near = [...new Set(strikes)].filter((k) => Math.abs(k - spot) <= spot * 0.03).sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (let i = 1; i < near.length; i++) {
    const d = Math.round((near[i] - near[i - 1]) * 100) / 100;
    if (d > 0) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best = 5, n = 0;
  for (const [d, c] of counts) if (c > n || (c === n && d < best)) { best = d; n = c; }
  return best;
}
