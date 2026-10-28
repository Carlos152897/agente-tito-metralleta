// Ciclo de VisionFutura con alertas: carga el reporte (visionFuturaData.ts),
// guarda las muestras que las alertas necesitan comparar entre refrescos
// (precio SPX, VIX y el agresor por strike) y las alertas que ya se
// dispararon hoy, y evalúa los setups (visionFuturaAlerts.ts). Estado en
// disco, en data/vision-futura/alert-state.json (gitignored), así el
// historial del día sobrevive a recargar la página. Se reinicia solo cada día
// de mercado. Las muestras se acumulan con cada ciclo: la pestaña abierta (refresco de 30 s) o la
// tarea de fondo scripts/vision-futura-live/poll.ts (todo el día, sin la página) — sin Telegram.

import { MONEY_TUNING, readMoney, stepAgo, type MoneyReading, type MoneyRow, type MoneyTrade } from "./visionFuturaMoneyFlow";
import { evaluateLottos, lecturaAt, lottoExitsFrom, lottoTradeFrom, minutesToClose, settleLottoWithRule, type LottoIdea, type LottoQuote, type LottoTrade } from "./visionFuturaLottos";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadVisionFutura, type VisionFuturaPayload } from "./visionFuturaData";
import { evaluateVisionAlerts, ALERT_TUNING, type Sample, type VisionAlert } from "./visionFuturaAlerts";
import { marketDateStr } from "./occ";
import { instrumentOf } from "./visionFuturaInstruments";
import { sessionStartMs } from "./visionFuturaNight";
import { emptyPosHistory, pressureMarks, stepPositions, type PosHistory, type PosRow } from "./visionFuturaPositioning";
import { detectUnusual, snapshotOf as snapshotOfRows, type FlowSnapshot } from "./visionFuturaFlowChanges";

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

export interface AlertState {
  date: string;
  prices: Sample[];
  vix: Sample[];
  aggLast: { t: number; map: AggMap } | null;
  aggPrev: { t: number; map: AggMap } | null;
  fired: FiredAlert[];
  /** Flujo direccional (Σ net premium calls − puts de la pantalla) para los lottos; `r` = radio de la pantalla. */
  flowDir?: { t: number; v: number; r: number }[];
  /** Lecturas de lottos ya hechas hoy ("15:00"…) y los lottos comprados. */
  lottoDone?: string[];
  lottos?: LottoTrade[];
  /** Fotos del flujo por strike cada minuto (señal del dinero: comparar contra hace 15 min). */
  flowSnaps?: { t: number; r: number; rows: MoneyRow[] }[];
  moneyTrades?: MoneyTrade[];
  /** Hora (ms) de cada ciclo con el mercado abierto: cuánto del día se vigiló en vivo (backtest "En vivo"). */
  cycles?: number[];
  /** Posicionamiento Long/Short por strike: historial del día (lib/visionFuturaPositioning.ts). */
  positions?: PosHistory;
  /** Lectura anterior para las marcas de presión y foto del agresor para los saltos inusuales. */
  posPrev?: { t: number; rows: PosRow[] } | null;
  posAgg?: { t: number; snap: [number, FlowSnapshot][] } | null;
}

function emptyState(date: string): AlertState {
  return { date, prices: [], vix: [], aggLast: null, aggPrev: null, fired: [], flowDir: [], lottoDone: [], lottos: [] };
}

export interface LottoLive {
  /** Mejores candidatos de ahora (vacío antes de las 15:00 o sin 0DTE). */
  ideas: LottoIdea[];
  /** Lottos comprados hoy en las lecturas, con su valor actual (bid en vivo) o el resultado al cierre. */
  trades: (LottoTrade & { markNow: number | null })[];
  /** El vencimiento elegido es el del día (los lottos solo aplican a 0DTE). */
  zeroDte: boolean;
}

