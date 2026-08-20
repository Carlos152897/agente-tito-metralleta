// "Análisis del mercado" (ago 2026, pedido explícito de Carlos, a partir de
// su propia guía `Guía Cómo Leer el Mercado.md` — trader de futuros NQ en
// NinjaTrader). Traduce el marco de la guía (Risk ON/Risk OFF, correlaciones
// entre índices/VIX/bono 10 años/dólar/materias primas/bitcoin, la "rutina
// de 8 pasos" de la sección 6) a una puntuación pura y un resumen en
// palabras sencillas. PURA — el fetch de cotizaciones/noticias vive en
// app/api/market-analysis/route.ts.

export type InstrumentKey = "NQ" | "ES" | "YM" | "RTY" | "VIX" | "ZN" | "GC" | "CL" | "BTC" | "DXY";

export interface MacroReading {
  key: InstrumentKey;
  label: string;
  last: number;
  prevClose: number;
  changePct: number;
}

export type SignalLean = "risk_on" | "risk_off" | "neutral";

export interface RiskSignal {
  label: string;
  lean: SignalLean;
  detail: string;
}

export type RiskRegime = "risk_on" | "risk_off" | "mixto";

export interface MarketAnalysis {
  regime: RiskRegime;
  regimeLabel: string;
  score: number;
  signals: RiskSignal[];
  breadthWarning: string | null;
  summary: string;
  oneLiner: string;
  simpleSummary: string;
}

const REGIME_LABEL: Record<RiskRegime, string> = {
  risk_on: "🟢 Apetito por riesgo (Risk ON)",
  risk_off: "🔴 Aversión al riesgo (Risk OFF)",
  mixto: "🟡 Mercado mixto / sin dirección clara",
};

const leanScore: Record<SignalLean, number> = { risk_on: 1, risk_off: -1, neutral: 0 };

function get(readings: MacroReading[], key: InstrumentKey): MacroReading | null {
  return readings.find((r) => r.key === key) ?? null;
}

/** VIX en NIVEL (no cambio): bandas de la guía — calma <15, normal 15-20, nervioso 20-25, pánico 25+. */
export function vixBand(level: number): { label: string; lean: SignalLean } {
  if (level < 15) return { label: "calma/complacencia", lean: "risk_on" };
  if (level < 20) return { label: "normal", lean: "neutral" };
  if (level < 25) return { label: "nervioso", lean: "risk_off" };
  return { label: "miedo/pánico", lean: "risk_off" };
}

/**
 * Arma las señales individuales (uno por instrumento/regla de la guía) y el
 * puntaje agregado. Cada señal es independiente y se explica en `detail` —
 * el usuario puede ver el "por qué" de cada una, no solo el veredicto final.
 */
