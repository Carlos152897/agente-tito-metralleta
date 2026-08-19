"use client";

// Selector de idioma ES/EN (ago 2026, pedido explícito de Carlos: "que el proyecto
// sea factible para personas que hablen inglés o español"). Diccionario simple por
// namespaces + interpolación {var}, sin dependencias nuevas. Empieza cubriendo el
// chrome global (nav/header/hero) y la vista Estudiante — la vista Pro y el resto de
// páginas (Ideas/Wheel/Venta de Primas/Prueba de Fuego/etc.) siguen en español por
// ahora y quedan como siguiente etapa.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "es" | "en";

const STORAGE_KEY = "visionary.locale";

type Dict = { [key: string]: string | Dict };

const es: Dict = {
  common: {
    search: "Buscar",
  },
  nav: {
    ticker: "Ticker",
    ideas: "Ideas",
    wheel: "Wheel",
    ventaDePrimas: "Venta de Primas",
    timeSales: "Time & Sales",
    pruebaDeFuego: "Prueba de Fuego",
    unusualSwing: "Unusual Swing Trades",
    ajustes: "Ajustes",
    sections: "Secciones",
  },
  header: {
    searchPlaceholder: "Buscar ticker…",
  },
  hero: {
    searchPlaceholder: "¿Qué ticker querés analizar?",
    open: "Abierto",
    closed: "Cerrado",
  },
  view: {
    estudiante: "Estudiante",
    pro: "Pro",
  },
  horizon: {
    week: "Esta semana",
    twoWeeks: "2 semanas",
    month: "1 mes",
    label1: "1 semana",
    label2: "2 semanas",
    label4: "4 semanas",
  },
  disclaimer: {
    predictions: "Las predicciones son estimaciones de IA, no consejo financiero.",
  },
  detail: {
    summary: "Detalle de sub-agentes — las tablas y promedios que alimentan Prediction Pro",
    optionChain: "Option Chain completo",
    contracts: "contratos",
  },
  verdict: {
    loading: "Armando la lectura de {ticker}…",
    unreliable: "Datos no fiables — no operar",
    confHigh: "confianza alta",
    confMed: "confianza media",
    confLow: "confianza baja",
    up: "Probablemente SUBE",
    down: "Probablemente BAJA",
    flat: "Se mueve LATERAL",
    toward: "hacia",
    over: "· en las próximas ~{horizon}",
    adjusted: "🧠 ajustado {sign}{pct}%",
    adjustedTitle: "El agente históricamente apunta {dir}; se ajustó el target {sign}{pct}% con {samples} predicciones vencidas.",
    dirLow: "bajo",
    dirHigh: "alto",
  },
  scenarios: {
    title: "Los 3 caminos posibles",
    sub: "Ningún precio es seguro. Estos son los tres escenarios que el agente ve, con qué tan probable es llegar a cada uno en el horizonte elegido.",
    bear: "Bajista",
    base: "Base (lo más probable)",
    bull: "Alcista",
    touchChance: "{pct}% de tocarlo",
  },
  context: {
    loading: "📰 Leyendo noticias de {ticker}…",
    positive: "Noticias positivas",
    negative: "Noticias negativas",
    mixed: "Noticias mixtas",
    neutral: "Sin noticias marcadas",
    about: "sobre {ticker}",
    confirms: "coincide con el flujo ✓",
    conflicts: "contradice al flujo ⚠",
  },
  levels: {
    titleEmpty: "Precios clave",
    subEmpty: "Todavía no hay soportes ni resistencias claros para este ticker.",
    title: "Precios clave — ¿hasta dónde puede llegar?",
    sub: "Zonas donde el precio suele frenar. La probabilidad es qué tan factible es que lo toque en las próximas ~{horizon}.",
    price: "Precio",
    type: "Tipo",
    distance: "Distancia",
    probability: "Probabilidad",
    support: "🟢 Soporte",
    resistance: "🔴 Resistencia",
    flipped: "Antes hacía de lo contrario",
  },
  memory: {
    title: "🧠 Memoria del agente — ¿qué tan bien predijo antes?",
    sub: "Cada día el agente guarda su predicción y la compara con lo que la acción hizo después. Así mide su error y va afinando los targets. El historial se acumula con el tiempo.",
    loading: "Leyendo la memoria de {ticker}…",
    emptyLead: "Aún no hay predicciones vencidas para {ticker}",
    emptySaved: " ({total} guardada{plural}, esperando a que pase el horizonte).",
    emptyPeriod: ".",
    emptyTail: " Vuelve en unos días para ver qué tan cerca quedó.",
    avgError: "Error medio del target",
    avgErrorSub: "sobre {n} predicción{plural}",
    dirAccuracy: "Acierto de dirección",
    dirAccuracySub: "¿subió/bajó como dijo?",
    touchedBase: "Tocó el target base",
    touchedBaseSub: "llegó al precio previsto",
    bias: "Sesgo",
    biasLow: "suele apuntar bajo",
    biasHigh: "suele apuntar alto",
    biasGood: "bien calibrado",
    colDate: "Fecha",
    colPredicted: "Predijo",
    colActual: "Real",
    colError: "Error",
    inProgress: "· en curso",
    hit: "acertó {label}",
    bear: "Bajista",
    base: "Base",
    bull: "Alcista",
  },
};

