"use client";

// Pestaña VisionFutura (Prueba de Fuego, pedido explícito de Carlos, oct 2026):
// SPX con conversión a SPY y /ES — Magneto, imán positivo/negativo, pisos,
// resistencias, gamma flip, VIX con rango esperado, y dónde están
// posicionados los dealers según el flujo de MarketSnack. Datos de
// /api/vision-futura (cálculo puro en lib/visionFutura.ts).

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import VisionFuturaAlerts from "./VisionFuturaAlerts";
import VisionFuturaSpreads from "./VisionFuturaSpreads";
import VisionFuturaAmiga from "./VisionFuturaAmiga";
import VisionFuturaLottos from "./VisionFuturaLottos";
import VisionFuturaMoney from "./VisionFuturaMoney";
import VisionFuturaReplayBar from "./VisionFuturaReplayBar";
import VisionFuturaPremarket from "./VisionFuturaPremarket";
import VisionFuturaPositionLog from "./VisionFuturaPositionLog";
import VisionFuturaTickerSearch from "./VisionFuturaTickerSearch";
import VisionFuturaHybrid from "./VisionFuturaHybrid";
import { orderResultsFromPrices } from "@/lib/visionFuturaAlertOutcome";
import { hybridFromReplay, type HybridDay } from "@/lib/visionFuturaHybrid";
import { isEquityTicker } from "@/lib/visionFuturaInstruments";
import { historyAt, positionsFromTicks, type PosHistory } from "@/lib/visionFuturaPositioning";
import { DEFAULT_LABELS, FutureFirstContext, VisionLabelsContext, useVisionLabels } from "./visionLabels";
import type { InstrumentId, InstrumentLabels } from "@/lib/visionFuturaInstruments";
import type { AlertView, LottoLive, MoneyLive } from "@/lib/visionFuturaAlertStore";
import type { ReplayPayload } from "@/lib/visionFuturaReplay";
import type { ReplayDay } from "./VisionFuturaReplayBar";
import type { VisionAlert } from "@/lib/visionFuturaAlerts";
import type { SpreadsReport } from "@/lib/visionFuturaSpreads";
import type { MsPremiumMinute, MsUnusualTrade } from "@/lib/marketsnack";
import type { DotExit } from "@/lib/visionFuturaUnusualExit";
import { detectUnusual, mergeUnusual, snapshotOf, UNUSUAL_TUNING, type FlowSnapshot, type UnusualHit } from "@/lib/visionFuturaFlowChanges";
import VisionFuturaContextPanel from "./VisionFuturaContextPanel";
import VisionFuturaPremarketZones, { usePremarketZones } from "./VisionFuturaPremarketZones";
import { useVolumeDelta, VOL_WINDOWS } from "./useVolumeDelta";
import { detectVolumeSpikes, volDeltaRows } from "@/lib/visionFuturaVolumeDelta";
import VisionFuturaChart, { DEFAULT_LAYERS, LAYERS, type CandleBar, type HistoryPoint, type LayerKey, type VixStrip } from "./VisionFuturaChart";
import type { ConvertedLevel, DealerLevel, KeyLevel, KeyLevelKind, VisionFuturaReport, VisionStrikeRow } from "@/lib/visionFutura";

/** Niveles (MarketSnack, pesado). */
const REFRESH_MS = 15_000;
/** Precio en vivo (tastytrade, liviano): rápido con el mercado abierto; de noche solo se mueve el /ES. */
const LIVE_MS_OPEN = 3_000;
const CANDLES_MS = 15_000;
const LIVE_MS_CLOSED = 15_000;
/** Niveles que se vigilan para el aviso de "niveles que se movieron". */
const TRACKED_LEVELS = ["Magneto", "Imán positivo", "Imán negativo", "Resistencia (Call Wall)", "Piso (Put Wall)", "Gamma flip", "Max pain", "Charm +", "Charm −"];

interface LiveQuote {
  asOf: string;
  spx: number;
  spy: number | null;
  es: number | null;
  esSymbol: string | null;
  vix: { last: number; prevClose: number | null } | null;
  /** VIX real para la mini gráfica (aunque el instrumento sea NQ/TSLA). */
  vixMarket?: { last: number; prevClose: number | null } | null;
}

interface LevelChange { at: number; label: string; from: number; to: number }

/** Velocidades de "Repetir sesión": ms por cada tick de 5 min. */
const REPLAY_SPEEDS = [
  { label: "1x", ms: 2000 },
  { label: "2x", ms: 1000 },
  { label: "5x", ms: 400 },
  { label: "10x", ms: 200 },
];

function levelMap(keyLevels: { label: string; spx: number }[], vixMagnet: number | null) {
  const m = new Map<string, number>();
  for (const k of keyLevels) if (TRACKED_LEVELS.includes(k.label)) m.set(k.label, k.spx);
  if (vixMagnet != null) m.set("Magneto VIX", vixMagnet);
  return m;
}
const RADII = [30, 60, 120] as const;
const KEY_RADIUS = "visionary.visionFutura.radius";
const KEY_LAYERS = "visionary.visionFutura.layers";
const KEY_ZOOM = "visionary.visionFutura.zoom";
const KEY_FIT = "visionary.visionFutura.fitHeight";
/** Zoom de la gráfica: minutos visibles (null = todo el día / toda la noche). */
const ZOOMS: { min: number | null; label: string }[] = [
  { min: 60, label: "Última hora" },
  { min: 120, label: "2 horas" },
  { min: null, label: "Todo el día" },
];

interface VisionData extends VisionFuturaReport {
  instrument?: InstrumentId;
  labels?: InstrumentLabels;
  scale?: number;
  strikeStep?: number;
  expirations?: { date: string; dte: number }[];
  priceSeriesApprox?: boolean;
  asOf: string;
  gexAsOf: string | null;
  marketOpen: boolean;
  expiration: string;
  esSymbol: string | null;
  radius: number;
  priceSeries: { time: number; value: number }[];
  history: HistoryPoint[];
  vixMagnet: number | null;
  vixSeries?: { time: number; value: number }[];
  vixPrevClose?: number | null;
  vixMagnetSeries?: { time: number; value: number }[];
  /** Terminal de MarketSnack (lib/visionFuturaMsStore.ts): prima por minuto, presión, inusuales. */
  marketSnack?: { premium: MsPremiumMinute[]; unusual: MsUnusualTrade[]; unusualExits?: Record<number, DotExit> } | null;
  spreads?: SpreadsReport | null;
  spreadsError?: string | null;
  alerts: AlertView[];
  watch: VisionAlert[];
  lottos?: LottoLive;
  money?: MoneyLive;
  /** Historial Long/Short del día (solo en vivo; en la repetición se calcula de los pasos). */
  positions?: Pick<PosHistory, "segments" | "events">;
  /** Motor híbrido del día (solo en vivo; en la repetición se calcula de la repetición). */
  hybrid?: HybridDay;
}

const KIND_COLOR: Record<KeyLevelKind, string> = {
  magneto: "#a78bfa",
  iman_positivo: "var(--green)",
  iman_negativo: "var(--red-soft)",
  resistencia: "var(--amber-text)",
  piso: "#38bdf8",
  gamma_flip: "#f472b6",
  max_pain: "var(--muted)",
  charm: "#facc15",
};

const KIND_SHORT: Record<KeyLevelKind, string> = {
  magneto: "Magneto",
  iman_positivo: "Imán +",
  iman_negativo: "Imán −",
  resistencia: "Resistencia",
  piso: "Piso",
  gamma_flip: "Flip",
  max_pain: "Max pain",
  charm: "Charm",
};

