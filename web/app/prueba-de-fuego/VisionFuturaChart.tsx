"use client";

// Gráfica de VisionFutura (Carlos, oct 2026, con captura de referencia):
// escalera de strikes en el eje Y y la sesión 9:30–16:00 ET en el eje X.
// Encima: el precio del día, barras de posicionamiento por strike, los
// niveles (Magneto, imanes, techos, pisos, flip, max pain, charm, dealers,
// rango VIX) y su historial; a la derecha, el panel del agresor (compras al
// ask / ventas al bid). Cada capa se prende/apaga desde VisionFuturaTab
// (`layers`) para que la gráfica no se vea sobrecargada. SVG propio: la
// escalera con filas por strike no encaja en lightweight-charts.

import { positioningParts, positioningSides, type FlowSnapshot, type UnusualHit } from "@/lib/visionFuturaFlowChanges";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVisionLabels } from "./visionLabels";
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
  | "agresor"
  | "vix";

export const LAYERS: { key: LayerKey; label: string; color: string }[] = [
  { key: "precio", label: "Precio", color: "#2dd4bf" },
  { key: "posicionamiento", label: "Posicionamiento", color: "#12b76a" },
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
  { key: "agresor", label: "Agresor", color: "#2f6bff" },
  { key: "vix", label: "Mini VIX", color: "#f97066" },
];

export const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  precio: true, posicionamiento: true, magneto: true, iman_positivo: true, iman_negativo: true,
  resistencia: true, piso: true, gamma_flip: false, max_pain: false, charm: false,
  dealers: false, rango_vix: false, historial: false, agresor: true, vix: true,
};

const COLOR = Object.fromEntries(LAYERS.map((l) => [l.key, l.color])) as Record<LayerKey, string>;
const POS_DOWN = "#a855f7"; // morado: se posicionan para abajo
// Tono claro de cada lado = la parte que viene de PUTS (el fuerte = CALLS).
const POS_UP_PUT = "#86efac";
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
const LABEL_W = 150;
/** Columna propia del posicionamiento, a la izquierda del precio (pedido de
 *  Carlos: dentro del plot se mezclaba con el precio y las etiquetas). */
const POS_COL_W = 230;
/** Orilla de cada lado del posicionamiento para el "▲$" de crecimiento. */
const POS_EDGE = 36;
const RIGHT_W = 250;
/** Columna propia de las etiquetas de niveles, a la derecha del precio (Carlos, 27-oct: las
 *  etiquetas dentro del plot tapaban las velas — "se ve todo amontonado"). */
