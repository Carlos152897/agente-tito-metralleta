// "Grandes empresas" (Prueba de Fuego, ago 2026, pedido explícito de Carlos):
// universo curado — las Magnificent Seven (AAPL, MSFT, GOOGL, AMZN, NVDA,
// META, TSLA) + PLTR, IREN, NFLX, SPCX, INTC, ORCL. Reusa el motor de
// "Contratos vecinos 3.0" (lib/contratosVecinos3.ts) tal cual — solo cambia
// de dónde sale la cadena de opciones (Massive, vencimiento más cercano
// disponible, no 0DTE fijo de índice — ver lib/massive.ts `fetchNearTermChain`).

export interface GrandesEmpresaTicker {
  id: string;
  label: string;
}

export const GRANDES_EMPRESAS: GrandesEmpresaTicker[] = [
  { id: "AAPL", label: "AAPL" },
  { id: "MSFT", label: "MSFT" },
  { id: "GOOGL", label: "GOOGL" },
  { id: "AMZN", label: "AMZN" },
  { id: "NVDA", label: "NVDA" },
  { id: "META", label: "META" },
  { id: "TSLA", label: "TSLA" },
  { id: "PLTR", label: "PLTR" },
  { id: "IREN", label: "IREN" },
  { id: "NFLX", label: "NFLX" },
  { id: "SPCX", label: "SPCX" },
  { id: "INTC", label: "INTC" },
  { id: "ORCL", label: "ORCL" },
];

export const GRANDES_EMPRESAS_TICKERS = new Set(GRANDES_EMPRESAS.map((t) => t.id));
export const DEFAULT_GRANDES_EMPRESA = "AAPL";

/**
 * Ventana de vencimiento que se pide a Massive (`fetchNearTermChain`). 21
 * días de margen: la mayoría de esta lista tiene opciones semanales (el
 * próximo vencimiento cae dentro de 7 días), pero no todas tienen diarias —
 * de menos margen se corre el riesgo de no encontrar NINGÚN vencimiento para
 * un ticker de solo mensuales.
 */
export const NEAR_TERM_DTE_MAX = 21;