export function buildSignals(readings: MacroReading[]): RiskSignal[] {
  const signals: RiskSignal[] = [];

  const nq = get(readings, "NQ");
  const es = get(readings, "ES");
  const ym = get(readings, "YM");
  const equities = [nq, es, ym].filter((r): r is MacroReading => r != null);
  if (equities.length > 0) {
    const avg = equities.reduce((s, r) => s + r.changePct, 0) / equities.length;
    const lean: SignalLean = avg > 0.15 ? "risk_on" : avg < -0.15 ? "risk_off" : "neutral";
    signals.push({
      label: "Índices principales",
      lean,
      detail: `Promedio Nasdaq/S&P/Dow ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}% — ${
        lean === "risk_on" ? "suben" : lean === "risk_off" ? "bajan" : "planos"
      }.`,
    });
  }

  const vix = get(readings, "VIX");
  if (vix) {
    const band = vixBand(vix.last);
    // Regla de la guía: VIX SUBIENDO fuerte casi siempre acompaña a acciones
    // bajando — el cambio del día pesa tanto como el nivel.
    const changeLean: SignalLean = vix.changePct > 5 ? "risk_off" : vix.changePct < -5 ? "risk_on" : "neutral";
    const lean = band.lean === "neutral" ? changeLean : band.lean;
    signals.push({
      label: "VIX (miedo)",
      lean,
      detail: `${vix.last.toFixed(2)} (${band.label}), ${vix.changePct >= 0 ? "+" : ""}${vix.changePct.toFixed(1)}% hoy.`,
    });
  }

  // Bono a 10 años: proxy vía futuro de la nota (ZN) — precio SUBE = yield
  // BAJA (bueno para NQ); precio BAJA = yield SUBE (regla #1 de la guía,
  // "sospecha de mal día para el NQ").
  const zn = get(readings, "ZN");
  if (zn) {
    const yieldsRising = zn.changePct < -0.1;
    const yieldsFalling = zn.changePct > 0.1;
    const lean: SignalLean = yieldsFalling ? "risk_on" : yieldsRising ? "risk_off" : "neutral";
    signals.push({
      label: "Bono a 10 años (vía futuro de nota)",
      lean,
      detail: yieldsRising
        ? "El precio del bono baja → el rendimiento (yield) está SUBIENDO — presión típica sobre el Nasdaq."
        : yieldsFalling
          ? "El precio del bono sube → el rendimiento (yield) está BAJANDO — viento a favor para el Nasdaq."
          : "Yields sin movimiento fuerte.",
    });
  }

  const dxy = get(readings, "DXY");
  if (dxy) {
    const lean: SignalLean = dxy.changePct > 0.3 ? "risk_off" : dxy.changePct < -0.3 ? "risk_on" : "neutral";
    signals.push({
      label: "Dólar (DXY)",
      lean,
      detail: `${dxy.changePct >= 0 ? "+" : ""}${dxy.changePct.toFixed(2)}% — ${
        lean === "risk_off" ? "dólar fuerte, cuidado con multinacionales/materias primas" : lean === "risk_on" ? "dólar débil, viento a favor de acciones" : "estable"
      }.`,
    });
  }

  const cl = get(readings, "CL");
  if (cl) {
    const lean: SignalLean = cl.changePct > 0.5 ? "risk_on" : cl.changePct < -0.5 ? "risk_off" : "neutral";
    signals.push({ label: "Petróleo (WTI)", lean, detail: `${cl.changePct >= 0 ? "+" : ""}${cl.changePct.toFixed(2)}% hoy.` });
  }

  const btc = get(readings, "BTC");
  if (btc) {
    const lean: SignalLean = btc.changePct > 0.5 ? "risk_on" : btc.changePct < -0.5 ? "risk_off" : "neutral";
    signals.push({ label: "Bitcoin", lean, detail: `${btc.changePct >= 0 ? "+" : ""}${btc.changePct.toFixed(2)}% hoy.` });
  }

  const gc = get(readings, "GC");
  if (gc) {
    // El oro es ambiguo solo: sube por miedo (risk off) O por apuesta a
    // baja de tasas junto con acciones (risk on). Se resuelve cruzándolo
    // con las acciones más abajo (breadthWarning/oneLiner), acá queda
    // neutral a propósito — es informativo, no una señal direccional sola.
    signals.push({ label: "Oro", lean: "neutral", detail: `${gc.changePct >= 0 ? "+" : ""}${gc.changePct.toFixed(2)}% hoy.` });
  }

  return signals;
}

/** Rally angosto: Nasdaq sube fuerte pero Russell 2000 (empresas chicas) se queda atrás — regla #4 de la guía. */
export function breadthWarning(readings: MacroReading[]): string | null {
  const nq = get(readings, "NQ");
  const rty = get(readings, "RTY");
  if (!nq || !rty) return null;
  if (nq.changePct > 0.4 && nq.changePct - rty.changePct > 0.8) {
    return `El Nasdaq sube ${nq.changePct.toFixed(2)}% pero el Russell 2000 (empresas chicas) solo ${rty.changePct.toFixed(2)}% — el rally lo están llevando pocas mega-caps, más frágil de lo que parece.`;
  }
  return null;
}

