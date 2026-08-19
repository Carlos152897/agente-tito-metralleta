"use client";

import { useEffect, useMemo, useState } from "react";
import type { StructureScore } from "@/lib/structure";
import type { GexAnalysis } from "@/lib/gex";
import type { TfBar } from "@/lib/types";
import type { LevelsReport } from "@/lib/levels";
import { conePoints, expectedMove, levelProbabilities, predictionPath } from "@/lib/expectedMove";
import PriceChart, { type ChartTarget } from "./chart/PriceChart";
import { useLocale, Rich } from "@/lib/i18n";
import { px } from "../format";

/** Bandas del heatmap: dorado = muro de calls · morado = muro de puts. */
function bandColor(side: "call" | "put", weight: number): string {
  const a = 0.05 + Math.pow(weight, 0.55) * 0.4;
  return side === "call" ? `rgba(212,160,23,${a})` : `rgba(124,110,228,${a})`;
}

/** El chip usa el color sólido del lado; la banda va traslúcida. */
function chipColor(side: "call" | "put"): string {
  return side === "call" ? "#b8880f" : "#6b5cd6";
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
  const { t } = useLocale();
  const [bars, setBars] = useState<TfBar[] | null>(null);

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

  // Muros del heatmap → chips con precio y probabilidad, más su banda de color.
  const targets: ChartTarget[] = useMemo(
    () => levels.map((l) => ({
      key: String(l.strike),
      price: l.strike,
      label: l.side === "call" ? "Calls" : "Puts",
      sublabel: `${(l.magnet * 100).toFixed(0)}%`,
      color: chipColor(l.side),
      weight: l.magnet,
      bandColor: bandColor(l.side, l.magnet),
    })),
    [levels],
  );

  // Soportes y resistencias: solo los realmente fuertes, para no saturar.
  const srLines = useMemo(
    () => [...(srLevels?.resistances ?? []), ...(srLevels?.supports ?? [])]
      .filter((l) => l.strength >= 35)
      .map((l) => ({ price: l.price, kind: l.kind, strength: l.strength })),
    [srLevels],
  );

  const dirLabel = magnet
    ? magnet.strike > spot * 1.002 ? t("proWalls.up")
      : magnet.strike < spot * 0.998 ? t("proWalls.down") : t("proWalls.sideways")
    : "—";

  return (
    <section className="pro-card">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="pro-title">{t("proWalls.title")}</div>
            <span className="pro-badge">PRO</span>
          </div>
          <Rich className="pro-sub" text={t("proWalls.sub", { days: horizonDays })} />
        </div>
        <div className="pro-legend" style={{ paddingTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "rgba(212,160,23,0.8)" }} />{t("proWalls.callWall")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "rgba(124,110,228,0.8)" }} />{t("proWalls.putWall")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 2, background: "#f5c542" }} />{t("proWalls.expectedPath")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 0, borderTop: "2px dotted rgba(18,183,106,0.9)" }} />{t("proWalls.support")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 0, borderTop: "2px dotted rgba(240,68,56,0.9)" }} />{t("proWalls.resistance")}
          </div>
        </div>
      </div>

      <div className="pro-chart">
        {bars === null && <div style={{ padding: 20, color: "#5c6a85", fontSize: 12 }}>{t("proWalls.loadingBars")}</div>}
        {bars !== null && bars.length === 0 && (
          <div style={{ padding: 20, color: "#5c6a85", fontSize: 12 }}>{t("proWalls.noPriceData")}</div>
        )}
        {bars !== null && bars.length > 0 && (
          <PriceChart
            bars={bars}
            spot={spot}
            horizonDays={horizonDays}
            cone={cone}
            series={path ? [{ key: "magnet", points: path.points, color: "#f5c542", width: 2.2 }] : []}
            targets={targets}
            levels={srLines}
            theme="light"
            height="100%"
            showCone1
          />
        )}
      </div>

      <div className="wall-stats">
        <div className="wall-stat">
          <div className="wall-stat-label">{t("proWalls.expMove", { days: horizonDays })}</div>
          <div className="wall-stat-value">±{em.sigmaPct.toFixed(1)}%</div>
          <div className="wall-stat-sub">
            ${px.format(em.lower1)} — ${px.format(em.upper1)} · {t("proWalls.scenarios68")}
          </div>
        </div>
        <div className="wall-stat">
          <div className="wall-stat-label">{t("proWalls.extremeRange")}</div>
          <div className="wall-stat-value">±{(em.sigmaPct * 2).toFixed(1)}%</div>
          <div className="wall-stat-sub">
            ${px.format(em.lower2)} — ${px.format(em.upper2)} · {t("proWalls.scenarios95")}
          </div>
        </div>
        <div className="wall-stat">
          <div className="wall-stat-label">{t("proWalls.magnetLevel")}</div>
          <div className="wall-stat-value" style={{ color: "#f5c542" }}>
            {path ? `$${px.format(path.target)}` : "—"}
          </div>
          <div className="wall-stat-sub">
            {magnet ? t("proWalls.weightOf", { pct: (magnet.magnet * 100).toFixed(0), dir: dirLabel }) : "—"}
            {path?.clamped && t("proWalls.clamped")}
          </div>
        </div>
        <div className="wall-stat">
          <div className="wall-stat-label">{t("proWalls.ivUsed")}</div>
          <div className="wall-stat-value">{(iv * 100).toFixed(1)}%</div>
          <div className="wall-stat-sub">
            {gex ? t("proWalls.regimeInfo", {
              regime: gex.regime === "positive" ? t("proWalls.regimePositive") : t("proWalls.regimeNegative"),
              conf: gex.confidence,
            }) : "—"}
          </div>
        </div>
      </div>

      {(gex?.lowLiquidity || structure.notional.lowLiquidity) && (
        <div className="iv-special" style={{ marginTop: 10 }}>
          ⚠ <b>{t("proWalls.lowLiquidity")}</b> {t("proWalls.lowLiquidityDetail")}
        </div>
      )}
    </section>
  );
}