function loadState(date: string, inst: string): AlertState {
  try {
    const s = JSON.parse(readFileSync(stateFile(inst), "utf8")) as AlertState;
    return s.date === date ? { ...emptyState(date), ...s } : emptyState(date);
  } catch {
    return emptyState(date);
  }
}

/** Estado en vivo guardado de un día (null si el archivo ya es de otro día). Para el backtest "En vivo". */
export function loadAlertStateFor(date: string, inst: string): AlertState | null {
  try {
    const s = JSON.parse(readFileSync(stateFile(inst), "utf8")) as AlertState;
    return s.date === date ? s : null;
  } catch {
    return null;
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

export interface MoneyLive {
  /** Lectura de ahora (null antes de las 9:45, de noche o con el mercado cerrado). */
  reading: MoneyReading | null;
  /** Señales de hoy: abiertas (outcome null) y cerradas. */
  trades: MoneyTrade[];
}

export interface VisionFuturaCycle {
  payload: VisionFuturaPayload;
  lottos: LottoLive;
  money: MoneyLive;
  /** Alertas disparadas hoy, la más reciente primero. */
  alerts: AlertView[];
  /** Setups más cerca de cumplirse ahora (no disparados), para el "vigilando". */
  watch: VisionAlert[];
  /** Historial Long/Short del día (franjas y cambios). */
  positions: Pick<PosHistory, "segments" | "events">;
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
  // De noche la sesión cruza la medianoche: el estado se identifica por el día en que abrió (6 pm),
  // para no borrar las alertas a las 12.
  const isNightInst = !!instrumentOf(inst).night;
  const state = loadState(isNightInst ? `noche-${marketDateStr(new Date(sessionStartMs(now)))}` : marketDateStr(now), inst);

  if (payload.marketOpen) {
    state.cycles ??= [];
    state.cycles.push(t);
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
    // De noche: máximos y mínimos reales de las velas de 1 min (los cierres de 5 min esconden las mechas).
    const fromBars = isNightInst
      ? (payload.nightBars ?? []).flatMap((b) => [{ t: b.time * 1000 + 1, v: b.low }, { t: b.time * 1000 + 2, v: b.high }, { t: b.time * 1000 + 3, v: b.close }])
      : [];
    const priceHistory = [...fromChart, ...fromBars, ...state.prices].sort((a, b) => a.t - b.t);
    const prices = priceHistory.filter((s) => s.t >= t - ALERT_TUNING.windowMs);
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
      night: isNightInst ? payload.nightConfirm ?? { futFlow: null, vx: null } : null,
      recentFired: state.fired,
      priceHistory,
    });
  }

  // ── Posicionamiento Long/Short por strike (lib/visionFuturaPositioning.ts) ──
  if (payload.marketOpen && payload.rows.length > 0) {
    const rowsNow: PosRow[] = payload.rows.map((r) => ({ spx: r.spx, callFlow: r.callFlow, putFlow: r.putFlow }));
    const step = payload.rows.length > 1 ? Math.abs(payload.rows[1].spx - payload.rows[0].spx) : 5;
    const prevAgg = state.posAgg ? new Map(state.posAgg.snap) : null;
    const unusual = detectUnusual(payload.rows, prevAgg, t, undefined, !isNightInst).map((u) => ({ strike: u.strike, side: u.side, delta: u.delta }));
    const marks = state.posPrev && t - state.posPrev.t >= 10_000 ? pressureMarks(rowsNow, state.posPrev.rows, payload.spot.spx, step, t) : [];
    state.positions = stepPositions(state.positions ?? emptyPosHistory(), rowsNow, t, unusual, marks);
    if (!state.posPrev || t - state.posPrev.t >= 10_000) state.posPrev = { t, rows: rowsNow };
    state.posAgg = { t, snap: [...snapshotOfRows(payload.rows)] };
  }

  const activeIds = new Set<string>();
  for (const a of evaluated.filter((x) => x.fires)) {
    activeIds.add(a.id);
    const existing = state.fired.find((f) => f.id === a.id && t - f.lastSeenAt < COOLDOWN_MS);
    if (existing) existing.lastSeenAt = t;
    else state.fired.push({ ...a, firedAt: t, lastSeenAt: t });
  }
  // ── Lottos al cierre (lib/visionFuturaLottos.ts): desde las 15:00, solo 0DTE y sesión de día ──
  const quotes: LottoQuote[] = (payload.optionQuotes ?? []).map((q) => ({ type: q.type, strike: q.strike, bid: q.bid, ask: q.ask, real: true }));
  delete payload.optionQuotes; // no viaja al navegador
  const zeroDte = payload.expiration === marketDateStr(now) && !instrumentOf(inst).night;
  const nyMin = 16 * 60 - minutesToClose(t);
  state.flowDir ??= [];
  state.lottoDone ??= [];
  state.lottos ??= [];
  let lottoIdeas: LottoIdea[] = [];
  if (zeroDte && payload.marketOpen) {
    const fd = payload.rows.reduce((a, r) => a + r.callFlow - r.putFlow, 0);
    const lastF = state.flowDir.at(-1);
    if (!lastF || t - lastF.t >= 20_000 || lastF.r !== payload.radius) state.flowDir.push({ t, v: fd, r: payload.radius });
    state.flowDir = state.flowDir.filter((s) => s.t >= t - 40 * 60_000);
    if (nyMin >= 15 * 60) {
      const ago = t - 15 * 60_000;
      const pastPrices = [...payload.priceSeries.map((p) => ({ t: p.time * 1000, v: p.value })), ...state.prices]
        .filter((s) => s.t <= ago).sort((a, b) => a.t - b.t);
      const priceAgo = pastPrices.at(-1);
      // Solo si hay una muestra de flujo de hace ~15 min (±5) con el mismo radio de pantalla.
      const flowAgo = [...state.flowDir].reverse().find((s) => s.t <= ago && s.t >= ago - 5 * 60_000 && s.r === payload.radius);
      lottoIdeas = evaluateLottos({
        now: t, spot: payload.spot.spx, keyLevels: payload.keyLevels, regime: payload.regime, vix: payload.vix?.last ?? null,
        priceAgo15: priceAgo && priceAgo.t >= ago - 5 * 60_000 ? priceAgo.v : null,
        flowChange15: flowAgo ? fd - flowAgo.v : null, quotes, scale: payload.scale,
      }).slice(0, 3);
      const lec = lecturaAt(t);
      if (lec && !state.lottoDone.includes(lec)) {
        state.lottoDone.push(lec);
        const tr = lottoIdeas[0] ? lottoTradeFrom(lottoIdeas[0], t, payload.spot.spx) : null;
        if (tr) state.lottos.push(tr);
      }
    }
  }
  // Regla de salida: con el bid de este refresco se vende el tramo de 1.5× y el de 3× (una vez cada uno).
  if (payload.marketOpen) {
    for (const tr of state.lottos) {
      if (tr.settle != null) continue;
      const bid = quotes.find((q) => q.type === tr.side && q.strike === tr.strike)?.bid ?? null;
      if (bid == null || bid <= 0) continue;
      const done = new Set((tr.exits ?? []).map((e) => e.mult));
      const fresh = lottoExitsFrom(tr, [{ at: t, bid }]).filter((e) => !done.has(e.mult));
      if (fresh.length) tr.exits = [...(tr.exits ?? []), ...fresh];
    }
  }
  // Después del cierre: lo vendido + lo que quedó al valor intrínseco del último precio del día.
  if (!payload.marketOpen && nyMin >= 16 * 60) {
    for (let i = 0; i < state.lottos.length; i++) {
      const tr = state.lottos[i];
      if (tr.settle != null) continue;
      state.lottos[i] = settleLottoWithRule({ ...tr, settle: payload.spot.spx }, tr.exits ?? []);
    }
  }
  // ── Señal del dinero (lib/visionFuturaMoneyFlow.ts): sesión de día, desde las 9:45 ──
  state.flowSnaps ??= [];
  state.moneyTrades ??= [];
  let moneyReading: MoneyReading | null = null;
  const spotNow = payload.spot.spx;
  if (!instrumentOf(inst).night && payload.marketOpen) {
    const rowsNow: MoneyRow[] = payload.rows.map((r) => ({ spx: r.spx, callFlow: r.callFlow, putFlow: r.putFlow }));
    const lastS = state.flowSnaps.at(-1);
    if (!lastS || t - lastS.t >= 60_000 || lastS.r !== payload.radius) state.flowSnaps.push({ t, r: payload.radius, rows: rowsNow });
    state.flowSnaps = state.flowSnaps.filter((s) => s.t >= t - 25 * 60_000);
    // Las abiertas se resuelven con el precio en vivo.
    for (const tr of state.moneyTrades) {
      if (tr.outcome != null) continue;
      const up = tr.side === "largo";
      if (up ? spotNow <= tr.stop : spotNow >= tr.stop) Object.assign(tr, { outcome: "stop", exit: tr.stop, exitAt: t });
      else if (up ? spotNow >= tr.target : spotNow <= tr.target) Object.assign(tr, { outcome: "objetivo", exit: tr.target, exitAt: t });
      if (tr.outcome != null) tr.points = Math.round((up ? tr.exit! - tr.entry : tr.entry - tr.exit!) * 100) / 100;
    }
    if (nyMin >= 9 * 60 + 45) {
      const ago = stepAgo(state.flowSnaps.filter((s) => s.r === payload.radius), t);
      moneyReading = readMoney({ spot: spotNow, keyLevels: payload.keyLevels, rows: rowsNow, rows15: ago?.rows ?? null, scale: payload.scale });
      const sig = moneyReading.signal;
      const open = state.moneyTrades.some((tr) => tr.outcome == null);
      const lastSame = [...state.moneyTrades].reverse().find((tr) => sig && tr.side === sig.side);
      if (sig && !open && nyMin <= 15 * 60 + 30 && (!lastSame || t - lastSame.openedAt >= MONEY_TUNING.cooldownMs)) {
        state.moneyTrades.push({ ...sig, id: `${t}:${sig.side}`, openedAt: t, votes: moneyReading.votes, exit: null, exitAt: null, outcome: null, points: null });
      }
    }
  }
  // Después del cierre: las abiertas salen al último precio.
  if (!payload.marketOpen && nyMin >= 16 * 60) {
    for (const tr of state.moneyTrades) {
      if (tr.outcome != null) continue;
      const up = tr.side === "largo";
      Object.assign(tr, { outcome: "cierre", exit: spotNow, exitAt: t, points: Math.round((up ? spotNow - tr.entry : tr.entry - spotNow) * 100) / 100 });
    }
  }
  const money: MoneyLive = { reading: moneyReading, trades: state.moneyTrades };

  const lottos: LottoLive = {
    ideas: lottoIdeas,
    zeroDte,
    trades: state.lottos.map((tr) => ({ ...tr, markNow: quotes.find((q) => q.type === tr.side && q.strike === tr.strike)?.bid ?? null })),
  };
  saveState(state, inst);

  const alerts: AlertView[] = [...state.fired]
    .sort((a, b) => b.firedAt - a.firedAt)
    .map((f) => ({ ...f, activa: activeIds.has(f.id) }));

  const watch = evaluated
    .filter((a) => !a.fires)
    .sort((a, b) => b.score - a.score || Math.abs(a.level.spx - a.price.spx) - Math.abs(b.level.spx - b.price.spx))
    .slice(0, 4);

  const positions = { segments: state.positions?.segments ?? [], events: state.positions?.events ?? [] };
  return { payload, alerts, watch, lottos, money, positions };
}
