"use client";

// Nombres del instrumento elegido en VisionFutura (SPX/SPY//ES/VIX, NDX/QQQ//NQ/IV ATM,
// TSLA). La pestaña los provee; cada componente los lee en vez de tenerlos fijos.

import { createContext, useContext } from "react";
import type { InstrumentLabels } from "@/lib/visionFuturaInstruments";

export const DEFAULT_LABELS: InstrumentLabels = { main: "SPX", etf: "SPY", future: "/ES", vol: "VIX" };

export const VisionLabelsContext = createContext<InstrumentLabels>(DEFAULT_LABELS);

export const useVisionLabels = () => useContext(VisionLabelsContext);