/** Oro y Bitcoin subiendo AL MISMO TIEMPO que las acciones — regla #5: apuesta a baja de tasas. */
function rateCutBet(readings: MacroReading[]): boolean {
  const nq = get(readings, "NQ");
  const gc = get(readings, "GC");
  const btc = get(readings, "BTC");
  return !!(nq && gc && btc && nq.changePct > 0.2 && gc.changePct > 0.3 && btc.changePct > 0.3);
}

function magnitudeWord(pct: number): string {
  const a = Math.abs(pct);
  if (a < 0.2) return "casi sin moverse";
  if (a < 0.6) return "un poco";
  if (a < 1.5) return "bastante";
  return "mucho";
}

/**
 * Explicación "de niño pequeño" (pedido explícito de Carlos): sin nombres de
 * instrumentos, sin porcentajes, sin jerga — la CONCLUSIÓN nada más, en
 * frases cortas y cotidianas, terminando en la dirección probable. Reusa las
 * mismas señales ya calculadas (no vuelve a decidir nada distinto), solo las
 * traduce a otro idioma. PURA.
 */
export function buildKidSimpleSummary(
  regime: RiskRegime, readings: MacroReading[], bw: string | null, cutBet: boolean,
): string {
  const nq = get(readings, "NQ");
  const vix = get(readings, "VIX");
  const zn = get(readings, "ZN");
  const dxy = get(readings, "DXY");

  const sentences: string[] = [];

  sentences.push(
    regime === "risk_on"
      ? "Hoy el mercado está de buen humor: la mayoría de las cosas que miramos están subiendo o tranquilas."
      : regime === "risk_off"
        ? "Hoy el mercado está de mal humor: la mayoría de las cosas que miramos están cayendo o nerviosas."
        : "Hoy el mercado está indeciso: unas cosas suben y otras bajan, sin que nadie mande claramente.",
  );

  if (vix) {
    const band = vixBand(vix.last);
    sentences.push(
      band.lean === "risk_on"
        ? "La gente no está asustada — nadie está corriendo a vender por miedo."
        : band.lean === "risk_off"
          ? "Hay bastante nerviosismo dando vueltas — más gente de lo normal está a la defensiva."
          : "El nivel de miedo está en un punto normal, ni tranquilo ni asustado.",
    );
  }

  if (zn) {
    const risingYields = zn.changePct < -0.1;
    const fallingYields = zn.changePct > 0.1;
    if (risingYields) sentences.push("Pedir dinero prestado se está poniendo un poco más caro, y eso generalmente no le gusta a las empresas de tecnología.");
    else if (fallingYields) sentences.push("Pedir dinero prestado se está poniendo un poco más barato, y eso generalmente ayuda a las empresas de tecnología.");
  }

  if (dxy) {
    if (dxy.changePct > 0.3) sentences.push("El dólar está más fuerte que de costumbre, lo que no siempre ayuda a las acciones.");
    else if (dxy.changePct < -0.3) sentences.push("El dólar está más débil que de costumbre, lo que generalmente le da un empujón a las acciones.");
  }

  if (bw) sentences.push("Ojo: la subida la están llevando pocas empresas muy grandes, no el mercado parejo — eso lo hace más frágil de lo que parece a simple vista.");
  if (cutBet) sentences.push("Varias señales distintas se están moviendo juntas hacia arriba, como si el mercado estuviera apostando a que el dinero se va a poner más barato pronto.");

  const direction =
    regime === "risk_on"
      ? "Con todo esto junto, lo más probable es que el mercado siga con ganas de subir por ahora — aunque esto puede cambiar en cualquier momento, nunca es una garantía."
      : regime === "risk_off"
        ? "Con todo esto junto, hay más chance de que el mercado siga cayendo o se mueva fuerte hoy — mejor ser más cuidadoso de lo normal."
        : "Con todo esto junto, no hay una dirección clara todavía — podría irse para cualquier lado, así que mejor no apostar fuerte a un solo camino." +
          (nq ? ` (por ahora ${nq.changePct >= 0 ? "sube" : "baja"} ${magnitudeWord(nq.changePct)}).` : "");
  sentences.push(direction);

  return sentences.join(" ");
}

