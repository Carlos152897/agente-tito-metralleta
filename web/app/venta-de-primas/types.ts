// Tipos del evento SSE del screener de Venta de Primas. Ver app/api/venta-de-primas/route.ts.

import type { CreditSpreadCandidate } from "@/lib/creditSpreads";

export interface VentaPrimasStepEvent {
  type: "step";
  label: string;
}

export interface VentaPrimasDoneEvent {
  type: "done";
  candidates: CreditSpreadCandidate[];
  meta: {
    scanned: number;
    failed: number;
    /** Tickers distintos con al menos un candidato. */
    withCandidates: number;
    /** true si falló más de la mitad del universo. */
    degraded: boolean;
    dteMin: number;
    dteMax: number;
    /** Cuántas filas (candidatos) tienen resultados antes del vencimiento. */
    earningsWithinCount: number;
    /** Veredicto de mercado agregado: realizada vs. implícita en todo el universo escaneado. */
    marketVerdict: { realizedAvg: number; impliedAvg: number; cheap: boolean; n: number } | null;
    /** Minutos de retraso declarados de la fuente de cotizaciones. */
    quoteDelayMinutes: number;
  };
}

export interface VentaPrimasErrorEvent {
  type: "error";
  message: string;
}

export type VentaPrimasSseEvent = VentaPrimasStepEvent | VentaPrimasDoneEvent | VentaPrimasErrorEvent;
