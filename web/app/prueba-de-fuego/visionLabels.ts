"use client";

// Nombres del instrumento elegido en VisionFutura (SPX/SPY//ES/VIX, NDX/QQQ//NQ/IV ATM,
// TSLA). La pestaña los provee; cada componente los lee en vez de tenerlos fijos.

import { createContext, useContext } from "react";
import type { InstrumentLabels } from "@/lib/visionFuturaInstruments";

export const DEFAULT_LABELS: InstrumentLabels = { main: "SPX", etf: "SPY", future: "/ES", vol: "VIX" };

export const VisionLabelsContext = createContext<InstrumentLabels>(DEFAULT_LABELS);

export const useVisionLabels = () => useContext(VisionLabelsContext);

/**
 * Futuro primero (Carlos, 27-oct-2026: "para el botón de NQ, en los 3 motores ponme los valores del
 * /NQZ6, voy a operar futuros"): con NQ, entrada/stop/objetivo se muestran primero en el futuro
 * activo (NDX + base real del momento). La base solo existe en vivo: en la repetición `basis` es
 * null y se muestra el índice con un aviso.
 */
export interface FutureFirst {
  on: boolean;
  /** Contrato del futuro (ej. "/NQZ6"). */
  label: string | null;
  /** Base futuro − índice del momento (null = no hay, ej. en la repetición). */
  basis: number | null;
}

export const FutureFirstContext = createContext<FutureFirst>({ on: false, label: null, basis: null });

export const useFutureFirst = () => useContext(FutureFirstContext);

/**
 * Precio en el futuro (índice + base) si aplica; null si no hay base. `basis` = la base guardada
 * cuando salió la entrada (la de ahora cambia: después del cierre incluye lo que se movió de noche).
 */
export const toFuture = (ff: FutureFirst, v: number, basis: number | null | undefined = ff.basis): number | null =>
  ff.on && basis != null ? Math.round((v + basis) * 100) / 100 : null;
