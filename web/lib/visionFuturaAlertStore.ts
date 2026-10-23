// Ciclo de VisionFutura con alertas: carga el reporte (visionFuturaData.ts),
// guarda las muestras que las alertas necesitan comparar entre refrescos
// (precio SPX, VIX y el agresor por strike) y las alertas que ya se
// dispararon hoy, y evalúa los setups (visionFuturaAlerts.ts). Estado en
// disco, en data/vision-futura/alert-state.json (gitignored), así el
// historial del día sobrevive a recargar la página. Se reinicia solo cada día
// de mercado. Las muestras solo se acumulan mientras alguien tiene la pestaña
// abierta (cada refresco de 30 s es un ciclo) — sin Telegram por ahora.

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadVisionFutura, type VisionFuturaPayload } from "./visionFuturaData";
import { evaluateVisionAlerts, ALERT_TUNING, type Sample, type VisionAlert } from "./visionFuturaAlerts";
import { marketDateStr } from "./occ";
import { instrumentOf } from "./visionFuturaInstruments";

const STATE_DIR = join(process.cwd(), "data", "vision-futura");
/** Un archivo de estado por instrumento (SPX conserva el nombre original). */
const stateFile = (inst: string) => join(STATE_DIR, inst === "SPX" ? "alert-state.json" : `alert-state-${inst}.json`);
/** Un mismo setup (tipo + nivel) no se vuelve a anunciar antes de esto. */
const COOLDOWN_MS = 20 * 60_000;
/** Cada cuánto se toma una foto nueva del agresor para comparar. */
const AGG_SNAPSHOT_MS = 50_000;
const KEEP_SAMPLES_MS = 30 * 60_000;

type AggMap = Record<string, { compras: number; ventas: number }>;

export interface FiredAlert extends VisionAlert {
  firedAt: number;
  lastSeenAt: number;
}

interface AlertState {
  date: string;
  prices: Sample[];
  vix: Sample[];
  aggLast: { t: number; map: AggMap } | null;
  aggPrev: { t: number; map: AggMap } | null;
  fired: FiredAlert[];
}

function emptyState(date: string): AlertState {
  return { date, prices: [], vix: [], aggLast: null, aggPrev: null, fired: [] };
}

function loadState(date: string, inst: string): AlertState {
  try {
    const s = JSON.parse(readFileSync(stateFile(inst), "utf8")) as AlertState;
    return s.date === date ? { ...emptyState(date), ...s } : emptyState(date);
  } catch {
    return emptyState(date);
  }
}

function saveState(s: AlertState, inst: string) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(stateFile(inst), JSON.stringify(s), "utf8");
  } catch {
    // no crítico: sin disco, las alertas solo pierden memoria entre refrescos
  }
}

const toMap = (m: AggMap) => new Map(Object.entries(m).map(([k, v]) => [Number(k), v]));

export interface AlertView extends FiredAlert {
  /** El setup se sigue cumpliendo en este refresco. */
  activa: boolean;
}

export interface VisionFuturaCycle {
  payload: VisionFuturaPayload;
  /** Alertas disparadas hoy, la más reciente primero. */
  alerts: AlertView[];
  /** Setups más cerca de cumplirse ahora (no disparados), para el "vigilando". */
  watch: VisionAlert[];
}

/** Cómo se opera cada lado según el instrumento (texto de la orden de las alertas). */
function instrumentosDe(p: VisionFuturaPayload): { largo: string; corto: string } {
  const { main, etf, future } = p.labels;
  const night = instrumentOf(p.instrument).night;
  if (night) return { largo: `Comprar ${main} (o ${night.micro})`, corto: `Vender ${main} (o ${night.micro})` };
  if (!etf && !future) return { largo: `Comprar ${main} (acciones o calls)`, corto: `Vender ${main} (acciones o puts)` };
  const fut = future ? ` · comprar ${future}` : "";
  const futS = future ? ` · vender ${future}` : "";
  return { largo: `Calls de ${main}${etf ? `/${etf}` : ""}${fut}`, corto: `Puts de ${main}${etf ? `/${etf}` : ""}${futS}` };
}

export async function runVisionFuturaCycle(now: Date, radius: number, instrument = "SPX", expIndex = 0): Promise<VisionFuturaCycle> {
  const payload = await loadVisionFutura(now, radius, instrument, expIndex);
  const inst = payload.instrument;
  const t = now.getTime();
  const state = loadState(marketDateStr(now), inst);

  if (payload.marketOpen) {
    const lastP = state.prices.at(-1);
    if (!lastP || t - lastP.t >= 20_000) state.prices.push({ t, v: payload.spot.spx });
    if (payload.vix) {
      const lastV = state.vix.at(-1);
      if (!lastV || t - lastV.t >= 20_000) state.vix.push({ t, v: payload.vix.last });
    }
    const current: AggMap = Object.fromEntries(payload.rows.map((r) => [String(r.spx), { compras: r.compras, ventas: r.ventas }]));
    if (!state.aggLast || t - state.aggLast.t >= AGG_SNAPSHOT_MS) {
      state.aggPrev = state.aggLast;
      state.aggLast = { t, map: current };
    }
    state.prices = state.prices.filter((s) => s.t >= t - KEEP_SAMPLES_MS);
    state.vix = state.vix.filter((s) => s.t >= t - KEEP_SAMPLES_MS);
  }

  let evaluated: VisionAlert[] = [];
  if (payload.marketOpen) {
    // Precio: los puntos de 5 min de MarketSnack + las muestras propias
    // (más finas) de la ventana, para no depender de tener la pestaña abierta
    // desde hace 15 min.
    const fromChart = payload.priceSeries.map((p) => ({ t: p.time * 1000, v: p.value }));
    const prices = [...fromChart, ...state.prices]
      .filter((s) => s.t >= t - ALERT_TUNING.windowMs)
      .sort((a, b) => a.t - b.t);
    evaluated = evaluateVisionAlerts({
      now: t,
      spot: payload.spot.spx,
      conversion: payload.conversion,
      keyLevels: payload.keyLevels,
      dealerLevels: payload.dealerLevels,
      rows: payload.rows,
      regime: payload.regime,
      prices,
      vix: state.vix,
      vixMagnet: payload.vixMagnet,
      aggressorNow: state.aggLast ? toMap(state.aggLast.map) : new Map(),
      aggressorPrev: state.aggPrev ? toMap(state.aggPrev.map) : null,
      scale: payload.scale,
      instrumentos: instrumentosDe(payload),
    });
  }

  const activeIds = new Set<string>();
  for (const a of evaluated.filter((x) => x.fires)) {
    activeIds.add(a.id);
    const existing = state.fired.find((f) => f.id === a.id && t - f.lastSeenAt < COOLDOWN_MS);
    if (existing) existing.lastSeenAt = t;
    else state.fired.push({ ...a, firedAt: t, lastSeenAt: t });
  }
  saveState(state, inst);

  const alerts: AlertView[] = [...state.fired]
    .sort((a, b) => b.firedAt - a.firedAt)
    .map((f) => ({ ...f, activa: activeIds.has(f.id) }));

  const watch = evaluated
    .filter((a) => !a.fires)
    .sort((a, b) => b.score - a.score || Math.abs(a.level.spx - a.price.spx) - Math.abs(b.level.spx - b.price.spx))
    .slice(0, 4);

  return { payload, alerts, watch };
}