export function analyzeMarket(readings: MacroReading[]): MarketAnalysis {
  const signals = buildSignals(readings);
  const score = signals.reduce((s, sig) => s + leanScore[sig.lean], 0);
  const regime: RiskRegime = score >= 2 ? "risk_on" : score <= -2 ? "risk_off" : "mixto";
  const bw = breadthWarning(readings);
  const cutBet = rateCutBet(readings);

  const onOff = signals.filter((s) => s.lean !== "neutral");
  const summaryParts = onOff.map((s) => `${s.label.toLowerCase()}: ${s.detail}`);
  let summary =
    regime === "risk_on"
      ? "Hoy el mercado luce con apetito por riesgo — la mayoría de las señales apuntan a compras. "
      : regime === "risk_off"
        ? "Hoy el mercado luce nervioso/defensivo — la mayoría de las señales apuntan a cautela. "
        : "Hoy el mercado está mixto, sin una dirección clara — señales encontradas entre instrumentos. ";
  summary += summaryParts.length > 0 ? summaryParts.join(" ") : "Sin movimientos fuertes en los instrumentos principales.";
  if (bw) summary += ` ⚠ ${bw}`;
  if (cutBet) summary += " Oro y Bitcoin suben junto con las acciones — el mercado podría estar apostando a que la Fed baje tasas pronto.";

  const nq = get(readings, "NQ");
  const vix = get(readings, "VIX");
  const zn = get(readings, "ZN");
  const dxy = get(readings, "DXY");
  const oneLiner =
    `Hoy: ${regime === "risk_on" ? "sesgo alcista" : regime === "risk_off" ? "sesgo bajista/cauteloso" : "sesgo mixto"} para NQ` +
    (vix ? ` — VIX ${vixBand(vix.last).label}` : "") +
    (zn ? `, yields ${zn.changePct < -0.1 ? "subiendo" : zn.changePct > 0.1 ? "bajando" : "estables"}` : "") +
    (dxy ? `, dólar ${dxy.changePct > 0.3 ? "fuerte" : dxy.changePct < -0.3 ? "débil" : "estable"}` : "") +
    (nq ? `, NQ ${nq.changePct >= 0 ? "+" : ""}${nq.changePct.toFixed(2)}%` : "") +
    ".";

  const simpleSummary = buildKidSimpleSummary(regime, readings, bw, cutBet);

  return { regime, regimeLabel: REGIME_LABEL[regime], score, signals, breadthWarning: bw, summary, oneLiner, simpleSummary };
}

// ── "Noticia relevante del día" (pedido explícito de Carlos, ago 2026) ─────
//
// Clasifica los titulares de HOY en categorías con explicación de por qué
// importan (no solo "esto es sobre la Fed", sino "esto puede mover el
// petróleo, y por eso puede mover al NQ") y arma resultados de mega-caps que
// reportan hoy. Guerra/geopolítica sale como alerta roja explícitamente,
// como pidió Carlos con su propio ejemplo (guerra en Medio Oriente →
// petróleo → NQ/ES). PURA — el filtrado por fecha de hoy y el fetch de
// noticias/resultados viven en app/api/market-analysis/route.ts.

export type AlertLevel = "danger" | "warning" | "info";

export interface DailyAlert {
  level: AlertLevel;
  message: string;
  sourceUrl?: string;
}

type HeadlineCategory = "war_oil" | "war_other" | "fed" | "trump" | null;