const ROLE_LABEL: Record<DealerLevel["role"], { text: string; color: string }> = {
  resistencia: { text: "Resistencia (dealers venden subidas)", color: "var(--amber-text)" },
  piso: { text: "Piso (dealers compran caídas)", color: "#38bdf8" },
  acelera_arriba: { text: "Acelera ↑ (dealers cortos en calls)", color: "var(--green)" },
  acelera_abajo: { text: "Acelera ↓ (dealers cortos en puts)", color: "var(--red-soft)" },
};

const fmt = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtMoney = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : a.toFixed(0);
  return `${n < 0 ? "−" : n > 0 ? "+" : ""}$${s}`;
};

const fmtGex = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : `${(a / 1e3).toFixed(0)}K`;
  return `${n < 0 ? "−" : ""}${s}`;
};

const timeNy = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

const th: CSSProperties = { textAlign: "left", padding: "6px 8px", color: "var(--muted)", fontWeight: 500, fontSize: 12, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "5px 8px", fontSize: 13, borderBottom: "1px solid var(--border-soft)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

function Tile({ label, value, sub, extra, color }: { label: string; value: string; sub?: string; extra?: React.ReactNode; color?: string }) {
  return (
    <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", minWidth: 150, flex: "1 1 150px" }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: color ?? "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2 }}>{sub}</div>}
      {extra}
    </div>
  );
}

function Triple({ l }: { l: ConvertedLevel }) {
  const lb = useVisionLabels();
  return (
    <>
      <td style={{ ...td, fontWeight: 600 }}>{fmt(l.spx, 2)}</td>
      {lb.etf && <td style={td}>{fmt(l.spy, 2)}</td>}
      {lb.future && <td style={td}>{fmt(l.es, 2)}</td>}
    </>
  );
}

/** Encabezados de las columnas de precio del instrumento (principal · ETF · futuro). */
function PriceHeads() {
  const lb = useVisionLabels();
  return (
    <>
      <th style={th}>{lb.main}</th>
      {lb.etf && <th style={th}>{lb.etf}</th>}
      {lb.future && <th style={th}>{lb.future}</th>}
    </>
  );
}

