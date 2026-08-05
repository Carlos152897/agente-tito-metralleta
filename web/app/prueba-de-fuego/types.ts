import type { ContractSuggestion } from "@/lib/dayTrade";
import type { GexStatsBucket, SpxLevelRow, TopVolumeContract } from "@/lib/spxLevels";

// ── Pestañas TSLA / SPX (day-trading en vivo) ───────────────────────────────

export type DayTradeSseEvent =
  | { type: "step"; label: string }
  | {
      type: "done";
      spot: number;
      target: number | null;
      direction: "up" | "down" | "flat" | null;
      /** Ausente en motores sin GEX (ej. /api/daytrade-wall, "SPX vecinos"). */
      confidence?: number;
      suggestion: ContractSuggestion | null;
      marketOpen: boolean;
      /** Por qué no hay sugerencia todavía aunque no sea error (ej. "primeros 15 min"). */
      waitingReason?: string | null;
    }
  | { type: "error"; message: string };

// ── Pestaña "Búsqueda de contratos" (todo el mercado) ───────────────────────

/**
 * GEX de referencia — SOLO para índices/ETFs líquidos (SPY, SPX, QQQ). Pedido
 * explícito de Carlos (2026-07-28): el target real de "Búsqueda de contratos"
 * sale del movimiento esperado por IV/DTE (ver lib/contractSearch.ts), NUNCA
 * del GEX, para no correrlo por candidato escaneando todo el mercado — pero
 * cuando el candidato SÍ es uno de esos tres, se calcula una vez como dato de
 * referencia adicional (no reemplaza el target, no filtra candidatos).
 */
export interface GexReference {
  direction: "up" | "down" | "flat" | null;
  kingStrike: number | null;
  confidence: number;
  regime: "positive" | "negative";
}

/**
 * Contratos vecinos de referencia (net premium real de call vs put por strike,
 * ver lib/neighborContracts.ts) — a diferencia del GEX, esto SÍ aplica a
 * cualquier ticker (MarketSnack siempre es la fuente de flujo). Informativo:
 * no filtra candidatos ni reemplaza `estimateTarget`.
 */
export interface NeighborReference {
  confirms: boolean;
  flipStrike: number | null;
}

export interface FavoriteContract {
  ticker: string;
  symbol: string;
  type: "call" | "put";
  strike: number | null;
  expiration: string | null;
  premium: number;
  size: number;
  delta: number;
  assetPrice: number;
  target: number | null;
  convictionPct: number | null;
  changePctToTarget: number | null;
  estUsdGain: number | null;
  timestamp: string;
  gexReference: GexReference | null;
  neighborReference: NeighborReference | null;
}

export type ContractSearchSseEvent =
  | { type: "step"; label: string }
  | { type: "done"; favorites: FavoriteContract[]; meta: { scanned: number; pages: number; truncated: boolean } }
  | { type: "error"; message: string };

// ── "Soportes y Resistencias en vivo — SPX" (lib/spxLevels.ts) ──────────────

export interface SpxLevelsResponse {
  spot: number;
  expiration: string;
  gexStats: GexStatsBucket | null;
  rows: SpxLevelRow[];
  topVolume: { calls: TopVolumeContract[]; puts: TopVolumeContract[] };
}
