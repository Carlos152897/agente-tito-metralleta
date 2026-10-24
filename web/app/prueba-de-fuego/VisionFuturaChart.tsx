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
  | "agresor";

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
];

export const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  precio: true, posicionamiento: true, magneto: true, iman_positivo: true, iman_negativo: true,
  resistencia: true, piso: true, gamma_flip: false, max_pain: false, charm: false,
  dealers: false, rango_vix: false, historial: false, agresor: true,
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
}

const ROW_H = 20;
const LABEL_W = 150;
/** Columna propia del posicionamiento, a la izquierda del precio (pedido de
 *  Carlos: dentro del plot se mezclaba con el precio y las etiquetas). */
const POS_COL_W = 230;
/** Orilla de cada lado del posicionamiento para el "▲$" de crecimiento. */
const POS_EDGE = 36;
const RIGHT_W = 250;
/** Columna extra del agresor para la etiqueta "Compra/Venta inusual". */
const UNUSUAL_W = 128;
const UNUSUAL = "#facc15";
const TOP = 8;
const BOTTOM = 26;

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
  const { rows, spot, priceSeries, history, keyLevels, dealerLevels, expectedMove, conversion, layers, prevAggressor } = props;
  const unusualBy = new Map<number, UnusualHit>();
  for (const h of props.unusual ?? []) {
    const cur = unusualBy.get(h.strike);
    if (!cur || h.delta > cur.delta) unusualBy.set(h.strike, h);
  }
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  // Tarjeta de detalle al hacer CLICK en una fila (posicionamiento, strike o agresor). Carlos: "solo cuando le dé click".
  const [hover, setHover] = useState<{ strike: number; cx: number; cy: number } | null>(null);
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
  const plotR = width - rightW - 8;
  const plotW = Math.max(200, plotR - plotL);
  const height = TOP + rows.length * ROW_H + BOTTOM;
  const plotBottom = TOP + rows.length * ROW_H;
  const maxStrike = strikes[0];
  const minStrike = strikes[strikes.length - 1];

  const y = (price: number) => TOP + ((maxStrike - price) / step) * ROW_H + ROW_H / 2;
  const inView = (price: number) => price <= maxStrike + step / 2 && price >= minStrike - step / 2;

  const refSec = priceSeries.at(-1)?.time ?? history.at(-1)?.time ?? Date.now() / 1000;
  const { open, close } = props.nightSession ? nightBounds(refSec) : sessionBounds(refSec);
  const x = (sec: number) => plotL + ((Math.min(Math.max(sec, open), close) - open) / (close - open)) * plotW;
  const nowSec = Math.min(Math.max(refSec, open), close);
  const nowX = x(nowSec);

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
    addChip({ key: `${k.label}-${k.spx}`, text: `${k.label} ${n2(k.spx, 2)}`, color, dashed: k.kind === "gamma_flip" || k.kind === "max_pain" }, k.spx);
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
  // Empaque vertical simple: ordenados por y, mínimo 14px entre chips.
  const placed = [...chips].sort((a, b) => a.y - b.y).map((c) => ({ ...c, labelY: c.y }));
  for (let i = 1; i < placed.length; i++) {
    if (placed[i].labelY - placed[i - 1].labelY < 14) placed[i].labelY = placed[i - 1].labelY + 14;
  }
  // Si el empuje sacó chips por abajo, se reacomodan hacia arriba desde el borde.
  for (let i = placed.length - 1; i >= 0; i--) {
    const limit = i === placed.length - 1 ? plotBottom - 8 : placed[i + 1].labelY - 14;
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

  const pricePath = priceSeries
    .filter((p) => p.time >= open && p.time <= close)
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join("");

  const ticks: number[] = [];
  const tickStep = close - open > 12 * 3600 ? 7200 : 3600;
  for (let t = open; t <= close; t += tickStep) ticks.push(t);

  const spotRowIdx = rows.reduce((best, r, i) => (Math.abs(r.spx - spot) < Math.abs(rows[best].spx - spot) ? i : best), 0);
  const conv = (s: number) => ({
    spy: conversion.spyRatio != null ? s * conversion.spyRatio : null,
    es: conversion.esBasis != null ? s + conversion.esBasis : null,
  });

  // Columnas del panel del agresor.
  const aggX = plotR + 8;
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
        </defs>

        {/* Filas */}
        {rows.map((r, i) => {
          const ry = TOP + i * ROW_H;
          const c = conv(r.spx);
          const isSpot = i === spotRowIdx;
          return (
            <g key={r.spx}>
              <rect x={0} y={ry} width={width} height={ROW_H} fill={isSpot ? "rgba(47,107,255,0.14)" : i % 2 ? "rgba(255,255,255,0.015)" : "transparent"} />
              <text x={6} y={ry + 14} fontSize={11} fill={isSpot ? "#f5f7fb" : "#9aa5c0"} fontWeight={isSpot ? 700 : 400}>
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
            <line x1={x(t)} x2={x(t)} y1={TOP} y2={plotBottom} stroke="#263049" strokeWidth={0.6} />
            {/* La etiqueta "ahora" manda: se ocultan las horas que se le enciman. */}
            {Math.abs(x(t) - nowX) > 52 && x(t) < plotR - 22 && <text x={x(t)} y={height - 8} fontSize={10} fill="#6b7591" textAnchor="middle">{hm(t)}</text>}
          </g>
        ))}
        <line x1={nowX} x2={nowX} y1={TOP} y2={plotBottom} stroke="#9aa5c0" strokeDasharray="3 3" strokeWidth={1} />
        <text x={nowX} y={height - 8} fontSize={10} fill="#f5f7fb" textAnchor="middle" fontWeight={600}>ahora {hm(refSec, true)}</text>

        <g clipPath="url(#vf-plot)">
          {/* Rango VIX: franja */}
          {layers.rango_vix && expectedMove && (
            <rect x={plotL} width={plotW} y={y(expectedMove.high.spx)} height={Math.max(0, y(expectedMove.low.spx) - y(expectedMove.high.spx))} fill="rgba(148,163,184,0.06)" />
          )}

          {/* Líneas de niveles */}
          {placed.filter((c) => !c.offscreen).map((c) => (
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
        </g>

        {/* Chips de etiquetas */}
        {placed.map((c) => {
          const w = c.text.length * 6 + 10;
          const cx = plotR - w - 2;
          return (
            <g key={`chip-${c.key}`}>
              {!c.offscreen && Math.abs(c.labelY - c.y) > 1 && <line x1={cx + w} x2={plotR} y1={c.labelY} y2={c.y} stroke={c.color} strokeWidth={0.8} />}
              <rect x={cx} y={c.labelY - 7} width={w} height={14} rx={4} fill="#0f1522" stroke={c.color} strokeWidth={1} />
              <text x={cx + 5} y={c.labelY + 4} fontSize={10} fill={c.color}>{c.text}</text>
            </g>
          );
        })}
        {layers.precio && inView(spot) && (
          <g>
            {/* A la izquierda de la franja de etiquetas de niveles, para no encimarse. */}
            <rect x={Math.min(x(refSec) - 92, plotR - 290)} y={y(spot) - 22} width={84} height={15} rx={4} fill="#0f1522" stroke={COLOR.precio} />
            <text x={Math.min(x(refSec) - 92, plotR - 290) + 5} y={y(spot) - 11} fontSize={10} fill={COLOR.precio}>spot {n2(spot, 2)}</text>
          </g>
        )}

        {/* Panel del agresor */}
        {layers.agresor && (
          <g>
            {rows.map((r, i) => {
              const ry = TOP + i * ROW_H;
              const prev = prevAggressor?.get(r.spx);
              const dv = prev ? (r.compras - r.ventas) - (prev.compras - prev.ventas) : 0;
              const vw = Math.max(0, (r.ventas / maxAgg) * barW);
              const cw = Math.max(0, (r.compras / maxAgg) * barW);
              const hit = unusualBy.get(r.spx);
              return (
                <g key={`agg-${r.spx}`}>
                  {hit && <rect x={aggX} y={ry + 1} width={rightW - 4} height={ROW_H - 2} rx={3} fill="none" stroke={UNUSUAL} strokeWidth={1.2} />}
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
