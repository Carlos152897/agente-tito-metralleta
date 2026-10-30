"use client";

// Gráfica de VisionFutura (Carlos, oct 2026, con captura de referencia):
// escalera de strikes en el eje Y y la sesión 9:30–16:00 ET en el eje X.
// Encima: el precio del día, barras de posicionamiento por strike, los
// niveles (Magneto, imanes, techos, pisos, flip, max pain, charm, dealers,
// rango VIX) y su historial; a la derecha, el panel del agresor (compras al
// ask / ventas al bid). Cada capa se prende/apaga desde VisionFuturaTab
// (`layers`) para que la gráfica no se vea sobrecargada. SVG propio: la
// escalera con filas por strike no encaja en lightweight-charts.

import type { PosHistory } from "@/lib/visionFuturaPositioning";
import { positioningParts, positioningSides, type FlowSnapshot, type UnusualHit } from "@/lib/visionFuturaFlowChanges";
import type { RowWithLegs } from "@/lib/visionFuturaLegs";
import type { MsPremiumMinute } from "@/lib/marketsnack";
import { premiumNewMoney, premiumSeries } from "@/lib/visionFuturaPremium";
import { unusualDots, type RowMultiExp, type UnusualDot } from "@/lib/visionFuturaMultiExp";
import type { DotExit } from "@/lib/visionFuturaUnusualExit";
import type { MsUnusualTrade } from "@/lib/marketsnack";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVisionLabels } from "./visionLabels";
import { POSITION_LABEL, type StrikeMinute, type VolDeltaRow, type VolSpike } from "@/lib/visionFuturaVolumeDelta";
import type { DealerLevel, KeyLevel, KeyLevelKind, VisionStrikeRow, ExpectedMove, Conversion } from "@/lib/visionFutura";

export type LayerKey =
  | "precio"
  | "posicionamiento"
  | "magneto"
  | "iman_positivo"
  | "iman_negativo"
  | "resistencia"
  | "piso"
  | "gamma_flip"
  | "max_pain"
  | "charm"
  | "dealers"
  | "rango_vix"
  | "historial"
  | "historial_ls"
  | "agresor"
  | "vix"
  | "spreads"
  | "prima"
  | "inusuales_ms"
  | "premarket"
  | "volumen_delta";

export const LAYERS: { key: LayerKey; label: string; color: string }[] = [
  { key: "precio", label: "Precio", color: "#2dd4bf" },
  { key: "posicionamiento", label: "Posicionamiento", color: "#12b76a" },
  { key: "spreads", label: "Spreads en gris", color: "#5b6478" },
  { key: "magneto", label: "Magneto", color: "#a78bfa" },
  { key: "iman_positivo", label: "Imán +", color: "#12b76a" },
  { key: "iman_negativo", label: "Imán −", color: "#f97066" },
  { key: "resistencia", label: "Resistencias", color: "#fdb022" },
  { key: "piso", label: "Pisos", color: "#38bdf8" },
  { key: "gamma_flip", label: "Gamma flip", color: "#f472b6" },
  { key: "max_pain", label: "Max pain", color: "#9aa5c0" },
  { key: "charm", label: "Charm", color: "#facc15" },
  { key: "dealers", label: "Dealers", color: "#e879f9" },
  { key: "rango_vix", label: "Rango VIX", color: "#94a3b8" },
  { key: "historial", label: "Historial de niveles", color: "#a78bfa" },
  { key: "historial_ls", label: "Historial Long/Short", color: "#12b76a" },
  { key: "agresor", label: "Agresor", color: "#2f6bff" },
  { key: "vix", label: "Mini VIX", color: "#f97066" },
  { key: "prima", label: "Prima neta", color: "#7aa2ff" },
  { key: "inusuales_ms", label: "Inusuales MarketSnack", color: "#facc15" },
  { key: "premarket", label: "Premarket", color: "#d4a373" },
  { key: "volumen_delta", label: "Volumen delta", color: "#38bdf8" },
];

export const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  precio: true, posicionamiento: true, magneto: true, iman_positivo: true, iman_negativo: true,
  resistencia: true, piso: true, gamma_flip: false, max_pain: false, charm: false,
  dealers: false, rango_vix: false, historial: false, historial_ls: true, agresor: true, vix: true, spreads: true, prima: true, inusuales_ms: true, premarket: true, volumen_delta: true,
};

const COLOR = Object.fromEntries(LAYERS.map((l) => [l.key, l.color])) as Record<LayerKey, string>;
const POS_DOWN = "#a855f7"; // morado: se posicionan para abajo
// Tono claro de cada lado = la parte que viene de PUTS (el fuerte = CALLS).
const POS_UP_PUT = "#86efac";
// Parte de la barra que viene de spreads (varias patas): no dice dirección.
const SPREAD_GRAY = "#5b6478";
const POS_DOWN_PUT = "#d8b4fe";
const CHARM_NEG = "#fb923c";

export interface HistoryPoint {
  time: number;
  magnet: number;
  callWall: number;
  putWall: number;
  gammaFlip: number | null;
  maxPain: number;
}

interface Props {
  rows: VisionStrikeRow[];
  spot: number;
  priceSeries: { time: number; value: number }[];
  /**
   * Velas japonesas de 1 min (tastytrade). Si vienen, el precio se dibuja con velas en vez de
   * la línea (Carlos, 26-oct: "que la gráfica salga en velas japonesas… minuto a minuto").
   */
  candles?: CandleBar[] | null;
  /**
   * Zoom de horas: solo los últimos N minutos (60 = última hora, 120 = 2 horas); null = todo el
   * día. Con menos minutos en el eje las velas salen más anchas (Carlos, 26-oct).
   */
  zoomMinutes?: number | null;
  /**
   * Zoom vertical: solo los strikes por donde anduvo el precio en la ventana visible (+ margen),
   * con filas más altas para que la gráfica mida lo mismo — velas más altas cuando el precio se
   * mueve poco (Carlos, 26-oct). Los niveles que quedan fuera se marcan en la orilla con flecha.
   */
  fitHeight?: boolean;
  /** 🌙 Modo noche: eje X desde la apertura de futuros (6 pm NY) hasta ahora, no 9:30–16:00. */
  nightSession?: boolean;
  history: HistoryPoint[];
  keyLevels: KeyLevel[];
  dealerLevels: DealerLevel[];
  expectedMove: ExpectedMove | null;
  conversion: Conversion;
  layers: Record<LayerKey, boolean>;
  /** Refresco anterior por strike: compras/ventas (flechas ▲▼) y lados del posicionamiento (crecimiento). */
  prevAggressor: Map<number, FlowSnapshot> | null;
  /** Compras/ventas inusuales vigentes: el strike se enciende en amarillo. */
  unusual?: UnusualHit[];
  /** Mini gráfica del VIX en una franja bajo el precio, con el mismo eje de hora. */
  vix?: VixStrip | null;
  /** Prima neta por minuto de MarketSnack (calls / puts acumuladas del día) — franja "Prima neta". */
  premium?: MsPremiumMinute[] | null;
  /** Operaciones inusuales de MarketSnack, una por una → puntos (hora × strike). */
  unusualMs?: MsUnusualTrade[] | null;
  /** Inusuales que (estimado) ya salieron: se dibujan como círculo vacío y tenue. */
  unusualExits?: Record<number, DotExit> | null;
  /** Historial Long/Short del día (lib/visionFuturaPositioning.ts): franjas por strike y marcas de presión. */
  positions?: Pick<PosHistory, "segments" | "events"> | null;
  /** Zonas del pronóstico de pre-mercado (rango principal y extensión) → líneas "Zona pre" / "Extensión". */
  premarket?: { low: number; high: number; extLow: number; extHigh: number } | null;
  /**
   * Volumen DELTA real en contratos (velas de 1 min de cada call/put, al bid y al ask): si viene, el
   * panel de la derecha muestra el delta de la ventana elegida en vez del $ neto, la posición que
   * domina en cada strike y, en la tarjeta del strike, el minuto a minuto.
   */
  volDelta?: { rows: VolDeltaRow[]; minutes: Map<number, StrikeMinute[]>; windowLabel: string; toT: number; spikes: VolSpike[] } | null;
}

export interface CandleBar { time: number; open: number; high: number; low: number; close: number }

const CANDLE_UP = "#22c55e";
const CANDLE_DOWN = "#ef4444";

export interface VixStrip {
  series: { time: number; value: number }[];
  prevClose: number | null;
  /** Magneto VIX actual y su historial (solo SPX). */
  magnet: number | null;
  magnetSeries: { time: number; value: number }[];
}

/** Alto normal de cada fila (strike). Con `fitHeight` la fila crece (ver rowH en el componente). */
const ROW_H_BASE = 20;
const ROW_H_MAX = 80;

/** Posicionamiento (Carlos, 29-oct, con captura de referencia): ya no va en una columna a la
 *  izquierda, va EN MEDIO del plot del precio — eje al centro, morado ← y verde →, debajo de las
 *  velas. Margen de cada lado para el "▲$" de crecimiento en la punta de la barra. */
const POS_EDGE = 40;
/** Transparencia de las barras de posicionamiento (las velas van encima y se tienen que ver). */
const POS_OPACITY = 0.62;
/** Panel del agresor (Carlos, 27-oct, captura de referencia del zip): GEX · barra NETA compra−venta
 *  centrada con su monto y ▲▼ afuera · strike. La columna de "inusual"/presión va aparte (UNUSUAL_W). */





/** Cuánto se queda marcada en la fila una marca de presión Long/Short. */
const PRESSURE_LIT_MS = 15 * 60_000;
/** Columna propia de las etiquetas de niveles, a la derecha del precio (Carlos, 27-oct: las
 *  etiquetas dentro del plot tapaban las velas — "se ve todo amontonado"). */

const SPOT_KEY = "__spot";
/** Ancho mínimo del plot del precio: si no cabe, la gráfica se desliza de lado en vez de aplastarse. */

/** Nombres cortos para las etiquetas (los largos siguen en la tarjeta y en la lista de niveles). */
const SHORT_LABEL: Record<string, string> = {
  "Resistencia (Call Wall)": "Call Wall",
  "Piso (Put Wall)": "Put Wall",
  "Imán positivo": "Imán +",
  "Imán negativo": "Imán −",
  "Resistencia": "Resist.",
  "Gamma flip": "Flip",
};
/** Columna extra del agresor para la etiqueta "Compra/Venta inusual". */

