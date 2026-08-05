// Config de tickers seleccionables en "Agente ODTE". /ES y /NQ son alias de
// display para los futuros — no son subyacentes propios, reusan el chain/spot
// real de SPX y NDX respectivamente (mismo historial de calibración/flujo).

export type ZeroDteTickerId = "SPX" | "SPY" | "QQQ" | "ES" | "NQ";

export interface ZeroDteTickerConfig {
  id: ZeroDteTickerId;
  label: string;
  sublabel?: string;
  /** Ticker real que se pide a Schwab y con el que se guarda el estado en disco. */
  underlying: string;
}

export const ZERO_DTE_TICKERS: ZeroDteTickerConfig[] = [
  { id: "SPX", label: "SPX", underlying: "SPX" },
  { id: "SPY", label: "SPY", underlying: "SPY" },
  { id: "QQQ", label: "QQQ", underlying: "QQQ" },
  { id: "ES", label: "/ES", sublabel: "futuro · vía SPX", underlying: "SPX" },
  { id: "NQ", label: "/NQ", sublabel: "futuro · vía NDX", underlying: "NDX" },
];

export const DEFAULT_ZERO_DTE_TICKER: ZeroDteTickerId = "SPX";

/** Índices reales que necesitan el prefijo "$" en Schwab (las ETF no). */
export const INDEX_UNDERLYINGS = new Set(["SPX", "NDX"]);

export function zeroDteTickerConfig(id: string | null): ZeroDteTickerConfig {
  const found = ZERO_DTE_TICKERS.find((t) => t.id === (id ?? "").toUpperCase());
  return found ?? ZERO_DTE_TICKERS.find((t) => t.id === DEFAULT_ZERO_DTE_TICKER)!;
}