const LEVEL_W = 168;
const SPOT_KEY = "__spot";
/** Ancho mínimo del plot del precio: si no cabe, la gráfica se desliza de lado en vez de aplastarse. */
const MIN_PLOT = 360;
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
const UNUSUAL_W = 128;
const UNUSUAL = "#facc15";
const TOP = 8;
const BOTTOM = 26;
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

  const refSec = priceSeries.at(-1)?.time ?? history.at(-1)?.time ?? Date.now() / 1000;
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
  const posColW = layers.posicionamiento ? POS_COL_W : 0;
  const plotL = LABEL_W + posColW;
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
  const height = (vixOn ? vixBottom : plotBottom) + BOTTOM;
  const gridBottom = vixOn ? vixBottom : plotBottom;
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
    return { strike: r.spx, up, down, ...parts, dUp: prev ? up - prev.up : 0, dDown: prev ? down - prev.down : 0 };
  });
  const maxPos = Math.max(1, ...pos.map((p) => Math.max(p.up, p.down)));
  // Crecimientos menores al 1% de la barra mayor no se marcan (ruido).
  const minGrowth = maxPos * 0.01;
  // Eje central de la columna: verde hacia la derecha, morado hacia la izquierda.
  const posX = LABEL_W + POS_COL_W / 2;
  const POS_SPAN = POS_COL_W / 2 - POS_EDGE - 4;

  const maxAgg = Math.max(1, ...rows.map((r) => Math.max(r.compras, r.ventas)));

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
    addChip({ key: `${k.label}-${k.spx}`, text: `${SHORT_LABEL[k.label] ?? k.label} ${lvl}`, color, dashed: k.kind === "gamma_flip" || k.kind === "max_pain" }, k.spx);
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
    const name = (t: string) => t.replace(/^[↑↓] /, "").replace(/ [\d,.]+$/, "");
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
  const gexColW = 56;
  const barW = (RIGHT_W - gexColW - 30) / 2; // la columna de "inusual" va aparte, a la derecha
  const ventasX = aggX + gexColW;
  const comprasX = ventasX + barW + 4;
  const arrowX = comprasX + barW + 4;

  return (
    <div ref={wrapRef} style={{ overflowX: "auto" }}>
      <div style={{ position: "relative", width }}>
      <svg width={width} height={height} style={{ display: "block", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <defs>
          <clipPath id="vf-plot"><rect x={plotL} y={TOP} width={plotW} height={rows.length * ROW_H} /></clipPath>
          <clipPath id="vf-vix"><rect x={plotL} y={vixTop} width={plotW} height={VIX_H} /></clipPath>
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
              <text x={6} y={ry + rowMid + 14} fontSize={11} fill={isSpot ? "#f5f7fb" : "#9aa5c0"} fontWeight={isSpot ? 700 : 400}>
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
          <rect key={`unu-${r.spx}`} x={0} y={TOP + i * ROW_H} width={width} height={ROW_H} fill={UNUSUAL} opacity={0.13} />
        ))}

        {/* Columna de posicionamiento */}
        {layers.posicionamiento && (
          <g>
            <line x1={LABEL_W} x2={LABEL_W} y1={TOP} y2={plotBottom} stroke="#263049" />
            <line x1={plotL - 1} x2={plotL - 1} y1={TOP} y2={plotBottom} stroke="#263049" />
            <line x1={posX} x2={posX} y1={TOP} y2={plotBottom} stroke="#263049" strokeDasharray="2 3" />
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
                    const seg = (x0: number, w: number, fill: string, label: string, txt: string, dark: boolean) => w <= 0 ? null : (
                      <g>
                        <rect x={x0} y={ry} width={Math.max(1, w)} height={12} fill={fill} opacity={0.9} />
                        {w >= 38 && <text x={x0 + w / 2} y={ry + 10} fontSize={9} textAnchor="middle" fill={dark ? "#14111f" : "#fff"} style={{ pointerEvents: "none" }}>{label} {txt}</text>}
                      </g>
                    );
                    return (
                      <>
                        {seg(posX - wdC, wdC, POS_DOWN, "C", money(p.callsSold), false)}
                        {seg(posX - wd, wdP, POS_DOWN_PUT, "P", money(p.putsBought), true)}
                        {seg(posX, wuC, COLOR.posicionamiento, "C", money(p.callsBought), false)}
                        {seg(posX + wuC, wuP, POS_UP_PUT, "P", money(p.putsSold), true)}
                      </>
                    );
                  })()}
                  {gd > 0 && <rect x={posX - wd} y={ry} width={gd} height={12} rx={2} fill="#fff" opacity={0.35} style={{ pointerEvents: "none" }} />}
                  {gu > 0 && <rect x={posX + wu - gu} y={ry} width={gu} height={12} rx={2} fill="#fff" opacity={0.35} style={{ pointerEvents: "none" }} />}
                  {/* "▲$" en la orilla: ese lado está aumentando. */}
                  {p.dDown > minGrowth && <text x={LABEL_W + 3} y={ry + 10} fontSize={9} fontWeight={700} fill={POS_DOWN}>▲{money(p.dDown)}</text>}
                  {p.dUp > minGrowth && <text x={plotL - 4} y={ry + 10} fontSize={9} fontWeight={700} fill={COLOR.posicionamiento} textAnchor="end">▲{money(p.dUp)}</text>}
                </g>
              );
            })}
            <text x={posX - 6} y={height - 8} fontSize={10} textAnchor="end"><tspan fill={POS_DOWN}>← abajo</tspan> <tspan fill="#6b7591">C</tspan><tspan fill={POS_DOWN}>■</tspan><tspan fill="#6b7591">P</tspan><tspan fill={POS_DOWN_PUT}>■</tspan></text>
            <text x={posX + 6} y={height - 8} fontSize={10}><tspan fill="#6b7591">C</tspan><tspan fill={COLOR.posicionamiento}>■</tspan><tspan fill="#6b7591">P</tspan><tspan fill={POS_UP_PUT}>■</tspan> <tspan fill={COLOR.posicionamiento}>arriba →</tspan></text>
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
        />

        {/* Panel del agresor */}
        {layers.agresor && (
          <g>
            {rows.map((r, i) => {
              const ry0 = TOP + i * ROW_H;
              const ry = ry0 + rowMid; // contenido centrado en la fila (filas altas con el zoom vertical)
              const prev = prevAggressor?.get(r.spx);
              const dv = prev ? (r.compras - r.ventas) - (prev.compras - prev.ventas) : 0;
              const vw = Math.max(0, (r.ventas / maxAgg) * barW);
              const cw = Math.max(0, (r.compras / maxAgg) * barW);
              const hit = unusualBy.get(r.spx);
              return (
                <g key={`agg-${r.spx}`}>
                  {hit && <rect x={aggX} y={ry0 + 1} width={rightW - 4} height={ROW_H - 2} rx={3} fill="none" stroke={UNUSUAL} strokeWidth={1.2} />}
                  <text x={aggX + gexColW - 6} y={ry + 14} fontSize={10} textAnchor="end" fill={r.netGex > 0 ? "#12b76a" : r.netGex < 0 ? "#f97066" : "#6b7591"}>{gexM(r.netGex)}</text>
                  <rect x={ventasX + barW - vw} y={ry + 5} width={vw} height={10} rx={2} fill={hit?.side === "venta" ? UNUSUAL : "#f04438"} opacity={hit?.side === "venta" ? 0.95 : 0.75} />
                  <rect x={comprasX} y={ry + 5} width={cw} height={10} rx={2} fill={hit?.side === "compra" ? UNUSUAL : "#2f6bff"} opacity={hit?.side === "compra" ? 0.95 : 0.8} />
                  {/* Montos solo dentro de barras anchas, para no tapar la columna de GEX. */}
                  {vw >= 34 && <text x={ventasX + barW - vw + 3} y={ry + 13} fontSize={9} fill={hit?.side === "venta" ? "#111" : "#fff"}>{money(r.ventas)}</text>}
                  {cw >= 34 && <text x={comprasX + cw - 3} y={ry + 13} fontSize={9} textAnchor="end" fill={hit?.side === "compra" ? "#111" : "#fff"}>{money(r.compras)}</text>}
                  {hit && (
                    <text x={arrowX + 20} y={ry + 14} fontSize={10} fontWeight={700} fill={UNUSUAL}>
                      {hit.side === "compra" ? "▲ Compra inusual" : "▼ Venta inusual"} +{money(hit.delta)}
                    </text>
                  )}
                  {dv !== 0 && <text x={arrowX + 8} y={ry + 14} fontSize={10} textAnchor="middle" fill={dv > 0 ? "#2f6bff" : "#f04438"}>{dv > 0 ? "▲" : "▼"}</text>}
                </g>
              );
            })}
            <text x={aggX + gexColW - 6} y={height - 8} fontSize={10} textAnchor="end" fill="#6b7591">GEX $M</text>
            <text x={ventasX + barW} y={height - 8} fontSize={10} textAnchor="end" fill="#f97066">← Ventas</text>
            <text x={comprasX} y={height - 8} fontSize={10} fill="#7aa2ff">Compras →</text>
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
              {on && <rect x={0} y={ry} width={plotL} height={ROW_H} fill="#ffffff" opacity={0.05} style={{ pointerEvents: "none" }} />}
              {on && layers.agresor && <rect x={aggX} y={ry} width={rightW} height={ROW_H} fill="#ffffff" opacity={0.05} style={{ pointerEvents: "none" }} />}
              <rect data-vf-hit="" x={0} y={ry} width={plotL} height={ROW_H} fill="transparent" style={{ cursor: "pointer" }} onClick={click} />
              {layers.agresor && <rect data-vf-hit="" x={aggX} y={ry} width={rightW} height={ROW_H} fill="transparent" style={{ cursor: "pointer" }} onClick={click} />}
            </g>
          );
        })}
      </svg>
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
        const W = 300;
        const CARD_H = hit ? 350 : 330;
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
          <div data-vf-card="" style={{ position: "fixed", left, top, width: W, zIndex: 50, background: "#0f1522", border: `1px solid ${hit ? UNUSUAL : "#2b3756"}`, borderRadius: 10, padding: "10px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.45)", fontSize: 12, fontVariantNumeric: "tabular-nums", display: "flex", flexDirection: "column", gap: 4 }}>
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
            {hit && <div style={{ color: UNUSUAL, fontWeight: 700 }}>{hit.side === "compra" ? "▲ Compra inusual" : "▼ Venta inusual"} +{money(hit.delta)} ({money(hit.before)} → {money(hit.after)})</div>}
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
            <div style={{ color: "#6b7591", fontSize: 11 }}>Flujo neto: calls {sm(r.callFlow)} · puts {sm(r.putFlow)}{prev ? " · ▲▼ vs refresco anterior" : ""}</div>
          </div>
        );
      })()}
      </div>
    </div>
  );
}
