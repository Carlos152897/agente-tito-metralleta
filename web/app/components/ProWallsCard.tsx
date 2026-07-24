"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StructureScore } from "@/lib/structure";
import type { GexAnalysis } from "@/lib/gex";
import type { TfBar } from "@/lib/types";
import type { LevelsReport } from "@/lib/levels";
import { conePoints, expectedMove, levelProbabilities, predictionPath } from "@/lib/expectedMove";
import { px } from "../format";



/** Bandas del heatmap: dorado = muro de calls · morado = muro de puts. */
function bandColor(side: "call" | "put", weight: number): string {
  const a = 0.06 + Math.pow(weight, 0.55) * 0.6;
  return side === "call" ? `rgba(212,160,23,${a})` : `rgba(124,110,228,${a})`;
}

/**
 * PRO — Strike Walls, probabilidad y ruta esperada.
 * En lugar de burbujas, cada nivel se pinta como BANDA de heatmap con su probabilidad,
 * y la proyección sale de la desviación estándar (cono 1σ/2σ), no de una línea inventada.
 */
export default function ProWallsCard({
  ticker,
  structure,
  gex,
  horizonDays,
  levels: srLevels,
}: {
  ticker: string;
  structure: StructureScore;
  gex: GexAnalysis | null;
  horizonDays: number;
  levels?: LevelsReport | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<TfBar[] | null>(null);
  const [geom, setGeom] = useState<
    { y: (p: number) => number | null; h: number; xNow: number; xEnd: number } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    setBars(null);
    fetch(`/api/bars?ticker=${encodeURIComponent(ticker)}&tf=1y`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setBars(Array.isArray(d.bars) ? d.bars.slice(-90) : []); })
      .catch(() => { if (!cancelled) setBars([]); });
    return () => { cancelled = true; };
  }, [ticker]);

  const spot = gex?.spot ?? 0;
  const iv = gex?.iv ?? 0.4;

  // Niveles con probabilidad = estadística de toque × concentración de dinero.
  const levels = useMemo(() => {
    if (!gex || !gex.nodes.length || !(spot > 0)) return [];
    return levelProbabilities(
      spot, iv, horizonDays,
      gex.nodes.map((n) => ({
        strike: n.strike, concentration: n.concentration, side: n.side, netGex: n.netGex,
      })),
    ).slice(0, 8);
  }, [gex, spot, iv, horizonDays]);

  const em = useMemo(() => expectedMove(spot, iv, horizonDays), [spot, iv, horizonDays]);
  const cone = useMemo(() => conePoints(spot, iv, horizonDays, 24), [spot, iv, horizonDays]);
  // El imán es el nivel de MAYOR PESO del heatmap (probabilidad × dinero), no el
  // nodo bruto del GEX: es el mismo número que se pinta en las bandas.
  const magnet = levels[0] ?? null;
  const path = useMemo(
    () => {
      const target = magnet?.strike ?? gex?.kingStrike ?? null;
      return target != null && spot > 0
        ? predictionPath(spot, target, iv, horizonDays, 12) : null;
    },
    [magnet, gex, spot, iv, horizonDays],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !bars || bars.length === 0 || !(spot > 0)) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const { createChart, ColorType, CrosshairMode, LineStyle } = await import("lightweight-charts");
      if (disposed || !hostRef.current) return;

      const chart = createChart(hostRef.current, {
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#5c6a85", fontFamily: "inherit" },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.12)", scaleMargins: { top: 0.08, bottom: 0.08 } },
        timeScale: { borderColor: "rgba(255,255,255,0.12)", rightOffset: 26 },
        height: 460,
        autoSize: true,
      });
      const candles = chart.addCandlestickSeries({
        upColor: "#e3ecfb", downColor: "#7f8db0",
        wickUpColor: "#93a5c6", wickDownColor: "#93a5c6",
        borderVisible: false, priceLineVisible: true, priceLineColor: "rgba(255,255,255,0.35)",
      });
      candles.setData(bars.map((b) => ({
        time: b.time as never, open: b.open, high: b.high, low: b.low, close: b.close,
      })));

      // Techo y suelo de 1σ — el movimiento esperado por desviación estándar.
      for (const [price, label] of [[em.upper1, "+1σ"], [em.lower1, "−1σ"]] as [number, string][]) {
        candles.createPriceLine({
          price, color: "rgba(245,197,66,0.5)", lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: label,
        });
      }

      // Soportes y resistencias: solo los realmente fuertes, para no saturar.
      for (const l of [...(srLevels?.resistances ?? []), ...(srLevels?.supports ?? [])]) {
        if (l.strength < 35) continue;
        candles.createPriceLine({
          price: l.price,
          color: l.kind === "soporte" ? "rgba(18,183,106,0.55)" : "rgba(240,68,56,0.55)",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: `${l.kind === "soporte" ? "S" : "R"} ${l.strength}`,
        });
      }

      chart.timeScale().fitContent();

      // El overlay HTML necesita saber en qué píxel cae cada precio.
      const publish = () => {
        if (disposed || !hostRef.current) return;
        const last = bars[bars.length - 1];
        // x real de la última vela: sin esto el cono se dibuja encima del histórico.
        const xNow = chart.timeScale().timeToCoordinate(last.time as never) as number | null;
        const scaleW = chart.priceScale("right").width();
        const xEnd = (hostRef.current.clientWidth || 0) - scaleW;
        setGeom({
          y: (p: number) => candles.priceToCoordinate(p) as number | null,
          h: hostRef.current.clientHeight || 460,
          xNow: xNow ?? 0,
          xEnd,
        });
      };
      publish();
      const t = setTimeout(publish, 80);
      chart.timeScale().subscribeVisibleLogicalRangeChange(publish);

      cleanup = () => { clearTimeout(t); chart.remove(); };
    })();

    return () => { disposed = true; cleanup(); };
  }, [bars, em, spot, srLevels]);

  const dirLabel = magnet
    ? magnet.strike > spot * 1.002 ? "al alza"
      : magnet.strike < spot * 0.998 ? "a la baja" : "lateral"
    : "—";

  return (
    <section className="pro-card">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="pro-title">Strike Walls, probabilidad y ruta esperada</div>
            <span className="pro-badge">PRO</span>
          </div>
          <div className="pro-sub">
            Las bandas son los precios donde está el dinero, con la <b>probabilidad</b> de que
            el precio llegue ahí en {horizonDays} días. El cono sale de la desviación estándar
            (σ = precio × IV × √t): dentro de ±1σ cae ~68% de los escenarios.
          </div>
        </div>
        <div className="pro-legend" style={{ paddingTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "rgba(212,160,23,0.8)" }} />Muro de calls
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "rgba(124,110,228,0.8)" }} />Muro de puts
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 2, background: "#f5c542" }} />Ruta esperada
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 0, borderTop: "2px dotted rgba(18,183,106,0.9)" }} />Soporte
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 0, borderTop: "2px dotted rgba(240,68,56,0.9)" }} />Resistencia
          </div>
        </div>
      </div>

      <div className="pro-chart" style={{ height: 460 }}>
        {bars === null && <div style={{ padding: 20, color: "#5c6a85", fontSize: 12 }}>Cargando velas…</div>}
        <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />

        {geom && levels.length > 0 && (
          <div className="wall-overlay">
            {levels.map((l) => {
              const y = geom.y(l.strike);
              if (y == null) return null;
              const band = Math.max(15, geom.h * 0.038);
              return (
                <div
                  key={l.strike}
                  className="wall-band"
                  style={{ top: y - band / 2, height: band, width: geom.xEnd, background: bandColor(l.side, l.magnet) }}
                >
                  <span className="wall-label">
                    {px.format(l.strike)} — {(l.magnet * 100).toFixed(0)}%
                  </span>
                </div>
              );
            })}

            <svg
              className="wall-proj"
              style={{ left: geom.xNow, width: Math.max(0, geom.xEnd - geom.xNow) }}
            >
              {(() => {
                const W = Math.max(1, geom.xEnd - geom.xNow);
                const pt = (i: number, n: number, price: number): string | null => {
                  const yy = geom.y(price);
                  return yy == null ? null : `${(i / n) * W},${yy}`;
                };
                const seg = (sel: (c: (typeof cone)[number]) => number) =>
                  cone.map((c, i) => pt(i, cone.length - 1, sel(c))).filter(Boolean) as string[];

                const up2 = seg((c) => c.upper2);
                const lo2 = seg((c) => c.lower2).reverse();
                const up1 = seg((c) => c.upper1);
                const lo1 = seg((c) => c.lower1).reverse();
                const line = (path?.points
                  .map((p, i) => pt(i, path.points.length - 1, p.price))
                  .filter(Boolean) as string[] | undefined)?.join(" ");

                return (
                  <>
                    {up2.length > 1 && lo2.length > 1 && (
                      <polygon points={[...up2, ...lo2].join(" ")} fill="rgba(245,197,66,0.08)" />
                    )}
                    {up1.length > 1 && lo1.length > 1 && (
                      <polygon points={[...up1, ...lo1].join(" ")} fill="rgba(245,197,66,0.16)" />
                    )}
                    {line && (
                      <polyline points={line} fill="none" stroke="#f5c542" strokeWidth="2" />
                    )}
                  </>
                );
              })()}
            </svg>
            <div className="wall-divider" style={{ left: geom.xNow }} />
            <div className="wall-now" style={{ left: geom.xNow + 6 }}>AHORA</div>
          </div>
        )}
      </div>

      <div className="wall-stats">
        <div className="wall-stat">
          <div className="wall-stat-label">Movimiento esperado · 1σ · {horizonDays}d</div>
          <div className="wall-stat-value">±{em.sigmaPct.toFixed(1)}%</div>
          <div className="wall-stat-sub">
            ${px.format(em.lower1)} — ${px.format(em.upper1)} · 68% de los escenarios
          </div>
        </div>
        <div className="wall-stat">
          <div className="wall-stat-label">Rango extremo · 2σ</div>
          <div className="wall-stat-value">±{(em.sigmaPct * 2).toFixed(1)}%</div>
          <div className="wall-stat-sub">
            ${px.format(em.lower2)} — ${px.format(em.upper2)} · 95%
          </div>
        </div>
        <div className="wall-stat">
          <div className="wall-stat-label">Nivel imán</div>
          <div className="wall-stat-value" style={{ color: "#f5c542" }}>
            {path ? `$${px.format(path.target)}` : "—"}
          </div>
          <div className="wall-stat-sub">
            {magnet ? `${(magnet.magnet * 100).toFixed(0)}% de peso · ${dirLabel}` : "—"}
            {path?.clamped && " · recortado al cono 2σ"}
          </div>
        </div>
        <div className="wall-stat">
          <div className="wall-stat-label">IV usada</div>
          <div className="wall-stat-value">{(iv * 100).toFixed(1)}%</div>
          <div className="wall-stat-sub">
            {gex ? `régimen ${gex.regime === "positive" ? "γ+ revierte" : "γ− amplifica"} · confianza ${gex.confidence}%` : "—"}
          </div>
        </div>
      </div>

      {(gex?.lowLiquidity || structure.notional.lowLiquidity) && (
        <div className="iv-special" style={{ marginTop: 10 }}>
          ⚠ <b>Cadena de baja liquidez</b> — la proyección se marca como poco fiable y no debe
          usarse para operar.
        </div>
      )}
    </section>
  );
}