function Ladder({ rows, spot, maxGex }: { rows: VisionStrikeRow[]; spot: number; maxGex: number }) {
  const spotIdx = rows.findIndex((r) => r.spx < spot); // filas de mayor a menor
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <PriceHeads />
            <th style={{ ...th, textAlign: "center" }}>GEX puts ◀ ▶ GEX calls</th>
            <th style={th}>GEX neto</th>
            <th style={th}>Flujo calls</th>
            <th style={th}>Flujo puts</th>
            <th style={th}>Dealers</th>
            <th style={th}>Nivel</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const putW = maxGex > 0 ? (r.putGex / maxGex) * 100 : 0;
            const callW = maxGex > 0 ? (r.callGex / maxGex) * 100 : 0;
            const role = r.dealerRole;
            const roleInfo = role ? ROLE_LABEL[role] : null;
            const rowBg = r.tags.length > 0 ? "rgba(167,139,250,0.08)" : undefined;
            return (
              <FragmentRow key={r.spx} showSpot={i === spotIdx} spot={spot}>
                <tr style={{ background: rowBg }}>
                  <Triple l={r} />
                  <td style={{ ...td, width: 220 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                        <div style={{ width: `${putW}%`, height: 10, background: "var(--put)", borderRadius: "3px 0 0 3px" }} />
                      </div>
                      <div style={{ width: 1, height: 14, background: "var(--border)" }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ width: `${callW}%`, height: 10, background: "var(--call)", borderRadius: "0 3px 3px 0" }} />
                      </div>
                    </div>
                  </td>
                  <td style={{ ...td, color: r.netGex > 0 ? "var(--green)" : r.netGex < 0 ? "var(--red-soft)" : "var(--faint)" }}>{fmtGex(r.netGex)}</td>
                  <td style={{ ...td, color: r.callFlow > 0 ? "var(--green)" : r.callFlow < 0 ? "var(--red-soft)" : "var(--faint)" }}>
                    {r.callFlow !== 0 ? fmtMoney(r.callFlow) : "—"}
                  </td>
                  <td style={{ ...td, color: r.putFlow > 0 ? "var(--red-soft)" : r.putFlow < 0 ? "var(--green)" : "var(--faint)" }}>
                    {r.putFlow !== 0 ? fmtMoney(r.putFlow) : "—"}
                  </td>
                  <td style={{ ...td, color: roleInfo?.color ?? "var(--faint)", fontWeight: r.strongFlow ? 700 : 400 }}>
                    {roleInfo ? `${r.strongFlow ? "● " : ""}${roleInfo.text.split(" (")[0]}` : "—"}
                  </td>
                  <td style={td}>
                    {r.tags.map((t) => (
                      <span key={t} style={{ display: "inline-block", marginRight: 4, padding: "1px 6px", borderRadius: 6, fontSize: 11, border: `1px solid ${KIND_COLOR[t]}`, color: KIND_COLOR[t] }}>
                        {KIND_SHORT[t]}
                      </span>
                    ))}
                  </td>
                </tr>
              </FragmentRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({ showSpot, spot, children }: { showSpot: boolean; spot: number; children: React.ReactNode }) {
  const lb = useVisionLabels();
  return (
    <>
      {showSpot && (
        <tr>
          <td colSpan={9} style={{ padding: "4px 8px", fontSize: 12, color: "var(--accent)", borderTop: "2px solid var(--accent)", borderBottom: "1px solid var(--border-soft)" }}>
            ▶ spot {lb.main} {fmt(spot, 2)}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}

const INSTRUMENT_OPTIONS: { id: InstrumentId; label: string; sub: string }[] = [
  { id: "SPX", label: "SPX", sub: "SPY · /ES" },
  { id: "NQ", label: "NQ", sub: "NDX · QQQ · /NQ" },
  { id: "TSLA", label: "TSLA", sub: "acción" },
  { id: "ESN", label: "🌙 /ES", sub: "noche · opciones CME" },
  { id: "NQN", label: "🌙 /NQ", sub: "noche · opciones CME" },
];
const NIGHT_IDS: InstrumentId[] = ["ESN", "NQN"];
const KEY_INST = "visionary.visionFutura.inst";
/** Acciones abiertas con el buscador (las más recientes primero). */
const KEY_RECENT = "visionary.visionFutura.recientes";
const isFixedInst = (id: string) => INSTRUMENT_OPTIONS.some((o) => o.id === id);

/** "Hoy" / "lun 26" para los botones de vencimiento. */
function expLabel(date: string, dte: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  if (dte === 0 && date === today) return "Hoy";
  const d = new Date(`${date}T12:00:00Z`);
  return `${d.toLocaleDateString("es-MX", { weekday: "short", timeZone: "UTC" }).replace(".", "")} ${d.getUTCDate()}`;
}

export default function VisionFuturaTab() {
  const [radius, setRadius] = useState<number>(60);
  const [inst, setInst] = useState<InstrumentId>("SPX");
  const [recientes, setRecientes] = useState<string[]>([]);
  const [expIdx, setExpIdx] = useState(0);
  // Lo elegido AHORA: una respuesta que llega tarde de otro instrumento/vencimiento se descarta.
  const paramsRef = useRef("");
  paramsRef.current = `${radius}|${inst}|${expIdx}`;
  const instRef = useRef(inst);
  instRef.current = inst;
  const [data, setData] = useState<VisionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(DEFAULT_LAYERS);
  const [showTable, setShowTable] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  // Ventana del volumen delta (panel derecho): 60 / 300 / 900 s, o null = todo el día.
  const [volWin, setVolWin] = useState<number | null>(60);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem("visionary.visionFutura.volWin");
      if (v != null) setVolWin(v === "" ? null : Number(v));
    } catch { /* sin storage */ }
  }, []);
  const pickVolWin = (w: number | null) => {
    setVolWin(w);
    try { window.localStorage.setItem("visionary.visionFutura.volWin", w == null ? "" : String(w)); } catch { /* sin storage */ }
  };
  const [fitHeight, setFitHeight] = useState(false);
  // Compras/ventas del refresco anterior → flechas ▲▼ del panel del agresor.
  const [live, setLive] = useState<LiveQuote | null>(null);
  const [livePoints, setLivePoints] = useState<{ time: number; value: number }[]>([]);
  // Velas de 1 min (tastytrade): se piden cada CANDLES_MS y la última se mueve con el precio en vivo.
  const [candles, setCandles] = useState<{ key: string; bars: CandleBar[] } | null>(null);
  const [levelChanges, setLevelChanges] = useState<LevelChange[]>([]);
  const prevLevelsRef = useRef<Map<string, number> | null>(null);
  const [, setTick] = useState(0); // para que "hace Xs" avance solo
  const prevAggRef = useRef<Map<number, FlowSnapshot> | null>(null);
  const [prevAgg, setPrevAgg] = useState<Map<number, FlowSnapshot> | null>(null);
  // Compras/ventas inusuales (salto grande en un strike): quedan encendidas 3 min.
  const [unusual, setUnusual] = useState<UnusualHit[]>([]);
  // "Repetir sesión": la última sesión reconstruida cada 5 min.
  const [mode, setMode] = useState<"vivo" | "repeticion">("vivo");
  const [replay, setReplay] = useState<ReplayPayload | null>(null);
  // Historial Long/Short de toda la repetición (una vez); cada paso ve lo que pasó hasta su hora.
  const replayPositions = useMemo(() => (replay ? positionsFromTicks(replay.ticks).history : null), [replay]);
  // Motor híbrido de la repetición (las mismas alertas/señales del día con sus filtros).
  const replayHybrid = useMemo(() => (replay ? hybridFromReplay(replay) : null), [replay]);
  const replayHybridPrices = useMemo(() => (replay ? replay.priceSeries.map((p) => ({ t: p.time * 1000, v: p.value })) : null), [replay]);
  const [replayIdx, setReplayIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(REPLAY_SPEEDS[0].ms);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayDays, setReplayDays] = useState<ReplayDay[]>([]);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(KEY_RADIUS));
      if ((RADII as readonly number[]).includes(saved)) setRadius(saved);
      const savedInst = window.localStorage.getItem(KEY_INST);
      if (savedInst && (isFixedInst(savedInst) || isEquityTicker(savedInst))) setInst(savedInst as InstrumentId);
      const savedRecent = JSON.parse(window.localStorage.getItem(KEY_RECENT) ?? "[]");
      if (Array.isArray(savedRecent)) setRecientes(savedRecent.filter((x): x is string => typeof x === "string" && isEquityTicker(x)).slice(0, 6));
      const savedLayers = JSON.parse(window.localStorage.getItem(KEY_LAYERS) ?? "null");
      if (savedLayers && typeof savedLayers === "object") setLayers({ ...DEFAULT_LAYERS, ...savedLayers });
      const savedZoom = Number(window.localStorage.getItem(KEY_ZOOM));
      if (ZOOMS.some((z) => z.min === savedZoom)) setZoom(savedZoom);
      if (window.localStorage.getItem(KEY_FIT) === "1") setFitHeight(true);
    } catch { /* sin storage: queda el default */ }
  }, []);

  const load = useCallback(async () => {
    const key = `${radius}|${inst}|${expIdx}`;
    try {
      const res = await fetch(`/api/vision-futura?radius=${radius}&inst=${inst}&exp=${expIdx}`, { cache: "no-store" });
      const json = await res.json();
      if (paramsRef.current !== key) return; // ya se eligió otra cosa
      if (!res.ok || json.error) throw new Error(json.error ?? `Error ${res.status}`);
      const next = json as VisionData;
      const nowMs = Date.now();
      const fresh = detectUnusual(next.rows, prevAggRef.current, nowMs, undefined, !NIGHT_IDS.includes(inst));
      setUnusual((cur) => mergeUnusual(cur, fresh, nowMs));
      setPrevAgg(prevAggRef.current);
      prevAggRef.current = snapshotOf(next.rows);
      // ¿Se movió algún nivel desde el refresco anterior? (Magneto, imanes, paredes, flip…)
      const levelsNow = levelMap(next.keyLevels, next.vixMagnet);
      const before = prevLevelsRef.current;
      if (before) {
        const moved: LevelChange[] = [];
        for (const [label, to] of levelsNow) {
          const from = before.get(label);
          if (from != null && Math.abs(from - to) >= 0.01) moved.push({ at: Date.now(), label, from, to });
        }
        if (moved.length > 0) setLevelChanges((prev) => [...moved, ...prev].slice(0, 12));
      }
      prevLevelsRef.current = levelsNow;
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando VisionFutura.");
    } finally {
      setLoading(false);
    }
  }, [radius, inst, expIdx]);

  // Cambio de instrumento o vencimiento: se empieza de cero (niveles, agresor, precio en vivo).
  const pickInst = (id: InstrumentId) => {
    if (id === inst) return;
    setInst(id);
    setExpIdx(0);
    setData(null);
    setLive(null);
    setLivePoints([]);
    setCandles(null);
    setLevelChanges([]);
    prevLevelsRef.current = null;
    prevAggRef.current = null;
    setPrevAgg(null);
    setUnusual([]);
    // La repetición es por instrumento: se descarta la anterior y, si se estaba viendo, se arma la nueva.
    setReplay(null);
    setReplayDays([]);
    setReplayIdx(0);
    setPlaying(false);
    setReplayError(null);
    instRef.current = id;
    // El modo noche no tiene repetición: vuelve a "en vivo".
    if (NIGHT_IDS.includes(id)) setMode("vivo");
    else if (mode === "repeticion") loadReplay(false);
    try { window.localStorage.setItem(KEY_INST, id); } catch { /* ignorar */ }
    if (!isFixedInst(id)) {
      const next = [id, ...recientes.filter((x) => x !== id)].slice(0, 6);
      setRecientes(next);
      try { window.localStorage.setItem(KEY_RECENT, JSON.stringify(next)); } catch { /* ignorar */ }
    }
  };
  const pickExp = (i: number) => {
    if (i === expIdx) return;
    setExpIdx(i);
    setLevelChanges([]);
    prevLevelsRef.current = null;
    prevAggRef.current = null;
    setPrevAgg(null);
    setUnusual([]);
  };

  useEffect(() => {
    if (mode === "repeticion") {
      // En la repetición no se refresca lo en vivo, pero al cambiar de instrumento se borró: una
      // carga para que la pantalla no quede en blanco (antes pasaba de SPX a TSLA con la repetición abierta).
      if (!data) { setLoading(true); load(); }
      return;
    }
    setLoading(true);
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load, mode]);

  const loadDays = useCallback(async () => {
    try {
      const res = await fetch(`/api/vision-futura/replay/days?inst=${instRef.current}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok && Array.isArray(json.days)) setReplayDays(json.days as ReplayDay[]);
    } catch { /* el selector queda con lo que tenía */ }
  }, []);

  const loadReplay = useCallback(async (force: boolean, date?: string) => {
    setReplayLoading(true);
    setReplayError(null);
    setPlaying(false);
    try {
      const forInst = instRef.current;
      const qs = new URLSearchParams({ inst: forInst });
      if (force) qs.set("force", "1");
      if (date) qs.set("date", date);
      const res = await fetch(`/api/vision-futura/replay?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (instRef.current !== forInst) return; // se cambió de instrumento mientras cargaba
      if (!res.ok || json.error) throw new Error(json.error ?? `Error ${res.status}`);
      setReplay(json as ReplayPayload);
      setReplayIdx(0);
    } catch (e) {
      setReplayError(e instanceof Error ? e.message : "No se pudo reconstruir la sesión.");
    } finally {
      setReplayLoading(false);
      loadDays(); // el día recién armado (y su backtest) aparece en el selector
    }
  }, [loadDays]);

  const pickMode = (m: "vivo" | "repeticion") => {
    setReplayError(null);
    setMode(m);
    setPlaying(false);
    if (m === "repeticion" && !replay && !replayLoading) loadReplay(false);
  };

  // Reproducción: avanza un tick (5 min) cada `speedMs`.
  useEffect(() => {
    if (!playing || !replay) return;
    const id = window.setInterval(() => setReplayIdx((i) => Math.min(i + 1, replay.ticks.length - 1)), speedMs);
    return () => window.clearInterval(id);
  }, [playing, replay, speedMs]);
  useEffect(() => {
    if (playing && replay && replayIdx >= replay.ticks.length - 1) setPlaying(false);
  }, [playing, replay, replayIdx]);

  // Precio en vivo (tastytrade). Se pausa con la pestaña del navegador oculta.
  const marketOpen = data?.marketOpen ?? false;
  useEffect(() => {
    if (mode === "repeticion") return;
    let stop = false;
    const pull = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/vision-futura/live?inst=${inst}`, { cache: "no-store" });
        const json = await res.json();
        if (stop || !res.ok || json.error) return;
        const q = json as LiveQuote & { instrument?: string };
        if (q.instrument && q.instrument !== instRef.current) return;
        setLive(q);
        const t = Math.floor(Date.parse(q.asOf) / 1000);
        setLivePoints((prev) => {
          const last = prev.at(-1);
          if (last && last.value === q.spx && t - last.time < 15) return prev;
          return [...prev, { time: t, value: q.spx }].slice(-3000);
        });
      } catch { /* el próximo intento lo reintenta */ }
    };
    pull();
    const id = window.setInterval(pull, marketOpen ? LIVE_MS_OPEN : LIVE_MS_CLOSED);
    const tick = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => { stop = true; window.clearInterval(id); window.clearInterval(tick); };
  }, [marketOpen, mode, inst]);

  // Velas japonesas de 1 min. En vivo: cada 15 s (la última vela además se mueve con cada precio
  // en vivo, ver liveCandles). En la repetición: las del día repetido, una sola vez.
  const replayDate = mode === "repeticion" ? replay?.date ?? null : null;
  useEffect(() => {
    if (mode === "repeticion" && !replayDate) return;
    const key = `${inst}|${replayDate ?? "vivo"}`;
    let stop = false;
    const pull = async (first = false) => {
      if (document.hidden && !first) return;
      try {
        const qs = new URLSearchParams({ inst });
        if (replayDate) qs.set("date", replayDate);
        const res = await fetch(`/api/vision-futura/candles?${qs}`, { cache: "no-store" });
        const json = await res.json();
        if (stop || !res.ok || json.error || !Array.isArray(json.candles)) return;
        setCandles({ key, bars: json.candles });
      } catch { /* el próximo intento lo reintenta */ }
    };
    pull(true);
    if (replayDate) return () => { stop = true; };
    const id = window.setInterval(pull, CANDLES_MS);
    return () => { stop = true; window.clearInterval(id); };
  }, [inst, mode, replayDate]);

  const pickRadius = (r: number) => {
    setRadius(r);
    try { window.localStorage.setItem(KEY_RADIUS, String(r)); } catch { /* ignorar */ }
  };

  const saveLayers = (next: Record<LayerKey, boolean>) => {
    setLayers(next);
    try { window.localStorage.setItem(KEY_LAYERS, JSON.stringify(next)); } catch { /* ignorar */ }
  };
  const pickZoom = (z: number | null) => {
    setZoom(z);
    try { window.localStorage.setItem(KEY_ZOOM, z == null ? "" : String(z)); } catch { /* ignorar */ }
  };
  const pickFit = (on: boolean) => {
    setFitHeight(on);
    try { window.localStorage.setItem(KEY_FIT, on ? "1" : "0"); } catch { /* ignorar */ }
  };
  const toggleLayer = (k: LayerKey) => saveLayers({ ...layers, [k]: !layers[k] });
  const setAllLayers = (on: boolean) =>
    saveLayers(Object.fromEntries(LAYERS.map((l) => [l.key, on])) as Record<LayerKey, boolean>);

  const instrumentBar = (
    <div className="card" style={{ gap: 10, padding: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, letterSpacing: 0.5 }}>INSTRUMENTO</span>
        {INSTRUMENT_OPTIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => pickInst(o.id)}
            style={{
              padding: "6px 14px", borderRadius: 10, cursor: "pointer", textAlign: "center", minWidth: 84,
              border: `1px solid ${inst === o.id ? "var(--accent)" : "var(--border)"}`,
              background: inst === o.id ? "var(--accent-dim)" : "var(--panel-2)", color: "var(--text)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15 }}>{o.label}</div>
            <div style={{ fontSize: 10, color: inst === o.id ? "var(--accent)" : "var(--faint)" }}>{o.sub}</div>
          </button>
        ))}
        {!isFixedInst(inst) && (
          <button
            style={{ padding: "6px 14px", borderRadius: 10, textAlign: "center", minWidth: 84, border: "1px solid var(--accent)", background: "var(--accent-dim)", color: "var(--text)", cursor: "default" }}
          >
            <div style={{ fontWeight: 700, fontSize: 15 }}>{inst}</div>
            <div style={{ fontSize: 10, color: "var(--accent)" }}>acción · buscada</div>
          </button>
        )}
        <VisionFuturaTickerSearch onPick={(t) => pickInst(t)} recientes={recientes.filter((t) => t !== inst)} />
      </div>
      {data?.expirations && data.expirations.length > 0 && mode === "vivo" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, letterSpacing: 0.5 }}>VENCIMIENTO</span>
          {data.expirations.map((e) => (
            <button
              key={e.date}
              onClick={() => pickExp(e.dte)}
              title={e.date}
              style={{
                padding: "5px 12px", borderRadius: 10, cursor: "pointer", textAlign: "center", minWidth: 64,
                border: `1px solid ${expIdx === e.dte ? "var(--accent)" : "var(--border)"}`,
                background: expIdx === e.dte ? "var(--accent-dim)" : "var(--panel-2)", color: "var(--text)",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: expIdx === e.dte ? 700 : 500 }}>{expLabel(e.date, e.dte)}</div>
              <div style={{ fontSize: 10, color: expIdx === e.dte ? "var(--accent)" : "var(--faint)" }}>{e.dte}DTE</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Zonas de pre-mercado del MISMO día que muestra la gráfica (en la repetición, el día repetido).
  const pmLastSec = candles?.bars.at(-1)?.time ?? data?.priceSeries.at(-1)?.time ?? null;
  const pmDate = NIGHT_IDS.includes(inst) ? null
    : mode === "repeticion" && replay ? replay.date
    : pmLastSec != null ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(pmLastSec * 1000))
    : null;
  const pmReport = usePremarketZones(inst, pmDate);
  const vol = useVolumeDelta({
    // En "Repetir sesión": los contratos que vencían ese día (el 0DTE repetido), con el radio de la repetición.
    inst,
    expiration: mode === "repeticion" && replay ? replay.expiration || replay.date : data?.expiration ?? null,
    spot: data?.spot.spx ?? null,
    radius: mode === "repeticion" && replay ? replay.radius : data?.radius ?? null,
    enabled: layers.volumen_delta && layers.agresor && !NIGHT_IDS.includes(inst),
  });

  if (loading && !data) return <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>{instrumentBar}<div className="card wheel-empty">Cargando VisionFutura · {inst}…</div></div>;
  if (error && !data) return <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>{instrumentBar}<div className="card" style={{ color: "var(--red-soft)" }}>{error}</div></div>;
  if (!data) return null;

  // Vista en vivo: precio, SPY, /ES, VIX y conversiones de tastytrade (cada
  // pocos segundos) encima de los niveles de MarketSnack (cada 15 s).
  const liveView: VisionData = live
    ? {
        ...data,
        spot: { spx: live.spx, spy: live.spy, es: live.es },
        esSymbol: live.esSymbol ?? data.esSymbol,
        conversion: {
          spyRatio: live.spy != null ? live.spy / live.spx : data.conversion.spyRatio,
          esBasis: live.es != null ? live.es - live.spx : data.conversion.esBasis,
        },
        vix: live.vix && live.vix.prevClose
          ? { last: live.vix.last, prevClose: live.vix.prevClose, changePct: ((live.vix.last - live.vix.prevClose) / live.vix.prevClose) * 100 }
          : data.vix,
        priceSeries: data.marketOpen
          ? [...data.priceSeries.filter((p) => p.time < (livePoints[0]?.time ?? Infinity)), ...livePoints]
          : data.priceSeries,
      }
    : data;

  // Vista de la repetición: todo como estaba en el tick elegido.
  const tick = mode === "repeticion" && replay ? replay.ticks[Math.min(replayIdx, replay.ticks.length - 1)] : null;
  const tickMs = tick ? tick.time * 1000 : 0;
  const view: VisionData = tick && replay
    ? {
        ...tick,
        lottos: undefined, // los candidatos del paso van aparte (tick.lottos); este campo es el de "en vivo"
        money: undefined, // idem: la lectura del paso es tick.money
        asOf: new Date(tickMs).toISOString(),
        marketOpen: true,
        expiration: replay.date,
        esSymbol: null,
        radius: replay.radius,
        priceSeries: replay.priceSeries.filter((p) => p.time <= tick.time),
        history: replay.history.filter((h) => h.time <= tick.time),
        alerts: (() => {
          // Resultado de cada orden con el precio hasta este momento: la vieja se cierra cuando sale la nueva.
          const shown = replay.alerts.filter((a) => a.firedAt <= tickMs);
          const results = orderResultsFromPrices(
            shown.map((a) => ({ at: a.firedAt, side: a.order.side, entry: a.order.entry.spx, stop: a.order.stop.spx, target: a.order.target?.spx ?? null })),
            replay.priceSeries.map((p) => ({ t: p.time * 1000, v: p.value })),
            tickMs,
            replayIdx >= replay.ticks.length - 1 && !replay.partial,
          );
          return shown
            .map((a, i) => ({ ...a, lastSeenAt: Math.min(a.lastSeenAt, tickMs), activa: tick.activeIds.includes(a.id), result: results[i] }))
            .sort((a, b) => b.firedAt - a.firedAt);
        })(),
      }
    : liveView;
  const replayPrevAgg = tick && replay && replayIdx > 0 ? snapshotOf(replay.ticks[replayIdx - 1].rows) : null;
  // En la repetición cada paso son 5 min: se compara contra el paso anterior, sin retener.
  const replayUnusual = tick && replayPrevAgg ? detectUnusual(tick.rows, replayPrevAgg, tick.time * 1000) : [];
  const liveUnusual = unusual.filter((h) => Date.now() - h.at <= UNUSUAL_TUNING.holdMs);
  const replayChanges: LevelChange[] = [];
  if (tick && replay) {
    for (let i = 1; i <= replayIdx; i++) {
      const before = levelMap(replay.ticks[i - 1].keyLevels, replay.ticks[i - 1].vixMagnet);
      const after = levelMap(replay.ticks[i].keyLevels, replay.ticks[i].vixMagnet);
      for (const [label, to] of after) {
        const from = before.get(label);
        if (from != null && Math.abs(from - to) >= 0.01) replayChanges.unshift({ at: replay.ticks[i].time * 1000, label, from, to });
      }
    }
  }
  const changesToShow = tick ? replayChanges : levelChanges;
  const positionsView = tick ? (replayPositions ? historyAt(replayPositions, tickMs) : null) : view.positions ?? null;

  // Mini VIX bajo el precio. Repetición: el VIX de cada paso de 5 min (sirve también con repeticiones viejas).
  let vixStrip: VixStrip | null = null;
  if (tick && replay) {
    const upTo = replay.ticks.slice(0, replayIdx + 1);
    vixStrip = {
      series: upTo.filter((t) => t.vix && t.vix.last > 0).map((t) => ({ time: t.time, value: t.vix!.last })),
      // En días viejos la repetición usa la apertura como "cierre anterior": así se marca como apertura.
      prevClose: tick.vix && Math.abs(tick.vix.prevClose - (replay.ticks[0].vix?.last ?? NaN)) > 0.001 ? tick.vix.prevClose : null,
      magnet: tick.vixMagnet,
      magnetSeries: upTo.filter((t) => t.vixMagnet != null).map((t) => ({ time: t.time, value: t.vixMagnet! })),
    };
  } else if (data.vixSeries) {
    const vm = live?.vixMarket;
    const liveSec = live ? Math.floor(Date.parse(live.asOf) / 1000) : 0;
    const base = data.vixSeries;
    vixStrip = {
      series: data.marketOpen && vm && vm.last > 0 && liveSec > (base.at(-1)?.time ?? 0)
        ? [...base, { time: liveSec, value: vm.last }]
        : base,
      prevClose: data.marketOpen ? vm?.prevClose ?? data.vixPrevClose ?? null : data.vixPrevClose ?? null,
      magnet: data.vixMagnet,
      magnetSeries: data.vixMagnetSeries ?? [],
    };
  }
  const liveAgo = live ? Math.max(0, Math.round((Date.now() - Date.parse(live.asOf)) / 1000)) : null;

  const maxGex = Math.max(1, ...view.rows.map((r) => Math.max(r.callGex, r.putGex)));
  const spyRatio = view.conversion.spyRatio;
  const esBasis = view.conversion.esBasis;
  const labels: InstrumentLabels = (tick ? replay?.labels : data.labels) ?? DEFAULT_LABELS;
  const scale = (tick ? replay?.scale : data.scale) ?? 1;
  const isSpx = labels.main === "SPX";
  const isNightInst = NIGHT_IDS.includes(inst);

  // Velas para la gráfica. Repetición: hasta el paso elegido. En vivo: las de tastytrade + la
  // vela del minuto actual armada con cada precio en vivo (cada 3 s), sin esperar al próximo pedido.
  const candleKey = `${inst}|${tick && replay ? replay.date : "vivo"}`;
  const baseBars = candles?.key === candleKey ? candles.bars : [];
  let chartCandles: CandleBar[] = baseBars;
  if (tick) {
    chartCandles = baseBars.filter((b) => b.time <= tick.time);
  } else if (baseBars.length > 0 && (data.marketOpen || isNightInst)) {
    const out = baseBars.slice();
    for (const p of livePoints) {
      const last = out[out.length - 1];
      const m = Math.floor(p.time / 60) * 60;
      if (m < last.time) continue;
      if (m === last.time) out[out.length - 1] = { ...last, high: Math.max(last.high, p.value), low: Math.min(last.low, p.value), close: p.value };
      else out.push({ time: m, open: last.close, high: Math.max(last.close, p.value), low: Math.min(last.close, p.value), close: p.value });
    }
    chartCandles = out;
  }
  // Ganada / perdida / abierta de cada alerta con las velas de 1 min (máximo y mínimo): en vivo
  // rellena las que no traen resultado del servidor (las de antes de este cambio); en la repetición
  // reemplaza el cálculo de 5 min, que no ve los stops que se tocan en 1–2 min.
  const alertsWithResults = (() => {
    const list = view.alerts ?? [];
    const bars = (tick ? chartCandles : baseBars).map((b) => ({ t: b.time * 1000, high: b.high, low: b.low, close: b.close }));
    if (list.length === 0 || bars.length === 0) return list;
    if (!tick && list.every((a) => a.result)) return list;
    const res = orderResultsFromPrices(
      list.map((a) => ({ at: a.firedAt, side: a.order.side, entry: a.order.entry.spx, stop: a.order.stop.spx, target: a.order.target?.spx ?? null })),
      bars,
      tick ? tickMs : Date.now(),
      tick ? replayIdx >= (replay?.ticks.length ?? 0) - 1 && !replay?.partial : !view.marketOpen,
    );
    return list.map((a, i) => (tick || !a.result ? { ...a, result: res[i] } : a));
  })();
  const levelsSrc = isNightInst ? "opciones de CME en tastytrade" : "MarketSnack";
  // Ventana real de cada botón (misma regla que el servidor: 10/20/30 strikes por lado fuera de SPX).
  const step = (tick ? replay?.strikeStep : data.strikeStep) ?? 5;
  const windowFor = (r: number) => (isSpx || inst === "ESN" ? r : (r <= 30 ? 10 : r <= 60 ? 20 : 30) * step);

  return (
    <VisionLabelsContext.Provider value={labels}>
    <FutureFirstContext.Provider value={{ on: inst === "NQ", label: labels.future, basis: tick ? null : view.conversion.esBasis ?? null }}>
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {instrumentBar}
      {isNightInst && (
        <div className="card" style={{ gap: 6, padding: 14, borderColor: "var(--amber)", fontSize: 13 }}>
          <b>🌙 Modo noche · {labels.main}</b>
          <div style={{ color: "var(--muted)" }}>
            Niveles calculados con gamma × OI de las opciones de CME sobre el futuro (tastytrade), no con MarketSnack. De noche el OI es el del
            cierre anterior y hay poco volumen: <b style={{ color: "var(--amber-text)" }}>tómalos como referencia, menos confiables que de día</b>.
            Alertas de scalp (en puntos del futuro; 1 pt = ${inst === "ESN" ? "50 en /ES · $5 en /MES" : "20 en /NQ · $2 en /MNQ"}): como de noche no hay flujo de opciones ni VIX, las
            confirmaciones son <b>nivel con peso de opciones</b> (GEX grande por OI de CME), <b>agresor del futuro</b> (compras al ask vs ventas al bid en velas de 1 min, últimos 5 min) y <b>/VX</b> (VIX en futuros, 1 tick en 15 min).
            Mejor horario: apertura de Asia (8–10 pm NY) y Europa (3–5 am NY); evita la pausa de 5–6 pm.
          </div>
          <div style={{ color: "var(--faint)", fontSize: 12 }}>Gráfica: velas reales de 5 min del futuro desde la apertura de la sesión (6 pm NY, tastytrade) + el precio en vivo cada 3 s. Sin repetición ni backtest en este modo.</div>
        </div>
      )}
      {!isNightInst && <VisionFuturaReplayBar
        mode={mode}
        onMode={pickMode}
        replay={replay}
        idx={replayIdx}
        onIdx={setReplayIdx}
        playing={playing}
        onPlaying={setPlaying}
        speedMs={speedMs}
        onSpeed={setSpeedMs}
        speeds={REPLAY_SPEEDS}
        loading={replayLoading}
        error={replayError}
        onRebuild={() => loadReplay(true)}
        days={replayDays}
        onPickDay={(d) => loadReplay(false, d)}
      />}
      <div className="card" style={{ gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
          <h3 style={{ margin: 0 }}>VisionFutura · {labels.main}{!isSpx && <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}> · umbrales ×{scale.toFixed(2)} vs SPX</span>}</h3>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {tick
              ? <><b style={{ color: "var(--amber-text)" }}>⏪ Repetición del {view.expiration}</b> · {timeNy(view.asOf)} NY{view.gexAsOf && <> · GEX {timeNy(view.gexAsOf)}</>}</>
              : <>{view.marketOpen ? "🟢 En vivo" : "⚪ Mercado cerrado"} · vencimiento {view.expiration} · actualizado {timeNy(view.asOf)} NY
                {view.gexAsOf && <> · GEX {timeNy(view.gexAsOf)}</>} · niveles cada 15 s</>}
          </div>
        </div>
        {error && !tick && <div style={{ fontSize: 12, color: "var(--amber-text)" }}>Último refresco falló: {error} (mostrando datos anteriores)</div>}
        {!tick && <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: liveAgo != null && liveAgo <= 10 ? "var(--green)" : "var(--amber)" }} />
          Precio en vivo (tastytrade): {liveAgo == null ? "conectando…" : `hace ${liveAgo} s`} · cada {view.marketOpen ? "3" : "15"} s
          <span style={{ color: "var(--faint)" }}>· Niveles ({levelsSrc}): cada 15 s{isNightInst ? "" : ", GEX nuevo cada 5 min"}</span>
        </div>}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Tile label={labels.main} value={fmt(view.spot.spx)} sub={view.regime ? `GEX neto ${view.regime} (${fmtGex(view.netGex ?? 0)})` : "sin GEX"} color={view.regime === "negativo" ? "var(--red-soft)" : undefined} />
          {labels.etf && <Tile label={labels.etf} value={fmt(view.spot.spy)} sub={spyRatio != null ? `ratio ${spyRatio.toFixed(5)} × ${labels.main}` : "sin cotización"} />}
          {labels.future && <Tile label={view.esSymbol ?? labels.future} value={fmt(view.spot.es)} sub={esBasis != null ? `base ${esBasis >= 0 ? "+" : ""}${esBasis.toFixed(2)} pts vs ${labels.main}` : "sin cotización"} />}
          <Tile
            label={labels.vol}
            value={view.vix ? `${fmt(view.vix.last)}${labels.vol === "VIX" ? "" : "%"}` : "—"}
            color={view.vix && labels.vol === "VIX" ? (view.vix.changePct > 0 ? "var(--red-soft)" : "var(--green)") : undefined}
            sub={view.vix && view.expectedMove
              ? labels.vol === "VIX"
                ? `${view.vix.changePct >= 0 ? "+" : ""}${view.vix.changePct.toFixed(2)}% · rango hoy ±${view.expectedMove.points.toFixed(1)} pts`
                : `de sus opciones · rango hoy ±${view.expectedMove.points.toFixed(1)} pts`
              : "sin cotización"}
            extra={view.vixMagnet != null && (
              <div style={{ fontSize: 12, marginTop: 4, color: KIND_COLOR.magneto, fontWeight: 600 }}>
                Magneto VIX {fmt(view.vixMagnet, 2)}
                {view.vix && (
                  <span style={{ color: "var(--faint)", fontWeight: 400 }}>
                    {" "}· {Math.abs(view.vixMagnet - view.vix.last).toFixed(2)} {view.vixMagnet >= view.vix.last ? "arriba" : "abajo"}
                  </span>
                )}
              </div>
            )}
          />
        </div>
        {view.resumen.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
            {view.resumen.map((s) => <li key={s}>{s}</li>)}
          </ul>
        )}
      </div>

      {/* Pre-mercado: rango probable del día y posiciones importantes (no en repetición ni de noche). */}
      {!tick && (inst === "SPX" || inst === "NQ" || inst === "TSLA") && (
        <VisionFuturaPremarket inst={inst as "SPX" | "NQ" | "TSLA"} livePrice={view.spot.spx} marketOpen={view.marketOpen} futLabel={labels.future} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))", gap: "var(--space-md)" }}>
        <div className="card" style={{ gap: 10 }}>
          <h4 style={{ margin: 0 }}>Niveles clave (GEX real de {levelsSrc})</h4>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr><th style={th}>Nivel</th><PriceHeads /><th style={th}>Dist.</th></tr>
              </thead>
              <tbody>
                {view.keyLevels.map((k: KeyLevel) => (
                  <tr key={`${k.label}-${k.spx}`} title={k.fuente}>
                    <td style={{ ...td, color: KIND_COLOR[k.kind], fontWeight: 600 }}>{k.label}</td>
                    <Triple l={k} />
                    <td style={{ ...td, color: "var(--muted)" }}>{k.distance >= 0 ? "+" : ""}{k.distance.toFixed(1)}</td>
                  </tr>
                ))}
                {view.expectedMove && (
                  <>
                    <tr title="Spot + VIX/√252">
                      <td style={{ ...td, color: "var(--muted)" }}>Rango {labels.vol} ↑</td>
                      <Triple l={view.expectedMove.high} />
                      <td style={{ ...td, color: "var(--muted)" }}>+{view.expectedMove.points.toFixed(1)}</td>
                    </tr>
                    <tr title="Spot − VIX/√252">
                      <td style={{ ...td, color: "var(--muted)" }}>Rango {labels.vol} ↓</td>
                      <Triple l={view.expectedMove.low} />
                      <td style={{ ...td, color: "var(--muted)" }}>−{view.expectedMove.points.toFixed(1)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: "var(--faint)" }}>Pasá el mouse por un nivel para ver de dónde sale.</div>
        </div>

        <div className="card" style={{ gap: 10 }}>
          <h4 style={{ margin: 0 }}>Dónde están los dealers (flujo de hoy)</h4>
          {view.dealerLevels.length === 0 ? (
            <div className="wheel-empty">Todavía no hay flujo suficiente en este vencimiento.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr><th style={th}>Lectura</th><PriceHeads /><th style={th}>Premium</th></tr>
                </thead>
                <tbody>
                  {view.dealerLevels.map((d) => (
                    <tr key={`${d.role}-${d.spx}`} title={d.texto}>
                      <td style={{ ...td, color: ROLE_LABEL[d.role].color, fontWeight: 600 }}>{ROLE_LABEL[d.role].text}</td>
                      <Triple l={d} />
                      <td style={td}>{fmtMoney(d.premium)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--faint)" }}>
            Cliente compra al ask → el dealer queda vendido; cliente vende al bid → el dealer queda comprado. Es una estimación con el flujo de hoy
            (el open interest viejo no dice de qué lado quedó cada quien).
          </div>
        </div>
      </div>

      {/* Escalera a la izquierda + panel VIX · SPY · QQQ y Vigía tecnológico a la derecha (Carlos, 29-oct). */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="card" style={{ gap: 12, flex: "1 1 760px", minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <h4 style={{ margin: 0 }}>Escalera en vivo</h4>
          {tick ? (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>±{view.radius} pts (fijo en la repetición)</span>
          ) : <div className="view-toggle">
            {RADII.map((r) => (
              <button key={r} className={radius === r ? "active" : ""} onClick={() => pickRadius(r)}>±{windowFor(r)}</button>
            ))}
          </div>}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {LAYERS.map((l) => {
            const on = layers[l.key];
            return (
              <button
                key={l.key}
                onClick={() => toggleLayer(l.key)}
                aria-pressed={on}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                  border: `1px solid ${on ? l.color : "var(--border)"}`, background: on ? "var(--panel-2)" : "transparent",
                  color: on ? "var(--text)" : "var(--faint)",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 999, background: on ? l.color : "var(--border)" }} />
                {l.label}
              </button>
            );
          })}
          <button onClick={() => setAllLayers(true)} style={{ fontSize: 12, background: "none", border: "none", color: "var(--accent)", cursor: "pointer" }}>Todo</button>
          <button onClick={() => setAllLayers(false)} style={{ fontSize: 12, background: "none", border: "none", color: "var(--accent)", cursor: "pointer" }}>Nada</button>
          <button onClick={() => saveLayers(DEFAULT_LAYERS)} style={{ fontSize: 12, background: "none", border: "none", color: "var(--accent)", cursor: "pointer" }}>Restablecer</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, letterSpacing: 0.5 }}>ZOOM</span>
          {ZOOMS.map((z) => {
            const on = zoom === z.min;
            const label = z.min == null && isNightInst && !tick ? "Toda la noche" : z.label;
            return (
              <button
                key={z.label}
                onClick={() => pickZoom(z.min)}
                aria-pressed={on}
                style={{
                  padding: "4px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                  border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                  background: on ? "var(--accent-dim)" : "transparent", color: on ? "var(--text)" : "var(--muted)", fontWeight: on ? 700 : 500,
                }}
              >
                {label}
              </button>
            );
          })}
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, letterSpacing: 0.5, marginLeft: 14 }}>ALTURA</span>
          {([[false, "Normal"], [true, "Ajustada al precio"]] as const).map(([v, label]) => {
            const on = fitHeight === v;
            return (
              <button
                key={label}
                onClick={() => pickFit(v)}
                aria-pressed={on}
                title={v ? "Solo los strikes por donde anduvo el precio en el tiempo visible, con filas más altas" : "Todos los strikes del radio elegido"}
                style={{
                  padding: "4px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                  border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                  background: on ? "var(--accent-dim)" : "transparent", color: on ? "var(--text)" : "var(--muted)", fontWeight: on ? 700 : 500,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {layers.volumen_delta && layers.agresor && !isNightInst && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, letterSpacing: 0.5 }}>Δ VOLUMEN</span>
            {VOL_WINDOWS.map((w) => {
              const on = volWin === w.sec;
              return (
                <button key={w.label} onClick={() => pickVolWin(w.sec)} aria-pressed={on}
                  title={w.sec ? `Delta de los últimos ${w.label} cerrados (contratos reales al bid/ask)` : "Delta acumulado del día"}
                  style={{
                    padding: "4px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                    background: on ? "var(--accent-dim)" : "transparent", color: on ? "var(--text)" : "var(--muted)", fontWeight: on ? 700 : 500,
                  }}>
                  {w.label}
                </button>
              );
            })}
            <span style={{ fontSize: 11, color: "var(--faint)" }}>
              {vol ? `panel derecho en contratos reales · Δ = (calls compradas − vendidas) − (puts compradas − vendidas) · ◆ naranja = volumen delta inusual en 1 min (se queda 3 min) · click en un strike = minuto a minuto` : "cargando el volumen de cada contrato (la primera vez tarda ~10 s)…"}
            </span>
          </div>
        )}
        {changesToShow.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 12 }}>
            <span style={{ color: "var(--muted)", fontWeight: 600 }}>Niveles que se movieron:</span>
            {changesToShow.slice(0, 6).map((c) => (
              <span key={`${c.at}-${c.label}`} style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--panel-2)" }}>
                {new Date(c.at).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false })}{" "}
                <b>{c.label}</b> {fmt(c.from, c.label.includes("VIX") ? 2 : 0)} → <b style={{ color: c.to > c.from ? "var(--green)" : "var(--red-soft)" }}>{fmt(c.to, c.label.includes("VIX") ? 2 : 0)}</b>
              </span>
            ))}
          </div>
        )}
        {layers.premarket && !isNightInst && <VisionFuturaPremarketZones report={pmReport} spot={view.spot.spx} date={pmDate} main={labels.main} />}
        {!tick && data.priceSeriesApprox && chartCandles.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--amber-text)" }}>La línea de precio de hoy sale de {labels.etf} convertido a {labels.main} (MarketSnack no tiene la gráfica intradía del índice); el punto en vivo es el {labels.main} real.</div>
        )}
        {view.rows.length === 0 ? (
          <div className="wheel-empty">{levelsSrc} no devolvió contratos para {view.expiration}.</div>
        ) : (
          <VisionFuturaChart
            rows={view.rows}
            spot={view.spot.spx}
            priceSeries={view.priceSeries}
            candles={chartCandles}
            zoomMinutes={zoom}
            fitHeight={fitHeight}
            nightSession={isNightInst && !tick}
            history={view.history}
            keyLevels={view.keyLevels}
            dealerLevels={view.dealerLevels}
            expectedMove={view.expectedMove}
            conversion={view.conversion}
            layers={layers}
            prevAggressor={tick ? replayPrevAgg : prevAgg}
            unusual={tick ? replayUnusual : liveUnusual}
            vix={vixStrip}
            premium={tick ? null : data.marketSnack?.premium ?? null}
            unusualMs={tick ? null : data.marketSnack?.unusual ?? null}
            unusualExits={tick ? null : data.marketSnack?.unusualExits ?? null}
            positions={positionsView}
            volDelta={(() => {
              if (!vol || !layers.volumen_delta) return null;
              // Repetición: solo si es el mismo día que trae tastytrade; hasta el paso elegido.
              const volDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(vol.sessionOpen * 1000));
              if (tick && replay?.date !== volDate) return null;
              const toT = tick ? Math.floor(tick.time / 60) * 60 : vol.asOfT;
              const label = VOL_WINDOWS.find((w) => w.sec === volWin)?.label ?? "1 min";
              return {
                rows: volDeltaRows(vol.minutes, toT, volWin), minutes: vol.minutes, windowLabel: volWin == null ? "día" : `últ. ${label}`, toT,
                spikes: detectVolumeSpikes(vol.minutes, toT, vol.sessionOpen),
              };
            })()}
            premarket={pmReport ? { low: pmReport.range.low, high: pmReport.range.high, extLow: pmReport.extended.low, extHigh: pmReport.extended.high } : null}
          />
        )}
        <VisionFuturaPositionLog positions={positionsView} />
        <div style={{ fontSize: 12, color: "var(--faint)" }}>
          Posicionamiento (en medio de la gráfica, debajo de las velas): verde → se posicionan para arriba (compra de calls + venta de puts); morado ← para abajo (venta de calls + compra de puts).
          Agresor: ← lo vendido pegando al bid, compras → lo comprado pegando al ask; ▲▼ = cambio contra el refresco anterior.
          Cada barra de posicionamiento va partida: tono fuerte pegado al centro = CALLS (C), tono claro afuera = PUTS (P). Verde: C = calls compradas, P = puts vendidas. Morado: C = calls vendidas, P = puts compradas. Haz click en la fila de un strike (posicionamiento o agresor) para ver su detalle; otro click, Esc o click afuera la cierra.
          Posicionamiento: +$ en la orilla = cuánto creció ese lado desde el refresco anterior. Strike en amarillo = compra o venta inusual (salto grande de un refresco a otro; queda encendido 3 min).
        </div>
        <button onClick={() => setShowTable((v) => !v)} style={{ alignSelf: "flex-start", fontSize: 12, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}>
          {showTable ? "Ocultar tabla detallada" : "Ver tabla detallada por strike"}
        </button>
        {showTable && view.rows.length > 0 && <Ladder rows={view.rows} spot={view.spot.spx} maxGex={maxGex} />}
      </div>
      <VisionFuturaContextPanel
        zoomMinutes={zoom}
        replayDate={tick && replay ? replay.date : null}
        untilSec={tick ? tick.time : null}
      />
      </div>

      <VisionFuturaHybrid
        day={tick ? replayHybrid : view.hybrid ?? null}
        replayPrices={tick ? replayHybridPrices : null}
        nowMs={tick ? tickMs : Date.now()}
        conversion={view.conversion}
        instrument={inst}
        night={isNightInst}
      />

      <VisionFuturaMoney
        reading={tick ? tick.money ?? null : view.money?.reading ?? null}
        trades={tick ? replay?.moneyTrades ?? [] : view.money?.trades ?? []}
        replay={tick && replay ? { tickMs, spot: tick.spot.spx, isLastTick: replayIdx >= replay.ticks.length - 1, partial: replay.partial } : null}
        spot={view.spot.spx}
        marketOpen={view.marketOpen}
        night={isNightInst}
        main={labels.main}
        instrumentos={labels.etf || labels.future
          ? { largo: `calls de ${labels.main}${labels.etf ? `/${labels.etf}` : ""}${labels.future ? ` o comprar ${labels.future}` : ""}`, corto: `puts de ${labels.main}${labels.etf ? `/${labels.etf}` : ""}${labels.future ? ` o vender ${labels.future}` : ""}` }
          : { largo: `comprar ${labels.main} (acciones o calls)`, corto: `vender ${labels.main} (acciones o puts)` }}
        conv={(x) => ({ spy: spyRatio != null ? x * spyRatio : null, es: esBasis != null ? x + esBasis : null })}
        etfLabel={labels.etf}
        futLabel={labels.future}
        mult={inst === "NQ" ? { big: 20, bigLabel: "$ por 1 /NQ" } : inst === "TSLA" ? { big: 100, bigLabel: "$ por 100 acciones" } : { big: 50, bigLabel: "$ por 1 /ES" }}
      />

      <VisionFuturaAlerts alerts={alertsWithResults} watch={view.watch ?? []} marketOpen={view.marketOpen} />

      <VisionFuturaSpreads
        spreads={tick ? null : view.spreads}
        error={tick ? null : view.spreadsError}
        expiration={view.expiration}
        marketOpen={view.marketOpen}
        replay={!!tick}
        replayTrades={tick && replay?.spreadTrades ? {
          trades: replay.spreadTrades,
          tickMs,
          spot: tick.spot.spx,
          isLastTick: replayIdx >= replay.ticks.length - 1,
          partial: replay.partial,
          atClose: !!replay.expiration && replay.expiration !== replay.date,
        } : null}
      />

      {!isNightInst && (
        <VisionFuturaLottos
          live={tick ? null : view.lottos ?? null}
          marketOpen={view.marketOpen}
          replay={tick && replay ? {
            ideas: tick.lottos,
            trades: replay.lottoTrades ?? [],
            tickMs,
            spot: tick.spot.spx,
            isLastTick: replayIdx >= replay.ticks.length - 1,
            partial: replay.partial,
          } : null}
        />
      )}

      {isSpx && <VisionFuturaAmiga replayDate={tick && replay ? replay.date : null} replayTickMs={tick ? tickMs : null} />}
    </div>
    </FutureFirstContext.Provider>
    </VisionLabelsContext.Provider>
  );
}