const en: Dict = {
  common: {
    search: "Search",
  },
  nav: {
    ticker: "Ticker",
    ideas: "Ideas",
    wheel: "Wheel",
    ventaDePrimas: "Premium Selling",
    timeSales: "Time & Sales",
    pruebaDeFuego: "Live Trading",
    unusualSwing: "Unusual Swing Trades",
    ajustes: "Settings",
    sections: "Sections",
  },
  header: {
    searchPlaceholder: "Search ticker…",
  },
  hero: {
    searchPlaceholder: "What ticker do you want to analyze?",
    open: "Open",
    closed: "Closed",
  },
  view: {
    estudiante: "Student",
    pro: "Pro",
  },
  horizon: {
    week: "This week",
    twoWeeks: "2 weeks",
    month: "1 month",
    label1: "1 week",
    label2: "2 weeks",
    label4: "4 weeks",
  },
  disclaimer: {
    predictions: "Predictions are AI estimates, not financial advice.",
  },
  detail: {
    summary: "Sub-agent detail — the tables and averages behind Prediction Pro",
    optionChain: "Full Option Chain",
    contracts: "contracts",
  },
  verdict: {
    loading: "Reading {ticker}…",
    unreliable: "Unreliable data — don't trade",
    confHigh: "high confidence",
    confMed: "medium confidence",
    confLow: "low confidence",
    up: "Likely to RISE",
    down: "Likely to FALL",
    flat: "Moving SIDEWAYS",
    toward: "toward",
    over: "· over the next ~{horizon}",
    adjusted: "🧠 adjusted {sign}{pct}%",
    adjustedTitle: "The agent has historically aimed too {dir}; the target was adjusted {sign}{pct}% using {samples} matured predictions.",
    dirLow: "low",
    dirHigh: "high",
  },
  scenarios: {
    title: "The 3 possible paths",
    sub: "No price is certain. These are the three scenarios the agent sees, with how likely it is to reach each one within the chosen horizon.",
    bear: "Bearish",
    base: "Base (most likely)",
    bull: "Bullish",
    touchChance: "{pct}% chance to touch it",
  },
  context: {
    loading: "📰 Reading news for {ticker}…",
    positive: "Positive news",
    negative: "Negative news",
    mixed: "Mixed news",
    neutral: "No notable news",
    about: "about {ticker}",
    confirms: "matches the flow ✓",
    conflicts: "contradicts the flow ⚠",
  },
  levels: {
    titleEmpty: "Key price levels",
    subEmpty: "There aren't clear support or resistance levels for this ticker yet.",
    title: "Key price levels — how far could it go?",
    sub: "Zones where the price tends to stall. The probability is how likely it is to touch it within the next ~{horizon}.",
    price: "Price",
    type: "Type",
    distance: "Distance",
    probability: "Probability",
    support: "🟢 Support",
    resistance: "🔴 Resistance",
    flipped: "Used to do the opposite",
  },
  memory: {
    title: "🧠 Agent memory — how accurate were past predictions?",
    sub: "Every day the agent saves its prediction and compares it against what the stock did afterward. That's how it measures its error and keeps refining its targets. The track record builds up over time.",
    loading: "Reading {ticker}'s memory…",
    emptyLead: "No matured predictions yet for {ticker}",
    emptySaved: " ({total} saved{plural}, waiting for the horizon to pass).",
    emptyPeriod: ".",
    emptyTail: " Check back in a few days to see how close it landed.",
    avgError: "Average target error",
    avgErrorSub: "across {n} prediction{plural}",
    dirAccuracy: "Direction accuracy",
    dirAccuracySub: "did it move as predicted?",
    touchedBase: "Hit the base target",
    touchedBaseSub: "reached the predicted price",
    bias: "Bias",
    biasLow: "tends to aim low",
    biasHigh: "tends to aim high",
    biasGood: "well calibrated",
    colDate: "Date",
    colPredicted: "Predicted",
    colActual: "Actual",
    colError: "Error",
    inProgress: "· in progress",
    hit: "hit {label}",
    bear: "Bearish",
    base: "Base",
    bull: "Bullish",
  },
};

const DICTS: Record<Locale, Dict> = { es, en };

function lookup(dict: Dict, path: string): string | undefined {
  const parts = path.split(".");
  let cur: Dict[string] = dict;
  for (const p of parts) {
    if (typeof cur !== "object" || cur == null) return undefined;
    cur = (cur as Dict)[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "es";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "es" || saved === "en") return saved;
  const nav = window.navigator.language?.toLowerCase() ?? "";
  return nav.startsWith("en") ? "en" : "es";
}

export interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<LocaleCtx | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("es");

  // El servidor siempre renderiza "es" (coincide con <html lang="es">); recién en el
  // cliente se lee localStorage/idioma del navegador, para no romper la hidratación.
  useEffect(() => {
    setLocale(detectInitialLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const t = useMemo(() => {
    return (key: string, vars?: Record<string, string | number>) => {
      const raw = lookup(DICTS[locale], key) ?? lookup(DICTS.es, key) ?? key;
      if (!vars) return raw;
      return Object.entries(vars).reduce(
        (acc, [k, v]) => acc.split(`{${k}}`).join(String(v)),
        raw,
      );
    };
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

/** "1 semana"/"1 week" · "2 semanas"/"2 weeks" · "4 semanas"/"4 weeks" según los 3 horizontes fijos (10/20/30 días). */
export function horizonLabel(t: LocaleCtx["t"], days: number): string {
  return days === 10 ? t("horizon.label1") : days === 20 ? t("horizon.label2") : t("horizon.label4");
}