const WAR_KEYWORDS = [
  "war", "guerra", "invasion", "invasión", "attack", "ataque", "strikes", "launches strike",
  "missile", "misil", "military strike", "airstrike", "bombing", "bombardeo", "conflict", "conflicto",
];
const OIL_REGION_KEYWORDS = [
  "iran", "irán", "israel", "gaza", "hormuz", "gulf", "golfo pérsico", "saudi", "opec", "opep",
  "middle east", "medio oriente", "hezbollah", "houthi",
];
const FED_KEYWORDS = [
  "the fed", "fomc", "powell", "federal reserve", "reserva federal",
  "interest rate", "tasa de interés", "rate decision", "rate cut", "rate hike",
];
const TRUMP_KEYWORDS = ["trump", "white house", "casa blanca", "executive order", "tariff", "arancel"];

/** Escapa un keyword para meterlo en un `RegExp` — algunos tienen espacios (frases), no caracteres especiales. */
function toWordBoundaryRegex(keyword: string): RegExp {
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

/**
 * ¿Alguna keyword calza como PALABRA/FRASE completa? Un `.includes()` simple
 * hacía falsos positivos reales — "war" adentro de "award", por ejemplo.
 */
function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => toWordBoundaryRegex(k).test(text));
}

/** ¿En qué categoría cae un titular? Guerra tiene prioridad — si menciona una zona petrolera, se etiqueta distinto (para explicar el canal petróleo→NQ). */
export function classifyHeadline(title: string): HeadlineCategory {
  if (matchesAny(title, WAR_KEYWORDS)) {
    return matchesAny(title, OIL_REGION_KEYWORDS) ? "war_oil" : "war_other";
  }
  if (matchesAny(title, FED_KEYWORDS)) return "fed";
  if (matchesAny(title, TRUMP_KEYWORDS)) return "trump";
  return null;
}

const LEVEL_ORDER: Record<AlertLevel, number> = { danger: 0, warning: 1, info: 2 };

/**
 * Arma las alertas del día a partir de titulares YA filtrados a hoy (el
 * caller decide qué es "hoy") y los tickers que reportan resultados hoy.
 * Una sola alerta por categoría (la más reciente que calzó) — varios
 * titulares sobre la misma guerra no deben repetir la misma alerta.
 */
export function buildDailyAlerts(
  headlinesToday: { title: string; url: string }[],
  earningsToday: string[],
): DailyAlert[] {
  const alerts: DailyAlert[] = [];
  const seen = new Set<HeadlineCategory>();

  for (const h of headlinesToday) {
    const category = classifyHeadline(h.title);
    if (!category || seen.has(category)) continue;
    seen.add(category);

    if (category === "war_oil") {
      alerts.push({
        level: "danger",
        message: `🔴 ${h.title} — puede afectar el petróleo (subir su precio), y eso podría presionar al mercado (NQ/ES) a la baja.`,
        sourceUrl: h.url,
      });
    } else if (category === "war_other") {
      alerts.push({
        level: "danger",
        message: `🔴 ${h.title} — este tipo de noticia suele meter miedo al mercado y presionar a las acciones a la baja.`,
        sourceUrl: h.url,
      });
    } else if (category === "fed") {
      alerts.push({
        level: "warning",
        message: `📢 La Fed está en las noticias hoy: "${h.title}" — sus palabras pueden mover fuerte al mercado, sobre todo al Nasdaq (NQ).`,
        sourceUrl: h.url,
      });
    } else if (category === "trump") {
      alerts.push({
        level: "info",
        message: `📢 Trump está en las noticias hoy: "${h.title}" — declaraciones o políticas que podrían mover al mercado.`,
        sourceUrl: h.url,
      });
    }
  }

  for (const ticker of earningsToday) {
    alerts.push({ level: "info", message: `📊 ${ticker} reporta resultados hoy — puede moverse fuerte después del reporte.` });
  }

  return alerts.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