const UNUSUAL = "#facc15";
/** Volumen delta inusual (contratos en un minuto, lib/visionFuturaVolumeDelta.ts): NARANJA, aparte del amarillo de $. */
const VOL_SPIKE = "#ff8a1f";
/** "+C 874" / "−P 2,025": compran (+) o venden (−) calls (C) o puts (P). */
const spikeTag = (k: VolSpike["kind"]) => `${k.startsWith("compran") ? "+" : "−"}${k.endsWith("calls") ? "C" : "P"}`;

/**
 * Anchos de las columnas. Si la gráfica no cabe en su caja se usan los compactos, para que se vea
 * todo sin zoom del navegador (Carlos, 29-oct). Normal: LABEL 150 · niveles 168 · agresor 330+128.
 */
function sizesFor(boxW: number) {
  const compact = boxW < 1150;
  return compact
    ? { compact, LABEL_W: 118, LEVEL_W: 120, AGG_GEX_W: 44, AGG_TXT_W: 48, AGG_HALF: 34, AGG_STRIKE_W: 44, RIGHT_W: 252, UNUSUAL_W: 80, MIN_PLOT: 220, LBL_FONT: 10 }
    : { compact, LABEL_W: 150, LEVEL_W: 168, AGG_GEX_W: 56, AGG_TXT_W: 62, AGG_HALF: 48, AGG_STRIKE_W: 52, RIGHT_W: 330, UNUSUAL_W: 128, MIN_PLOT: 360, LBL_FONT: 11 };
}
/** Cruce (compra y venta inusual del mismo tamaño en el strike): gris, no es dirección. */
const CRUCE = "#9aa5c0";
const TOP = 8;
const BOTTOM = 40;
/** Franja del mini VIX (Carlos: "cerca de la gráfica del activo, pero pequeña"). */
const VIX_H = 72;
const VIX_GAP = 10;
const VIX_UP = "#f97066"; // VIX sube = miedo sube
const VIX_DOWN = "#12b76a";
const VIX_MAG = "#a78bfa";

/** Offset de Nueva York (ej. "-04:00") para una fecha dada. */
function nyOffset(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${dateStr}T16:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-05:00";
}

/** Sesión de futuros: desde las 6 pm NY más recientes hasta un poco después de ahora. */
function nightBounds(refSec: number): { open: number; close: number } {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(refSec * 1000));
  let open = Date.parse(`${d}T18:00:00${nyOffset(d)}`) / 1000;
  if (open > refSec) open -= 24 * 3600;
  const close = refSec + Math.max(30 * 60, (refSec - open) * 0.08);
  return { open, close };
}

function sessionBounds(refSec: number): { open: number; close: number } {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(refSec * 1000));
  const off = nyOffset(d);
  return {
    open: Date.parse(`${d}T09:30:00${off}`) / 1000,
    close: Date.parse(`${d}T16:00:00${off}`) / 1000,
  };
}

const hm = (sec: number, withSec = false) =>
  new Date(sec * 1000).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", ...(withSec ? { second: "2-digit" } : {}), hour12: false });

const n2 = (v: number | null, d = 2) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));

const money = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : a > 0 ? a.toFixed(0) : "0";
};

/** Montos con un decimal (490.3K, 2.18M), como en la captura de referencia. */
const money1 = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
};

