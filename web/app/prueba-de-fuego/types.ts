import type { ContractSuggestion } from "@/lib/dayTrade";
import type { ContradictionFlag } from "@/lib/news";
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

// ── Pestaña "Búsqueda de contratos" (S&P 500, acumulación real) ─────────────

export interface FavoriteContract {
  ticker: string;
  companyName: string | null;
  symbol: string;
  type: "call" | "put";
  strike: number | null;
  expiration: string | null;
  dte: number | null;
  premium: number;
  size: number;
  volume: number;
  openInterest: number;
  delta: number;
  assetPrice: number;
  target1: number | null;
  convictionPct1: number | null;
  changePctToTarget1: number | null;
  estUsdGain1: number | null;
  target2: number | null;
  convictionPct2: number | null;
  changePctToTarget2: number | null;
  estUsdGain2: number | null;
  timestamp: string;
  /** Best-effort — null si el chequeo de noticias falló o no había dirección clara. */
  newsFlag: ContradictionFlag | null;
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