const gexM = (v: number) => {
  const m = v / 1e6;
  return Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(2)}B` : m.toFixed(1);
};

interface Chip { y: number; text: string; color: string; dashed?: boolean; key: string; offscreen?: boolean }

export default function VisionFuturaChart(props: Props) {
  const lb = useVisionLabels();
  const { rows: allRows, spot, priceSeries, history, keyLevels, dealerLevels, expectedMove, conversion, layers, prevAggressor } = props;
  const unusualBy = new Map<number, UnusualHit>();
  for (const h of props.unusual ?? []) {
    const cur = unusualBy.get(h.strike);
    if (!cur || h.delta > cur.delta) unusualBy.set(h.strike, h);
  }
  const wrapRef = useRef<HTMLDivElement>(null);
  const [boxW, setWidth] = useState(900);
  // Tarjeta de detalle al hacer CLICK en una fila (posicionamiento, strike o agresor). Carlos: "solo cuando le dé click".
  const [hover, setHover] = useState<{ strike: number; cx: number; cy: number } | null>(null);
  // Cruz de lectura (pasar el mouse por el precio o el VIX): hora + precio + VIX en ese momento.
  const [cross, setCross] = useState<number | null>(null);
  // Punto de operación inusual de MarketSnack elegido (click): tarjeta con el detalle.
  const [dotSel, setDotSel] = useState<{ d: UnusualDot; cx: number; cy: number } | null>(null);
  useEffect(() => {
    if (!dotSel) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.("[data-vf-dot]") || el?.closest?.("[data-vf-dotcard]")) return;
      setDotSel(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDotSel(null); };
    const onScroll = () => setDotSel(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [dotSel]);
  useEffect(() => {
    if (!hover) return;
    // Se cierra con un click fuera de las filas, con Esc o al desplazar la página.
    const onDown = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.("[data-vf-hit]") || el?.closest?.("[data-vf-card]")) return;
      setHover(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setHover(null); };
    const onScroll = () => setHover(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [hover]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(760, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(760, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const { compact, LABEL_W, LEVEL_W, AGG_GEX_W, AGG_TXT_W, AGG_HALF, AGG_STRIKE_W, RIGHT_W, UNUSUAL_W, MIN_PLOT, LBL_FONT } = sizesFor(boxW);
  // "Ahora" = lo más reciente entre la línea de precio y la última vela (en la repetición minuto a
  // minuto la vela va adelante del punto de 5 min).
  const refSec = Math.max(
    priceSeries.at(-1)?.time ?? -Infinity,
    props.candles?.at(-1)?.time ?? -Infinity,
  ) > -Infinity
    ? Math.max(priceSeries.at(-1)?.time ?? -Infinity, props.candles?.at(-1)?.time ?? -Infinity)
    : history.at(-1)?.time ?? Date.now() / 1000;
  const session = props.nightSession ? nightBounds(refSec) : sessionBounds(refSec);
  // Zoom: ventana de N min que termina un poco después del último precio (margen ~8% a la derecha
  // para que la vela actual no quede pegada a la orilla), sin salirse de la sesión.
  const zoomSec = props.zoomMinutes ? props.zoomMinutes * 60 : null;
  const close = zoomSec
    ? Math.min(session.close, Math.max(session.open + zoomSec, refSec + zoomSec * 0.08))
    : session.close;
  const open = zoomSec ? Math.max(session.open, close - zoomSec) : session.open;

  // ── Zoom vertical: recorta los strikes al rango del precio visible y agranda las filas ──
  let rows = allRows;
  let ROW_H = ROW_H_BASE;
  if (props.fitHeight && allRows.length > 0) {
    const inWin = (props.candles ?? []).filter((c) => c.time >= open && c.time < close);
    const vals = inWin.length > 0
      ? inWin.flatMap((c) => [c.high, c.low])
      : priceSeries.filter((p) => p.time >= open && p.time <= close).map((p) => p.value);
    vals.push(spot);
    const hi = Math.max(...vals), lo = Math.min(...vals);
    const st = allRows.length > 1 ? Math.abs(allRows[0].spx - allRows[1].spx) || 5 : 5;
    const pad = Math.max(2 * st, (hi - lo) * 0.15);
    let cut = allRows.filter((r) => r.spx <= hi + pad && r.spx >= lo - pad);
    if (cut.length < 6) {
      // Muy pocos strikes: los 6 más cercanos al precio, en el orden original (de mayor a menor).
      const near = new Set([...allRows].sort((a, b) => Math.abs(a.spx - spot) - Math.abs(b.spx - spot)).slice(0, 6).map((r) => r.spx));
      cut = allRows.filter((r) => near.has(r.spx));
    }
    rows = cut;
    const totalH = Math.max(allRows.length * ROW_H_BASE, 400);
    ROW_H = Math.max(ROW_H_BASE, Math.min(ROW_H_MAX, Math.floor(totalH / rows.length)));
  }

  /** Desplazamiento para centrar en la fila el contenido pensado para filas de 20 px. */
  const rowMid = (ROW_H - ROW_H_BASE) / 2;
  const strikes = useMemo(() => rows.map((r) => r.spx), [rows]); // de mayor a menor
  const step = useMemo(() => {
    let m = Infinity;
    for (let i = 1; i < strikes.length; i++) m = Math.min(m, Math.abs(strikes[i - 1] - strikes[i]));
    return Number.isFinite(m) && m > 0 ? m : 5;
  }, [strikes]);

  if (rows.length === 0) return null;

  const rightW = layers.agresor ? RIGHT_W + UNUSUAL_W : 0;
  const plotL = LABEL_W;
  const width = Math.max(boxW, plotL + MIN_PLOT + LEVEL_W + 12 + rightW);
  const plotR = width - rightW - LEVEL_W - 12;
  /** Columna de etiquetas de niveles: entre el precio y el agresor. */
  const levL = plotR + 6;
  const plotW = Math.max(200, plotR - plotL);
  const plotBottom = TOP + rows.length * ROW_H;
  const maxStrike = strikes[0];
  const minStrike = strikes[strikes.length - 1];

  const y = (price: number) => TOP + ((maxStrike - price) / step) * ROW_H + ROW_H / 2;
  const inView = (price: number) => price <= maxStrike + step / 2 && price >= minStrike - step / 2;

  const x = (sec: number) => plotL + ((Math.min(Math.max(sec, open), close) - open) / (close - open)) * plotW;
  const nowSec = Math.min(Math.max(refSec, open), close);
  const nowX = x(nowSec);

  // ── Mini VIX: franja bajo el precio, misma hora en X; escala propia en Y ──
  const vixPts = (props.vix?.series ?? []).filter((p) => p.time >= open && p.time <= close);
  const vixOn = layers.vix && !props.nightSession && vixPts.length > 0;
  const vixTop = plotBottom + VIX_GAP;
  const vixBottom = vixTop + VIX_H;
  // ── Prima neta (MarketSnack, por minuto): franja bajo el VIX (o bajo el precio) ──
  const premPts = premiumSeries(props.premium ?? []).filter((p) => p.time >= open && p.time <= close);
  const premOn = layers.prima && !props.nightSession && premPts.length > 1;
  const premTop = (vixOn ? vixBottom : plotBottom) + VIX_GAP;
  const premBottom = premTop + VIX_H;
  const height = (premOn ? premBottom : vixOn ? vixBottom : plotBottom) + BOTTOM;
  const gridBottom = premOn ? premBottom : vixOn ? vixBottom : plotBottom;
  const premAbs = Math.max(1, ...premPts.flatMap((p) => [Math.abs(p.call), Math.abs(p.put)]));
  const py = (v: number) => premTop + VIX_H / 2 - (v / premAbs) * (VIX_H / 2 - 6);
  const premPath = (k: "call" | "put") => premPts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.time).toFixed(1)},${py(p[k]).toFixed(1)}`).join("");
  const premLast = premPts.at(-1) ?? null;
  const premNew = premOn && premLast ? premiumNewMoney(premPts, premLast.time * 1000) : null;
  const vixLast = vixPts.at(-1)?.value ?? null;
  // Referencia del día: cierre anterior; si no hay (fin de semana / repetición vieja), la apertura.
  const vixPrevClose = props.vix?.prevClose ?? null;
  const vixPrev = vixPrevClose ?? vixPts[0]?.value ?? null;
  const vixRefLabel = vixPrevClose != null ? "cierre ant." : "apertura";
  const vixMag = props.vix?.magnet ?? null;
  const vixVals = vixPts.map((p) => p.value);
  const vixHi = vixVals.length ? Math.max(...vixVals) : 0;
  const vixLo = vixVals.length ? Math.min(...vixVals) : 0;
  // La escala incluye el cierre anterior y el Magneto solo si están cerca (no aplastan la línea).
  const near = (v: number | null): v is number => v != null && v >= vixLo - 1.5 && v <= vixHi + 1.5;
  // El Magneto VIX solo entra a la escala si está muy cerca; si no, su etiqueta va al borde con flecha.
  const magNear = (v: number | null): v is number => v != null && v >= vixLo - 0.5 && v <= vixHi + 0.5;
  const scaleVals = [...vixVals, ...(near(vixPrev) ? [vixPrev] : []), ...(magNear(vixMag) ? [vixMag] : [])];
  let vLo = scaleVals.length ? Math.min(...scaleVals) : 0;
  let vHi = scaleVals.length ? Math.max(...scaleVals) : 1;
  if (vHi - vLo < 0.4) { const m = (vHi + vLo) / 2; vLo = m - 0.2; vHi = m + 0.2; }
  const pad = (vHi - vLo) * 0.1;
  vLo -= pad; vHi += pad;
  const vy = (v: number) => vixBottom - 5 - ((Math.min(Math.max(v, vLo), vHi) - vLo) / (vHi - vLo)) * (VIX_H - 10);
  const vixUp = vixLast != null && vixPrev != null ? vixLast >= vixPrev : true;
  const vixColor = vixUp ? VIX_UP : VIX_DOWN;
  const vixChg = vixLast != null && vixPrev ? ((vixLast - vixPrev) / vixPrev) * 100 : null;
  const vixPath = vixPts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.time).toFixed(1)},${vy(p.value).toFixed(1)}`).join("");
  const vixArea = vixPts.length > 1
    ? `${vixPath}L${x(vixPts[vixPts.length - 1].time).toFixed(1)},${vixBottom}L${x(vixPts[0].time).toFixed(1)},${vixBottom}Z`
    : "";
  // Valor más reciente <= t de una serie ordenada (para la cruz de lectura).
  const at = (arr: { time: number; value: number }[], t: number) => {
    let r: number | null = null;
    for (const p of arr) { if (p.time <= t) r = p.value; else break; }
    return r;
  };

  // ── Posicionamiento (guía de la escalera): arriba = compra calls + venta puts;
  // abajo = venta calls + compra puts. Barras en su propia columna. ──
  // Los DOS lados por strike (Carlos: "quiero saber si están aumentando de ambos lados"),
  // y cuánto creció cada uno contra el refresco anterior.
  const pos = rows.map((r) => {
    const { up, down } = positioningSides(r);
    const parts = positioningParts(r);
    const prev = prevAggressor?.get(r.spx);
    // % de una pata (MarketSnack): la parte de spreads se pinta gris (capa "Spreads en gris").
    const legs = (r as RowWithLegs).legs;
    return {
      strike: r.spx, up, down, ...parts, dUp: prev ? up - prev.up : 0, dDown: prev ? down - prev.down : 0,
      callShare: legs?.callShare ?? null, putShare: legs?.putShare ?? null,
    };
  });
  const maxPos = Math.max(1, ...pos.map((p) => Math.max(p.up, p.down)));
  // Crecimientos menores al 1% de la barra mayor no se marcan (ruido).
  const minGrowth = maxPos * 0.01;
  // Eje central de la columna: verde hacia la derecha, morado hacia la izquierda.
  const posX = plotL + plotW / 2;
  const POS_SPAN = plotW / 2 - POS_EDGE - 4;


  // ── Chips de niveles (franja derecha del plot, sin taparse) ──
  const chips: Chip[] = [];
  // Un nivel activo fuera de la ventana de strikes no se pierde: se muestra
  // pegado al borde de arriba/abajo con una flecha, sin línea.
  const addChip = (c: Omit<Chip, "y" | "offscreen">, price: number) => {
    if (inView(price)) { chips.push({ ...c, y: y(price) }); return; }
    const above = price > maxStrike;
    chips.push({ ...c, y: above ? TOP + 8 : plotBottom - 8, text: `${above ? "↑" : "↓"} ${c.text}`, offscreen: true });
  };
  const kindLayer: Record<KeyLevelKind, LayerKey> = {
    magneto: "magneto", iman_positivo: "iman_positivo", iman_negativo: "iman_negativo",
    resistencia: "resistencia", piso: "piso", gamma_flip: "gamma_flip", max_pain: "max_pain", charm: "charm",
  };
  for (const k of keyLevels) {
    const layer = kindLayer[k.kind];
    if (!layers[layer]) continue;
    // Charm − con su propio color para distinguirlo de Charm + (mismo interruptor).
    const color = k.label === "Charm −" ? CHARM_NEG : COLOR[layer];
    const lvl = Math.abs(k.spx % 1) < 0.005 ? n2(k.spx, 0) : n2(k.spx, 2);
    // ★ = los vencimientos siguientes tienen GEX del mismo signo en ese strike (lib/visionFuturaMultiExp.ts).
    const kr = rows.find((r) => Math.abs(r.spx - k.spx) <= step / 2) as (VisionStrikeRow & RowMultiExp) | undefined;
    const star = kr?.backing === "respaldado" ? "★ " : "";
    addChip({ key: `${k.label}-${k.spx}`, text: `${star}${SHORT_LABEL[k.label] ?? k.label} ${lvl}`, color, dashed: k.kind === "gamma_flip" || k.kind === "max_pain" }, k.spx);
  }
  if (layers.premarket && props.premarket) {
    const pm = props.premarket;
    addChip({ key: "pm-hi", text: `Zona pre ${n2(pm.high, 0)}`, color: COLOR.premarket }, pm.high);
    addChip({ key: "pm-lo", text: `Zona pre ${n2(pm.low, 0)}`, color: COLOR.premarket }, pm.low);
    addChip({ key: "pm-xhi", text: `Extensión ${n2(pm.extHigh, 0)}`, color: COLOR.premarket, dashed: true }, pm.extHigh);
    addChip({ key: "pm-xlo", text: `Extensión ${n2(pm.extLow, 0)}`, color: COLOR.premarket, dashed: true }, pm.extLow);
  }
  if (layers.dealers) {
    for (const d of dealerLevels) {
      const t = d.role === "resistencia" ? "Dealers: techo" : d.role === "piso" ? "Dealers: piso" : d.role === "acelera_arriba" ? "Dealers: acelera ↑" : "Dealers: acelera ↓";
      addChip({ key: `dl-${d.role}-${d.spx}`, text: `${t} ${n2(d.spx, 0)}`, color: COLOR.dealers, dashed: true }, d.spx);
    }
  }
  if (layers.rango_vix && expectedMove) {
    for (const [lvl, t] of [[expectedMove.high.spx, "VIX ↑"], [expectedMove.low.spx, "VIX ↓"]] as const) {
      addChip({ key: `vix-${t}`, text: `${t} ${n2(lvl, 0)}`, color: COLOR.rango_vix, dashed: true }, lvl);
    }
  }
  // Niveles en el mismo strike van en UNA etiqueta ("Magneto · Call Wall 7,680"), con el color
  // del primero (el orden de keyLevels ya pone Magneto e imanes antes que paredes).
  const merged: Chip[] = [];
  for (const c of chips) {
    const same = merged.find((m) => !!m.offscreen === !!c.offscreen && Math.abs(m.y - c.y) < 0.5);
    if (!same) { merged.push({ ...c }); continue; }
    const name = (t: string) => t.replace(/^[↑↓] /, "").replace(/^★ /, "").replace(/ [\d,.]+$/, "");
    const num = same.text.match(/ ([\d,.]+)$/)?.[1] ?? "";
    const arrow = same.text.match(/^[↑↓] /)?.[0] ?? "";
    // Fuera de la escala con distinto precio: se muestran los dos precios.
    const cNum = c.text.match(/ ([\d,.]+)$/)?.[1] ?? "";
    same.text = cNum === num
      ? `${arrow}${name(same.text)} · ${name(c.text)} ${num}`
      : `${same.text} · ${name(c.text)} ${cNum}`;
    same.key += `|${c.key}`;
    same.dashed = same.dashed && c.dashed;
  }
  // Empaque vertical simple: ordenados por y, mínimo 14px entre chips.
  // El precio actual entra al mismo acomodo (etiqueta rellena) para no taparse con los niveles.
  if (layers.precio && inView(spot)) merged.push({ key: SPOT_KEY, y: y(spot), text: n2(spot, 2), color: COLOR.precio });
  const GAP = 16;
  const placed = [...merged].sort((a, b) => a.y - b.y).map((c) => ({ ...c, labelY: c.y }));
  for (let i = 1; i < placed.length; i++) {
    if (placed[i].labelY - placed[i - 1].labelY < GAP) placed[i].labelY = placed[i - 1].labelY + GAP;
  }
  // Si el empuje sacó chips por abajo, se reacomodan hacia arriba desde el borde.
  for (let i = placed.length - 1; i >= 0; i--) {
    const limit = i === placed.length - 1 ? plotBottom - 8 : placed[i + 1].labelY - GAP;
    if (placed[i].labelY > limit) placed[i].labelY = limit;
  }

  // ── Historial (escalones cada 5 min) ──
  const stepPath = (pick: (h: HistoryPoint) => number | null) => {
    let d = "";
    let prev: number | null = null;
    for (const h of history) {
      const v = pick(h);
      if (v == null || !inView(v)) { prev = null; continue; }
      const px = x(h.time);
      d += prev == null ? `M${px},${y(v)}` : `H${px}V${y(v)}`;
      prev = v;
    }
    if (prev != null) d += `H${nowX}`;
    return d;
  };

  // Velas: cada una ocupa su minuto en el eje (ancho del cuerpo ~70% del espacio).
  const bars = (props.candles ?? []).filter((c) => c.time >= open && c.time < close);
  const useCandles = bars.length > 0;
  const barSec = bars.length > 1 ? Math.max(60, Math.min(...bars.slice(1).map((b, i) => b.time - bars[i].time))) : 60;
  const slotPx = (barSec / (close - open)) * plotW;
  const bodyW = Math.max(1, Math.min(14, slotPx * 0.7));
  const candleAt = (t: number) => {
    let r: CandleBar | null = null;
    for (const b of bars) { if (b.time <= t) r = b; else break; }
    return r && t - r.time < barSec ? r : null;
  };

  const pricePath = useCandles ? "" : priceSeries
    .filter((p) => p.time >= open && p.time <= close)
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join("");

  const ticks: number[] = [];
  const span = close - open;
  const tickStep = span > 12 * 3600 ? 7200 : span > 3 * 3600 ? 3600 : span > 3600 ? 1800 : 900;
  for (let t = Math.ceil(open / tickStep) * tickStep; t <= close; t += tickStep) ticks.push(t);

  const spotRowIdx = rows.reduce((best, r, i) => (Math.abs(r.spx - spot) < Math.abs(rows[best].spx - spot) ? i : best), 0);
  const conv = (s: number) => ({
    spy: conversion.spyRatio != null ? s * conversion.spyRatio : null,
    es: conversion.esBasis != null ? s + conversion.esBasis : null,
  });

  // Columnas del panel del agresor.
  const aggX = width - rightW;
  /** Centro de la barra neta compra − venta. */
  const aggC = aggX + AGG_GEX_W + AGG_TXT_W + AGG_HALF;
  const strikeX = aggX + RIGHT_W - AGG_STRIKE_W + 4;
  const unusX = aggX + RIGHT_W + 4;
  // Modo volumen delta (contratos reales al bid/ask, por minuto) o el $ neto de siempre.
  const volOn = !!props.volDelta && layers.volumen_delta;
  const volBy = new Map((props.volDelta?.rows ?? []).map((v) => [v.strike, v]));
  const spikeBy = new Map((volOn ? props.volDelta?.spikes ?? [] : []).map((v) => [v.strike, v]));
  const netOf = (r: VisionStrikeRow) => (volOn ? volBy.get(r.spx)?.delta ?? 0 : r.compras - r.ventas);
  const maxNetAgg = Math.max(1, ...rows.map((r) => Math.abs(netOf(r))));
  const fmtNet = (v: number) => (volOn ? (v >= 10_000 ? `${(v / 1000).toFixed(1)}K` : v.toLocaleString("en-US")) : money1(v));
  const spotStrike = rows.reduce((a, b) => (Math.abs(b.spx - spot) < Math.abs(a.spx - spot) ? b : a), rows[0]).spx;
  const pressureLit = new Map(
    (props.positions?.events ?? [])
      .filter((e) => e.kind === "presion" && e.t >= refSec * 1000 - PRESSURE_LIT_MS && e.t <= refSec * 1000)
      .map((e) => [e.strike, e]),
  );

  return (
    <div ref={wrapRef} style={{ overflowX: "auto" }}>
      <div style={{ position: "relative", width }}>
      <svg width={width} height={height} style={{ display: "block", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <defs>
          <clipPath id="vf-plot"><rect x={plotL} y={TOP} width={plotW} height={rows.length * ROW_H} /></clipPath>
          <clipPath id="vf-vix"><rect x={plotL} y={vixTop} width={plotW} height={VIX_H} /></clipPath>
          <clipPath id="vf-prem"><rect x={plotL} y={premTop} width={plotW} height={VIX_H} /></clipPath>
          <linearGradient id="vf-vix-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={vixColor} stopOpacity={0.28} />
            <stop offset="100%" stopColor={vixColor} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Filas */}
        {rows.map((r, i) => {
          const ry = TOP + i * ROW_H;
          const c = conv(r.spx);
          const isSpot = i === spotRowIdx;
          return (
            <g key={r.spx}>
              <rect x={0} y={ry} width={width} height={ROW_H} fill={isSpot ? "rgba(47,107,255,0.14)" : i % 2 ? "rgba(255,255,255,0.015)" : "transparent"} />
              <text x={6} y={ry + rowMid + 14} fontSize={LBL_FONT} fill={isSpot ? "#f5f7fb" : "#9aa5c0"} fontWeight={isSpot ? 700 : 400}>
                {n2(r.spx, 0)}
                {(c.spy != null || c.es != null) && (
                  <tspan fill="#6b7591">{c.spy != null ? ` · ${n2(c.spy, 1)}` : ""}{c.es != null ? ` · ${n2(c.es, 0)}` : ""}</tspan>
                )}
              </text>
            </g>
          );
        })}
        <text x={6} y={height - 8} fontSize={10} fill="#6b7591">{[lb.main, conversion.spyRatio != null ? lb.etf : null, conversion.esBasis != null ? lb.future : null].filter(Boolean).join(" · ")}</text>

        {/* Strikes con compra/venta inusual: franja amarilla en toda la fila */}
        {layers.agresor && rows.map((r, i) => unusualBy.has(r.spx) && (
          <rect key={`unu-${r.spx}`} x={0} y={TOP + i * ROW_H} width={width} height={ROW_H} fill={unusualBy.get(r.spx)?.cruce ? CRUCE : UNUSUAL} opacity={unusualBy.get(r.spx)?.cruce ? 0.07 : 0.13} />
        ))}

        {/* Strikes con volumen delta inusual (naranja), si no tienen ya el amarillo */}
        {layers.agresor && rows.map((r, i) => spikeBy.has(r.spx) && !unusualBy.has(r.spx) && (
          <rect key={`vsp-${r.spx}`} x={0} y={TOP + i * ROW_H} width={width} height={ROW_H} fill={VOL_SPIKE} opacity={0.13} />
        ))}

        {/* Columna de posicionamiento */}
        {layers.posicionamiento && (
          <g>
            <line x1={posX} x2={posX} y1={TOP} y2={plotBottom} stroke="#3a4560" strokeDasharray="2 3" />
            {pos.map((p) => {
              if (p.up === 0 && p.down === 0) return null;
              const ry = y(p.strike) - 6;
              const wu = p.up > 0 ? Math.max(1, (p.up / maxPos) * POS_SPAN) : 0;
              const wd = p.down > 0 ? Math.max(1, (p.down / maxPos) * POS_SPAN) : 0;
              // Tramo nuevo (lo que creció desde el refresco anterior), más claro en la punta de la barra.
              const gu = p.dUp > minGrowth ? Math.min(wu, Math.max(2, (p.dUp / maxPos) * POS_SPAN)) : 0;
              const gd = p.dDown > minGrowth ? Math.min(wd, Math.max(2, (p.dDown / maxPos) * POS_SPAN)) : 0;
              return (
                <g key={`pos-${p.strike}`}>
                  {/* Cada lado partido en dos: pegado al centro = CALLS (tono fuerte), afuera = PUTS (tono claro). */}
                  {(() => {
                    const wdC = p.down > 0 ? (p.callsSold / p.down) * wd : 0, wdP = wd - wdC;
                    const wuC = p.up > 0 ? (p.callsBought / p.up) * wu : 0, wuP = wu - wuC;
                    // share = % de una pata de ese tramo; la parte de spreads (1 − share) va gris en la
                    // punta de afuera del tramo (outerLeft = el tramo crece hacia la izquierda).
                    const seg = (x0: number, w: number, fill: string, label: string, txt: string, dark: boolean, share: number | null, outerLeft: boolean) => {
                      if (w <= 0) return null;
                      const gw = layers.spreads && share != null ? Math.max(0, Math.min(w, w * (1 - share))) : 0;
                      return (
                        <g>
                          <rect x={x0} y={ry} width={Math.max(1, w)} height={12} fill={fill} opacity={POS_OPACITY} />
                          {gw >= 1 && <rect x={outerLeft ? x0 : x0 + w - gw} y={ry} width={gw} height={12} fill={SPREAD_GRAY} opacity={POS_OPACITY + 0.1} style={{ pointerEvents: "none" }} />}
                          {w >= 38 && <text x={x0 + w / 2} y={ry + 10} fontSize={9} textAnchor="middle" fill={dark ? "#14111f" : "#fff"} style={{ pointerEvents: "none" }}>{label} {txt}</text>}
                        </g>
                      );
                    };
                    return (
                      <>
                        {seg(posX - wdC, wdC, POS_DOWN, "C", money(p.callsSold), false, p.callShare, true)}
                        {seg(posX - wd, wdP, POS_DOWN_PUT, "P", money(p.putsBought), true, p.putShare, true)}
                        {seg(posX, wuC, COLOR.posicionamiento, "C", money(p.callsBought), false, p.callShare, false)}
                        {seg(posX + wuC, wuP, POS_UP_PUT, "P", money(p.putsSold), true, p.putShare, false)}
                      </>
                    );
                  })()}
                  {gd > 0 && <rect x={posX - wd} y={ry} width={gd} height={12} rx={2} fill="#fff" opacity={0.35} style={{ pointerEvents: "none" }} />}
                  {gu > 0 && <rect x={posX + wu - gu} y={ry} width={gu} height={12} rx={2} fill="#fff" opacity={0.35} style={{ pointerEvents: "none" }} />}
                  {/* "▲$" en la orilla: ese lado está aumentando. */}
                  {p.dDown > minGrowth && <text x={posX - wd - 3} y={ry + 10} fontSize={9} fontWeight={700} fill={POS_DOWN} textAnchor="end">▲{money(p.dDown)}</text>}
                  {p.dUp > minGrowth && <text x={posX + wu + 3} y={ry + 10} fontSize={9} fontWeight={700} fill={COLOR.posicionamiento}>▲{money(p.dUp)}</text>}
                </g>
              );
            })}
            <text x={posX - 6} y={height - 24} fontSize={10} textAnchor="end"><tspan fill={POS_DOWN}>← abajo</tspan> <tspan fill="#6b7591">C</tspan><tspan fill={POS_DOWN}>■</tspan><tspan fill="#6b7591">P</tspan><tspan fill={POS_DOWN_PUT}>■</tspan></text>
            <text x={posX + 6} y={height - 24} fontSize={10}><tspan fill="#6b7591">C</tspan><tspan fill={COLOR.posicionamiento}>■</tspan><tspan fill="#6b7591">P</tspan><tspan fill={POS_UP_PUT}>■</tspan> <tspan fill={COLOR.posicionamiento}>arriba →</tspan>{layers.spreads && pos.some((q) => q.callShare != null || q.putShare != null) && <> <tspan fill={SPREAD_GRAY}>■</tspan><tspan fill="#6b7591"> spreads</tspan></>}</text>
          </g>
        )}

        {/* Eje de tiempo */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={TOP} y2={gridBottom} stroke="#263049" strokeWidth={0.6} />
            {/* La etiqueta "ahora" manda: se ocultan las horas que se le enciman. */}
            {Math.abs(x(t) - nowX) > 52 && x(t) < plotR - 22 && <text x={x(t)} y={height - 8} fontSize={10} fill="#6b7591" textAnchor="middle">{hm(t)}</text>}
          </g>
        ))}
        <line x1={nowX} x2={nowX} y1={TOP} y2={gridBottom} stroke="#9aa5c0" strokeDasharray="3 3" strokeWidth={1} />
        <text x={nowX} y={height - 8} fontSize={10} fill="#f5f7fb" textAnchor="middle" fontWeight={600}>ahora {hm(refSec, true)}</text>

        <g clipPath="url(#vf-plot)">
          {/* Rango VIX: franja */}
          {layers.rango_vix && expectedMove && (
            <rect x={plotL} width={plotW} y={y(expectedMove.high.spx)} height={Math.max(0, y(expectedMove.low.spx) - y(expectedMove.high.spx))} fill="rgba(148,163,184,0.06)" />
          )}

          {/* Líneas de niveles */}
          {placed.filter((c) => !c.offscreen && c.key !== SPOT_KEY).map((c) => (
            <line key={`ln-${c.key}`} x1={plotL} x2={plotR} y1={c.y} y2={c.y} stroke={c.color} strokeWidth={c.dashed ? 1 : 1.6} strokeDasharray={c.dashed ? "5 4" : undefined} opacity={0.85} />
          ))}

          {/* Historial de niveles */}
          {layers.historial && (
            <>
              <path d={stepPath((h) => h.magnet)} fill="none" stroke={COLOR.magneto} strokeWidth={3} opacity={0.5} />
              <path d={stepPath((h) => h.callWall)} fill="none" stroke={COLOR.resistencia} strokeWidth={2.5} opacity={0.45} />
              <path d={stepPath((h) => h.putWall)} fill="none" stroke={COLOR.piso} strokeWidth={2.5} opacity={0.45} />
              <path d={stepPath((h) => h.gammaFlip)} fill="none" stroke={COLOR.gamma_flip} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.6} />
            </>
          )}

          {/* Historial Long/Short: desde cuándo cada strike está Long (verde) o Short (morado);
              ● = presión Long (verde) / Short (morada) */}
          {layers.historial_ls && props.positions && (
            <g style={{ pointerEvents: "none" }}>
              {props.positions.segments.filter((sg) => inView(sg.strike)).map((sg, i) => {
                const x0 = x(sg.start / 1000);
                const x1 = sg.end != null ? x(sg.end / 1000) : nowX;
                return x1 > x0 ? (
                  <rect key={`ls-${i}`} x={x0} width={x1 - x0} y={y(sg.strike) - ROW_H / 2 + 1} height={ROW_H - 2}
                    fill={sg.side === "L" ? COLOR.posicionamiento : POS_DOWN} opacity={0.1} />
                ) : null;
              })}
              {/* Bola rellena (Carlos, 27-oct: "esa flecha hazla bola"): presión Short = morada, Long = verde. */}
              {props.positions.events.filter((e) => e.kind === "presion" && inView(e.strike)).map((e, i) => (
                <circle key={`pr-${i}`} cx={x(e.t / 1000)} cy={y(e.strike)} r={4.5} fill={e.side === "L" ? COLOR.posicionamiento : POS_DOWN}
                  stroke="#0b1020" strokeWidth={1}><title>{`${hm(e.t / 1000)} · ${e.text}`}</title></circle>
              ))}
            </g>
          )}

          {/* Precio */}
          {layers.precio && pricePath && (
            <>
              <path d={pricePath} fill="none" stroke={COLOR.precio} strokeWidth={1.8} />
              <circle cx={x(refSec)} cy={y(spot)} r={3.5} fill={COLOR.precio} />
            </>
          )}
          {layers.precio && useCandles && (
            <g>
              {bars.map((b) => {
                const cx = x(b.time) + slotPx / 2;
                const up = b.close >= b.open;
                const col = up ? CANDLE_UP : CANDLE_DOWN;
                const yo = y(b.open), yc = y(b.close);
                const top = Math.min(yo, yc);
                return (
                  <g key={b.time}>
                    <line x1={cx} x2={cx} y1={y(b.high)} y2={y(b.low)} stroke={col} strokeWidth={1} />
                    <rect x={cx - bodyW / 2} y={top} width={bodyW} height={Math.max(1, Math.abs(yc - yo))} fill={col} />
                  </g>
                );
              })}
              {/* Precio actual: línea punteada a lo ancho */}
              <line x1={plotL} x2={plotR} y1={y(spot)} y2={y(spot)} stroke={COLOR.precio} strokeWidth={0.8} strokeDasharray="2 3" opacity={0.7} />
            </g>
          )}
        </g>

        {/* Chips de etiquetas */}
        {/* Etiquetas de niveles en su propia columna (no tapan las velas) */}
        <line x1={plotR} x2={plotR} y1={TOP} y2={plotBottom} stroke="#263049" />
        {placed.map((c) => {
          if (c.key === SPOT_KEY) {
            // Precio actual: etiqueta rellena con punta hacia el plot (estilo plataforma).
            const ly = c.labelY;
            return (
              <g key="chip-spot">
                <polyline points={`${plotR},${c.y} ${levL + 4},${c.y} ${levL + 10},${ly}`} fill="none" stroke={COLOR.precio} strokeWidth={1.2} />
                <polygon points={`${levL + 4},${ly} ${levL + 11},${ly - 8} ${levL + 11},${ly + 8}`} fill={COLOR.precio} />
                <rect x={levL + 10} y={ly - 8} width={96} height={16} rx={3} fill={COLOR.precio} />
                <text x={levL + 58} y={ly + 4} fontSize={10.5} fontWeight={700} textAnchor="middle" fill="#0b1020">{lb.main} {c.text}</text>
              </g>
            );
          }
          const maxW = LEVEL_W - 14;
          const natural = c.text.length * 5.9 + 10;
          const w = Math.min(maxW, natural);
          const cx = levL + 10;
          return (
            <g key={`chip-${c.key}`}>
              {/* Conector: de la línea del nivel (orilla del plot) a su etiqueta */}
              {!c.offscreen && <polyline points={`${plotR},${c.y} ${levL + 4},${c.y} ${cx},${c.labelY}`} fill="none" stroke={c.color} strokeWidth={c.dashed ? 0.8 : 1.2} opacity={0.85} />}
              <rect x={cx} y={c.labelY - 7.5} width={w} height={15} rx={4} fill="#0f1522" stroke={c.color} strokeWidth={1} />
              <text x={cx + 5} y={c.labelY + 3.5} fontSize={10} fill={c.color} fontWeight={c.dashed ? 400 : 600}
                {...(natural > maxW ? { textLength: w - 10, lengthAdjust: "spacingAndGlyphs" as const } : {})}>
                {c.text}
              </text>
            </g>
          );
        })}

        {/* Mini VIX */}
        {vixOn && (
          <g>
            <rect x={0} y={vixTop} width={width} height={VIX_H} fill="rgba(255,255,255,0.02)" />
            <line x1={0} x2={width} y1={vixTop} y2={vixTop} stroke="#263049" />
            <line x1={0} x2={width} y1={vixBottom} y2={vixBottom} stroke="#263049" />
            {/* Lectura a la izquierda: valor, cambio del día y qué significa */}
            <text x={6} y={vixTop + 15} fontSize={10} fill="#9aa5c0" fontWeight={600} letterSpacing={0.5}>VIX</text>
            <text x={6} y={vixTop + 36} fontSize={20} fontWeight={700} fill={vixColor}>{n2(vixLast, 2)}</text>
            {vixChg != null && (
              <text x={72} y={vixTop + 36} fontSize={11} fontWeight={600} fill={vixColor}>{vixChg >= 0 ? "▲ +" : "▼ "}{vixChg.toFixed(2)}%{vixPrevClose == null ? " vs apertura" : ""}</text>
            )}
            <text x={6} y={vixTop + 52} fontSize={10} fill={vixColor}>{vixUp ? "miedo sube → presión ↓" : "miedo baja → apoya ↑"}</text>
            <text x={6} y={vixTop + 65} fontSize={9.5} fill="#6b7591">máx {n2(vixHi, 2)} · mín {n2(vixLo, 2)}</text>
            {plotL >= 300 && vixMag != null && (
              <text x={plotL - 8} y={vixTop + 15} fontSize={10} textAnchor="end" fill={VIX_MAG} fontWeight={600}>
                Magneto VIX {n2(vixMag, 2)}
                {vixLast != null && <tspan fill="#6b7591" fontWeight={400}> · {Math.abs(vixMag - vixLast).toFixed(2)} {vixMag >= vixLast ? "arriba" : "abajo"}</tspan>}
              </text>
            )}
            <g clipPath="url(#vf-vix)">
              {vixArea && <path d={vixArea} fill="url(#vf-vix-fill)" />}
              {near(vixPrev) && (
                <>
                  <line x1={plotL} x2={plotR} y1={vy(vixPrev)} y2={vy(vixPrev)} stroke="#6b7591" strokeDasharray="3 3" strokeWidth={1} />
                  <text x={plotL + 4} y={vy(vixPrev) - 3} fontSize={9} fill="#6b7591">{vixRefLabel} {n2(vixPrev, 2)}</text>
                </>
              )}
              {magNear(vixMag) && (
                <line x1={plotL} x2={plotR} y1={vy(vixMag)} y2={vy(vixMag)} stroke={VIX_MAG} strokeDasharray="5 4" strokeWidth={1.2} opacity={0.9} />
              )}
              <path d={vixPath} fill="none" stroke={vixColor} strokeWidth={1.6} />
              {vixLast != null && <circle cx={x(vixPts[vixPts.length - 1].time)} cy={vy(vixLast)} r={3} fill={vixColor} />}
            </g>
            {vixMag != null && (() => {
              // Lejos de la escala: pegado al borde con flecha (como los niveles fuera de la escalera).
              const off = !magNear(vixMag);
              const t = `${off ? (vixMag > vHi ? "↑ " : "↓ ") : ""}Mag ${n2(vixMag, 2)}`;
              const w = t.length * 6 + 10;
              const cy = off ? (vixMag > vHi ? vixTop + 9 : vixBottom - 9) : Math.min(Math.max(vy(vixMag), vixTop + 8), vixBottom - 8);
              return (
                <g>
                  <rect x={plotR - w - 2} y={cy - 7} width={w} height={14} rx={4} fill="#0f1522" stroke={VIX_MAG} />
                  <text x={plotR - w + 3} y={cy + 4} fontSize={10} fill={VIX_MAG}>{t}</text>
                </g>
              );
            })()}
            {/* Cómo leerlo, a la derecha (zona del agresor) */}
            {rightW > 0 && (
              <g>
                <text x={plotR + 14} y={vixTop + 22} fontSize={10} fill="#9aa5c0">Normal: {lb.main} ↑ con VIX ↓ (y al revés).</text>
                <text x={plotR + 14} y={vixTop + 38} fontSize={10} fill="#9aa5c0"><tspan fill={UNUSUAL} fontWeight={600}>Ojo</tspan> si suben juntos: la subida</text>
                <text x={plotR + 14} y={vixTop + 52} fontSize={10} fill="#9aa5c0">no tiene confianza (piden cobertura).</text>
              </g>
            )}
          </g>
        )}

        {/* Prima neta por minuto (MarketSnack): calls verde, puts rojo, acumuladas del día */}
        {premOn && premLast && (() => {
          const M = (v: number) => `${v >= 0 ? "+" : "−"}$${(Math.abs(v) / 1e6).toFixed(1)}M`;
          const dir = premLast.call - premLast.put;
          return (
            <g>
              <rect x={0} y={premTop} width={width} height={VIX_H} fill="rgba(255,255,255,0.02)" />
              <line x1={0} x2={width} y1={premTop} y2={premTop} stroke="#263049" />
              <line x1={0} x2={width} y1={premBottom} y2={premBottom} stroke="#263049" />
              <text x={6} y={premTop + 15} fontSize={10} fill="#9aa5c0" fontWeight={600} letterSpacing={0.5}>PRIMA NETA / min</text>
              <text x={6} y={premTop + 31} fontSize={10} fontWeight={600}><tspan fill={CANDLE_UP}>C {M(premLast.call)}</tspan><tspan fill="#6b7591"> · </tspan><tspan fill={CANDLE_DOWN}>P {M(premLast.put)}</tspan></text>
              <text x={6} y={premTop + 47} fontSize={10} fill={dir >= 0 ? CANDLE_UP : CANDLE_DOWN}>día {dir >= 0 ? "↑ ARRIBA" : "↓ ABAJO"} {M(dir)}</text>
              {premNew && (
                <text x={6} y={premTop + 63} fontSize={9.5} fill={premNew.vote > 0 ? CANDLE_UP : premNew.vote < 0 ? CANDLE_DOWN : "#6b7591"}>
                  15 min: {premNew.vote > 0 ? "↑ " : premNew.vote < 0 ? "↓ " : "· "}{M(premNew.net)}
                </text>
              )}
              <g clipPath="url(#vf-prem)">
                <line x1={plotL} x2={plotR} y1={py(0)} y2={py(0)} stroke="#6b7591" strokeDasharray="3 3" strokeWidth={1} />
                <path d={premPath("call")} fill="none" stroke={CANDLE_UP} strokeWidth={1.5} />
                <path d={premPath("put")} fill="none" stroke={CANDLE_DOWN} strokeWidth={1.5} />
                <circle cx={x(premLast.time)} cy={py(premLast.call)} r={2.5} fill={CANDLE_UP} />
                <circle cx={x(premLast.time)} cy={py(premLast.put)} r={2.5} fill={CANDLE_DOWN} />
              </g>
              {rightW > 0 && (
                <g>
                  <text x={plotR + 14} y={premTop + 22} fontSize={10} fill="#9aa5c0">Verde arriba de 0 = compran calls.</text>
                  <text x={plotR + 14} y={premTop + 38} fontSize={10} fill="#9aa5c0">Rojo arriba de 0 = compran puts.</text>
                  <text x={plotR + 14} y={premTop + 52} fontSize={10} fill="#9aa5c0">Mira si el dinero va con el precio.</text>
                </g>
              )}
            </g>
          );
        })()}

        {/* Cruz de lectura: hora + precio + VIX */}
        {cross != null && (() => {
          const cx = x(cross);
          const cb = useCandles ? candleAt(cross) : null;
          const px = cb ? cb.close : at(priceSeries, cross);
          const vx = vixOn ? at(vixPts, cross) : null;
          const priceTxt = cb
            ? `A ${n2(cb.open, 2)} · Máx ${n2(cb.high, 2)} · Mín ${n2(cb.low, 2)} · C ${n2(cb.close, 2)}`
            : n2(px, 2);
          const label = `${hm(cross)} · ${lb.main} ${priceTxt}${vx != null ? ` · VIX ${n2(vx, 2)}` : ""}`;
          const w = label.length * 6 + 12;
          const lx = Math.min(Math.max(cx - w / 2, plotL), plotR - w);
          const ly = vixOn ? vixTop + 2 : plotBottom - 18;
          return (
            <g style={{ pointerEvents: "none" }}>
              <line x1={cx} x2={cx} y1={TOP} y2={gridBottom} stroke="#f5f7fb" strokeWidth={0.8} opacity={0.6} />
              {px != null && layers.precio && inView(px) && <circle cx={cx} cy={y(px)} r={3.5} fill="none" stroke={COLOR.precio} strokeWidth={1.5} />}
              {vx != null && <circle cx={cx} cy={vy(vx)} r={3.5} fill="none" stroke={vixColor} strokeWidth={1.5} />}
              <rect x={lx} y={ly} width={w} height={16} rx={4} fill="#0f1522" stroke="#2b3756" />
              <text x={lx + 6} y={ly + 12} fontSize={10.5} fill="#f5f7fb">{label}</text>
            </g>
          );
        })()}
        <rect
          x={plotL} y={TOP} width={plotW} height={gridBottom - TOP} fill="transparent"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const t = open + ((e.clientX - r.left) / r.width) * (close - open);
            setCross(Math.min(Math.max(t, open), nowSec));
          }}
          onMouseLeave={() => setCross(null)}
          // Click en el plot = tarjeta del strike de esa fila (el posicionamiento ahora vive aquí).
          data-vf-hit=""
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const idx = Math.floor((e.clientY - r.top) / ROW_H);
            const row = rows[idx];
            if (!row) return;
            setHover((h) => (h?.strike === row.spx ? null : { strike: row.spx, cx: e.clientX, cy: e.clientY }));
          }}
        />

        {/* Panel del agresor: GEX · barra NETA (compras − ventas) centrada · strike · inusual/presión */}
        {layers.agresor && (
          <g>
            <line x1={aggC} x2={aggC} y1={TOP} y2={plotBottom} stroke="#263049" />
            {rows.map((r, i) => {
              const ry0 = TOP + i * ROW_H;
              const ry = ry0 + rowMid; // contenido centrado en la fila (filas altas con el zoom vertical)
              const net = netOf(r);
              const vd = volOn ? volBy.get(r.spx) : undefined;
              const show = Math.abs(net) >= 0.01 * maxNetAgg && net !== 0;
              const buy = net > 0;
              const w = show ? Math.max(3, (Math.abs(net) / maxNetAgg) * AGG_HALF) : 0;
              const prev = prevAggressor?.get(r.spx);
              const prevNet = volOn ? vd?.prevDelta ?? null : prev ? prev.compras - prev.ventas : null;
              const grew = prevNet == null ? 0 : Math.sign(net) !== Math.sign(prevNet) ? 1 : Math.sign(Math.abs(net) - Math.abs(prevNet));
              const arrow = !show || prevNet == null || grew === 0 ? "" : grew > 0 ? "▲" : "▼";
              const hit = unusualBy.get(r.spx);
              const sp = hit ? undefined : spikeBy.get(r.spx);
              const pr = pressureLit.get(r.spx);
              const uCol = hit?.cruce ? CRUCE : UNUSUAL;
              const col = hit && !hit.cruce ? UNUSUAL : sp ? VOL_SPIKE : buy ? "#2f6bff" : "#f04438";
              const sideCol = buy ? "#7aa2ff" : "#f97066";
              const isSpot = r.spx === spotStrike;
              return (
                <g key={`agg-${r.spx}`}>
                  {hit && <rect x={aggX + AGG_GEX_W} y={ry0 + 1} width={rightW - AGG_GEX_W - 4} height={ROW_H - 2} rx={4} fill={hit.cruce ? "rgba(154,165,192,0.08)" : "rgba(250,204,21,0.10)"} stroke={uCol} strokeWidth={1.2} strokeDasharray={hit.cruce ? "2 2" : undefined} />}
                  {sp && <rect x={aggX + AGG_GEX_W} y={ry0 + 1} width={rightW - AGG_GEX_W - 4} height={ROW_H - 2} rx={4} fill="rgba(255,138,31,0.10)" stroke={VOL_SPIKE} strokeWidth={1.2} />}
                  {!hit && !sp && pr && (
                    <rect x={aggX + AGG_GEX_W} y={ry0 + 1} width={rightW - AGG_GEX_W - 4} height={ROW_H - 2} rx={4}
                      fill={pr.side === "S" ? "rgba(168,85,247,0.12)" : "rgba(18,183,106,0.12)"} stroke={pr.side === "S" ? POS_DOWN : COLOR.posicionamiento} strokeDasharray="4 3" />
                  )}
                  <text x={aggX + AGG_GEX_W - 6} y={ry + 14} fontSize={10} textAnchor="end" fill={r.netGex > 0 ? "#12b76a" : r.netGex < 0 ? "#f97066" : "#6b7591"}>{gexM(r.netGex)}</text>
                  {show && !buy && (
                    <>
                      <text x={aggC - AGG_HALF - 4} y={ry + 14} fontSize={10} textAnchor="end" fill={arrow === "▼" ? "#9aa5c0" : sideCol}>{arrow}</text>
                      <text x={aggC - AGG_HALF - 16} y={ry + 14} fontSize={10} fontWeight={700} textAnchor="end" fill={hit && !hit.cruce ? UNUSUAL : sp ? VOL_SPIKE : "#f5f7fb"}>{fmtNet(-net)}</text>
                      <rect x={aggC - w} y={ry + 4} width={w} height={12} rx={2} fill={col} opacity={0.85} />
                    </>
                  )}
                  {show && buy && (
                    <>
                      <rect x={aggC} y={ry + 4} width={w} height={12} rx={2} fill={col} opacity={0.85} />
                      <text x={aggC + AGG_HALF + 4} y={ry + 14} fontSize={10} fill={arrow === "▼" ? "#9aa5c0" : sideCol}>{arrow}</text>
                      <text x={aggC + AGG_HALF + 16} y={ry + 14} fontSize={10} fontWeight={700} fill={hit && !hit.cruce ? UNUSUAL : sp ? VOL_SPIKE : "#f5f7fb"}>{fmtNet(net)}</text>
                    </>
                  )}
                  <text x={strikeX} y={ry + 14} fontSize={10.5} fill={isSpot || hit ? "#f5f7fb" : "#9aa5c0"} fontWeight={isSpot || hit ? 700 : 400}>{n2(r.spx, Number.isInteger(r.spx) ? 0 : 1)}</text>
                  {hit && (
                    <text x={unusX} y={ry + 14} fontSize={10} fontWeight={700} fill={uCol}>
                      {hit.cruce ? (compact ? "⇄ Cruce" : "⇄ Cruce compra/venta") : hit.side === "compra" ? (compact ? "▲ Compra" : "▲ Compra inusual") : (compact ? "▼ Venta" : "▼ Venta inusual")} +{money(hit.delta)}
                    </text>
                  )}
                  {/* Posición que domina en el strike (volumen delta): compran/venden calls/puts, en contratos. */}
                  {sp && (
                    <text x={unusX} y={ry + 14} fontSize={10} fontWeight={700} fill={VOL_SPIKE}>
                      ◆ {spikeTag(sp.kind)} {fmtNet(sp.contracts)} <tspan fill="#9aa5c0" fontWeight={400}>{hm(sp.t)}</tspan>
                    </text>
                  )}
                  {!hit && !sp && vd?.position && (
                    <text x={unusX} y={ry + 14} fontSize={10} fontWeight={700} fill={vd.position.side === "arriba" ? COLOR.posicionamiento : POS_DOWN}>
                      {vd.position.side === "arriba" ? "▲ " : "▼ "}
                      {compact
                        ? `${vd.position.kind.startsWith("compran") ? "+" : "−"}${vd.position.kind.endsWith("calls") ? "C" : "P"} ${fmtNet(vd.position.contracts)}`
                        : `${POSITION_LABEL[vd.position.kind]} ${fmtNet(vd.position.contracts)}`}
                    </text>
                  )}
                  {!hit && !vd?.position && pr && (
                    <text x={unusX} y={ry + 14} fontSize={10} fontWeight={700} fill={pr.side === "S" ? POS_DOWN : COLOR.posicionamiento}>
                      <title>{pr.text}</title>
                      {pr.side === "S" ? "● presión ↓" : "● presión ↑"} <tspan fill="#9aa5c0" fontWeight={400}>{hm(pr.t / 1000)}</tspan>
                    </text>
                  )}
                </g>
              );
            })}
            <text x={aggX + AGG_GEX_W - 6} y={height - 8} fontSize={10} textAnchor="end" fill="#6b7591">GEX $M</text>
            <text x={aggC} y={height - 16} fontSize={10} textAnchor="middle"><tspan fill="#f97066">← venta</tspan><tspan fill="#6b7591"> | </tspan><tspan fill="#7aa2ff">compra →</tspan><tspan fill="#6b7591">{volOn ? ` (Δ contratos · ${props.volDelta!.windowLabel})` : " ($ neto)"}</tspan></text>
            <text x={aggC} y={height - 4} fontSize={9} textAnchor="middle" fill="#6b7591">{volOn ? "▲▼ vs ventana anterior" : "▲▼ vs refresco anterior"}</text>
            <text x={strikeX} y={height - 8} fontSize={10} fill="#6b7591">Strike</text>
          </g>
        )}

        {/* Zonas invisibles para el detalle con un click: columna del strike + posicionamiento, y el agresor. */}
        {rows.map((r, i) => {
          const ry = TOP + i * ROW_H;
          // Click: abre la tarjeta de ese strike; click otra vez en la misma fila: la cierra.
          const click = (e: React.MouseEvent<SVGRectElement>) =>
            setHover((h) => (h?.strike === r.spx ? null : { strike: r.spx, cx: e.clientX, cy: e.clientY }));
          const on = hover?.strike === r.spx;
          return (
            <g key={`hov-${r.spx}`}>
              {on && <rect x={0} y={ry} width={plotR} height={ROW_H} fill="#ffffff" opacity={0.05} style={{ pointerEvents: "none" }} />}
              {on && layers.agresor && <rect x={aggX} y={ry} width={rightW} height={ROW_H} fill="#ffffff" opacity={0.05} style={{ pointerEvents: "none" }} />}
              <rect data-vf-hit="" x={0} y={ry} width={plotL} height={ROW_H} fill="transparent" style={{ cursor: "pointer" }} onClick={click} />
              {layers.agresor && <rect data-vf-hit="" x={aggX} y={ry} width={rightW} height={ROW_H} fill="transparent" style={{ cursor: "pointer" }} onClick={click} />}
            </g>
          );
        })}
        {/* Operaciones inusuales de MarketSnack: punto en la hora y el strike; tamaño = prima; color = dirección. */}
        {layers.inusuales_ms && !props.nightSession && (() => {
          const dots = unusualDots(props.unusualMs ?? []).filter((d) => d.time >= open && d.time <= close && inView(d.strike));
          if (!dots.length) return null;
          const maxP = Math.max(...dots.map((d) => d.premium), 1);
          return (
            <g>
              {dots.map((d) => {
                const r = 3.5 + 5.5 * Math.sqrt(d.premium / maxP);
                const fill = d.dir === "arriba" ? "#12b76a" : d.dir === "abajo" ? "#f97066" : "#9aa5c0";
                const out = props.unusualExits?.[d.id];
                const sel = dotSel?.d.id === d.id;
                // Ya salieron (estimado): círculo vacío y tenue del color de su dirección; siguen dentro: bola llena.
                return out ? (
                  <circle key={d.id} data-vf-dot="" data-vf-dot-out="" cx={x(d.time)} cy={y(d.strike)} r={r} fill="transparent"
                    stroke={fill} strokeOpacity={sel ? 0.9 : 0.4} strokeWidth={sel ? 2 : 1.2} strokeDasharray={out.kind === "estimada" ? "2 2" : undefined}
                    style={{ cursor: "pointer" }} onClick={(e) => setDotSel(sel ? null : { d, cx: e.clientX, cy: e.clientY })} />
                ) : (
                  <circle key={d.id} data-vf-dot="" cx={x(d.time)} cy={y(d.strike)} r={r} fill={fill} fillOpacity={0.85}
                    stroke={UNUSUAL} strokeWidth={sel ? 2.5 : 1.2} style={{ cursor: "pointer" }}
                    onClick={(e) => setDotSel(sel ? null : { d, cx: e.clientX, cy: e.clientY })} />
                );
              })}
            </g>
          );
        })()}
      </svg>
      {dotSel && (() => {
        const d = dotSel.d;
        const W = 270;
        const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
        const left = dotSel.cx + 14 + W > vw - 8 ? Math.max(8, dotSel.cx - W - 14) : dotSel.cx + 14;
        const top = Math.max(84, dotSel.cy - 70);
        const side = d.side.toUpperCase().includes("ASK") ? "comprado al ask" : d.side.toUpperCase().includes("BID") ? "vendido al bid" : "a mitad (sin lado)";
        const color = d.dir === "arriba" ? "#12b76a" : d.dir === "abajo" ? "#f97066" : "#9aa5c0";
        return (
          <div data-vf-dotcard="" style={{ position: "fixed", left, top, width: W, zIndex: 50, background: "#0f1522", border: `1px solid ${UNUSUAL}`, borderRadius: 10, padding: "10px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.45)", fontSize: 12, fontVariantNumeric: "tabular-nums", display: "flex", flexDirection: "column", gap: 3, color: "#c7cede" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <b style={{ color: UNUSUAL }}>Operación inusual · {hm(d.time)}</b>
              <button type="button" aria-label="Cerrar" onClick={() => setDotSel(null)} style={{ background: "none", border: "none", color: "#9aa5c0", cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
            </div>
            <div style={{ color: "#f5f7fb", fontWeight: 700 }}>{d.type === "call" ? "CALL" : "PUT"} {n2(d.strike, 0)} · {d.size} contratos @ ${d.price.toFixed(2)}</div>
            <div>Prima <b style={{ color: "#f5f7fb" }}>${money(d.premium)}</b> · {side}</div>
            <div style={{ color }}>{d.dir ? `Apunta hacia ${d.dir.toUpperCase()}` : "Sin dirección clara (a mitad: puede ser spread o cruce)"}</div>
            {(() => {
              const out = props.unusualExits?.[d.id];
              if (!d.dir) return null;
              return out ? (
                out.kind === "cierre"
                  ? <div style={{ color: "#fdb022" }}>○ Cierre: {out.text}</div>
                  : <div style={{ color: "#fdb022" }}>○ Probablemente salieron {hm(out.at)}{out.kind === "estimada" ? " (estimado)" : ""}: {out.text}</div>
              ) : (
                <div style={{ color: "#c7cede" }}>● Siguen dentro (no se ve la salida todavía)</div>
              );
            })()}
            <div style={{ color: "#6b7591", fontSize: 11 }}>MarketSnack: score {d.score} · prioridad {d.priority} · {d.sentiment}</div>
          </div>
        );
      })()}
      {hover && (() => {
        const r = rows.find((x) => x.spx === hover.strike);
        const p = pos.find((x) => x.strike === hover.strike);
        if (!r || !p || !Number.isFinite(hover.cx) || !Number.isFinite(hover.cy)) return null;
        const prev = prevAggressor?.get(r.spx);
        const dC = prev ? r.compras - prev.compras : null, dV = prev ? r.ventas - prev.ventas : null;
        const hit = unusualBy.get(r.spx);
        const sm = (v: number) => `${v < 0 ? "−" : ""}$${money(v)}`;
        const plus = (v: number | null) => (v == null ? "" : v > 0 ? ` (▲${money(v)})` : v < 0 ? ` (▼${money(-v)})` : "");
        const role: Record<string, string> = {
          resistencia: "Resistencia: dealers largos en calls, venden las subidas",
          piso: "Piso: dealers largos en puts, compran las caídas",
          acelera_arriba: "Acelera ↑: dealers cortos en calls, compran si sube",
          acelera_abajo: "Acelera ↓: dealers cortos en puts, venden si baja",
        };
        const net = p.up - p.down;
        const lean = p.up === 0 && p.down === 0 ? "sin posicionamiento hoy"
          : Math.abs(net) < 0.15 * Math.max(p.up, p.down) ? "parejo: strike en disputa"
          : net > 0 ? `domina ARRIBA por ${money(net)}` : `domina ABAJO por ${money(-net)}`;
        // Fija a la pantalla, junto al cursor, siempre visible (debajo del encabezado de la página, ~80 px).
        const W = volOn ? 360 : 300;
        const CARD_H = (volOn ? 250 : 0) + (hit ? 350 : 330) + ((r as RowWithLegs).legs ? 85 : 0) + ((r as VisionStrikeRow & RowMultiExp).multiExp?.length ? 70 : 0);
        const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
        const vh = typeof window !== "undefined" ? window.innerHeight : 800;
        const left = hover.cx + 16 + W > vw - 8 ? Math.max(8, hover.cx - W - 16) : hover.cx + 16;
        const top = Math.min(Math.max(84, hover.cy - CARD_H / 2), Math.max(84, vh - CARD_H - 8));
        const line = (label: string, value: string, color?: string) => (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ color: "#9aa5c0" }}>{label}</span><span style={{ color: color ?? "#f5f7fb", fontWeight: 600 }}>{value}</span>
          </div>
        );
        return (
          <div data-vf-card="" style={{ position: "fixed", left, top, width: W, maxHeight: "calc(100vh - 92px)", overflowY: "auto", zIndex: 50, background: "#0f1522", border: `1px solid ${hit ? UNUSUAL : "#2b3756"}`, borderRadius: 10, padding: "10px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.45)", fontSize: 12, fontVariantNumeric: "tabular-nums", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <b style={{ fontSize: 14, color: "#f5f7fb" }}>{n2(r.spx, 0)}</b>
              <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span style={{ color: r.spx > spot ? "#7aa2ff" : r.spx < spot ? "#f97066" : "#9aa5c0" }}>
                  {r.spx === spot ? "en el precio" : `${Math.abs(r.spx - spot).toFixed(1)} pts ${r.spx > spot ? "arriba" : "abajo"} del precio`}
                </span>
                <button type="button" aria-label="Cerrar" onClick={() => setHover(null)}
                  style={{ background: "none", border: "none", color: "#9aa5c0", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
              </span>
            </div>
            {hit && <div style={{ color: hit.cruce ? CRUCE : UNUSUAL, fontWeight: 700 }}>{hit.cruce ? "⇄ Cruce compra/venta (mismo tamaño: spread o cruce, no dirección)" : hit.side === "compra" ? "▲ Compra inusual" : "▼ Venta inusual"} +{money(hit.delta)} ({money(hit.before)} → {money(hit.after)})</div>}
            <div style={{ marginTop: 4, color: COLOR.posicionamiento, fontWeight: 700 }}>🟢 Arriba {money(p.up)}{p.dUp > minGrowth ? ` (▲${money(p.dUp)})` : ""}</div>
            {line("  C · calls compradas", money(p.callsBought), COLOR.posicionamiento)}
            {line("  P · puts vendidas", money(p.putsSold), POS_UP_PUT)}
            <div style={{ marginTop: 4, color: POS_DOWN, fontWeight: 700 }}>🟣 Abajo {money(p.down)}{p.dDown > minGrowth ? ` (▲${money(p.dDown)})` : ""}</div>
            {line("  C · calls vendidas", money(p.callsSold), POS_DOWN)}
            {line("  P · puts compradas", money(p.putsBought), POS_DOWN_PUT)}
            <div style={{ color: "#c7cede" }}>→ {lean}</div>
            <div style={{ borderTop: "1px solid #263049", margin: "4px 0 2px" }} />
            {line("Compras al ask", `${money(r.compras)}${plus(dC)}`, "#7aa2ff")}
            {line("Ventas al bid", `${money(r.ventas)}${plus(dV)}`, "#f97066")}
            {line("GEX neto", `${gexM(r.netGex)} M`, r.netGex > 0 ? "#12b76a" : r.netGex < 0 ? "#f97066" : "#9aa5c0")}
            {r.dealerRole && <div style={{ color: "#c7cede" }}>Dealers: {role[r.dealerRole]}</div>}
            {(() => {
              const lg = (r as RowWithLegs).legs;
              if (!lg) return null;
              const pct = (s: number | null) => (s == null ? "—" : `${Math.round(s * 100)}%`);
              const mostlySpreads = (r.spx >= spot ? lg.callShare : lg.putShare) ?? 1;
              return (
                <>
                  <div style={{ borderTop: "1px solid #263049", margin: "4px 0 2px" }} />
                  <div style={{ color: "#c7cede", fontWeight: 700 }}>Una pata vs spreads (prima del día)</div>
                  {line("  Calls", `${pct(lg.callShare)} una pata · $${money(lg.callSingle)} / $${money(lg.callMulti)}`)}
                  {line("  Puts", `${pct(lg.putShare)} una pata · $${money(lg.putSingle)} / $${money(lg.putMulti)}`)}
                  <div style={{ color: mostlySpreads < 0.5 ? "#fdb022" : "#c7cede" }}>
                    {lg.dealerRole1 ? `Solo una pata → Dealers: ${role[lg.dealerRole1]}` : mostlySpreads < 0.5 ? "⚠ Mayormente spreads: el rol de dealers aquí es ruido" : "Solo una pata → sin rol claro de dealers"}
                  </div>
                </>
              );
            })()}
            {(() => {
              const me = (r as VisionStrikeRow & RowMultiExp).multiExp;
              if (!me?.length) return null;
              const bk = (r as VisionStrikeRow & RowMultiExp).backing;
              const cell = (label: string, v: number) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
                  <span style={{ color: "#6b7591", fontSize: 10 }}>{label}</span>
                  <span style={{ color: v > 0 ? "#12b76a" : v < 0 ? "#f97066" : "#6b7591", fontWeight: 600, fontSize: 11 }}>{gexM(v)}</span>
                </div>
              );
              return (
                <>
                  <div style={{ borderTop: "1px solid #263049", margin: "4px 0 2px" }} />
                  <div style={{ color: "#c7cede", fontWeight: 700 }}>GEX por vencimiento (M)</div>
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${me.length + 1}, minmax(0, 1fr))`, gap: 2 }}>
                    {cell("hoy", r.netGex)}
                    {me.map((e) => cell(e.expiration.slice(5).replace("-", "/"), e.netGex))}
                  </div>
                  {bk && <div style={{ color: bk === "respaldado" ? "#12b76a" : "#fdb022" }}>{bk === "respaldado" ? "★ Respaldado: los días siguientes tienen el mismo signo" : "⚠ Contrario: los días siguientes van al revés"}</div>}
                </>
              );
            })()}
            {volOn && (() => {
              const vd = volBy.get(r.spx);
              const mins = (props.volDelta!.minutes.get(r.spx) ?? []).filter((m) => m.t < props.volDelta!.toT).slice(-10).reverse();
              const c = (v: number) => v.toLocaleString("en-US");
              const dCol = (v: number) => (v > 0 ? COLOR.posicionamiento : v < 0 ? POS_DOWN : "#9aa5c0");
              const cell: React.CSSProperties = { textAlign: "right", padding: "1px 4px" };
              return (
                <>
                  <div style={{ borderTop: "1px solid #263049", margin: "4px 0 2px" }} />
                  <div style={{ color: "#c7cede", fontWeight: 700 }}>Volumen real (contratos) · {props.volDelta!.windowLabel}</div>
                  {(() => {
                    const sp = spikeBy.get(r.spx);
                    return sp ? (
                      <div style={{ color: VOL_SPIKE, fontWeight: 700 }}>
                        ◆ Volumen delta inusual {hm(sp.t)}: {POSITION_LABEL[sp.kind]} {c(sp.contracts)} en 1 min ({sp.ratio.toFixed(0)}× lo normal de este strike) · para {sp.side.toUpperCase()}
                      </div>
                    ) : null;
                  })()}
                  {vd && (
                    <>
                      {line("  Calls compradas / vendidas", `${c(vd.cA)} / ${c(vd.cB)} (vol ${c(vd.cV)})`, COLOR.posicionamiento)}
                      {line("  Puts compradas / vendidas", `${c(vd.pA)} / ${c(vd.pB)} (vol ${c(vd.pV)})`, POS_DOWN_PUT)}
                      {line("  Δ delta", `${vd.delta > 0 ? "+" : ""}${c(vd.delta)}`, dCol(vd.delta))}
                      {vd.position && <div style={{ color: dCol(vd.position.side === "arriba" ? 1 : -1) }}>→ Posición: {POSITION_LABEL[vd.position.kind]} ({c(vd.position.contracts)} netos) · para {vd.position.side.toUpperCase()}</div>}
                    </>
                  )}
                  <div style={{ color: "#c7cede", fontWeight: 700, marginTop: 4 }}>Minuto a minuto</div>
                  {mins.length === 0 ? <div style={{ color: "#6b7591" }}>Sin operaciones en este strike.</div> : (
                    <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr style={{ color: "#6b7591" }}>
                          <th style={{ textAlign: "left", padding: "1px 4px", fontWeight: 500 }}>Hora</th>
                          <th style={{ ...cell, fontWeight: 500 }}>C compra/venta</th>
                          <th style={{ ...cell, fontWeight: 500 }}>P compra/venta</th>
                          <th style={{ ...cell, fontWeight: 500 }}>Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mins.map((m) => {
                          const d = (m.cA - m.cB) - (m.pA - m.pB);
                          return (
                            <tr key={m.t} style={spikeBy.get(r.spx)?.t === m.t ? { background: "rgba(255,138,31,0.16)", outline: `1px solid ${VOL_SPIKE}` } : undefined}>
                              <td style={{ padding: "1px 4px", color: "#9aa5c0" }}>{hm(m.t)}</td>
                              <td style={cell}><span style={{ color: COLOR.posicionamiento }}>{c(m.cA)}</span><span style={{ color: "#6b7591" }}> / </span><span style={{ color: POS_DOWN }}>{c(m.cB)}</span></td>
                              <td style={cell}><span style={{ color: POS_DOWN_PUT }}>{c(m.pA)}</span><span style={{ color: "#6b7591" }}> / </span><span style={{ color: POS_UP_PUT }}>{c(m.pB)}</span></td>
                              <td style={{ ...cell, color: dCol(d), fontWeight: 700 }}>{d > 0 ? "+" : ""}{c(d)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </>
              );
            })()}
            <div style={{ color: "#6b7591", fontSize: 11 }}>Flujo neto: calls {sm(r.callFlow)} · puts {sm(r.putFlow)}{prev ? " · ▲▼ vs refresco anterior" : ""}</div>
          </div>
        );
      })()}
      </div>
    </div>
  );
}
