"use client";

import { useEffect, useRef } from "react";
import type { DailyBar, Row } from "@/lib/types";
import { useLocale } from "@/lib/i18n";

const LINE_COLORS = ["#4da3ff", "#3fd07a", "#ffb020", "#ff6b6b", "#b98cff"];

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});
const px = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function contractLabel(r: Row): string {
  return `${r.contractType === "call" ? "C" : "P"} ${px.format(r.strike)}`;
}

export default function ChartPanel({
  ticker,
  bars,
  contracts,
}: {
  ticker: string;
  bars: DailyBar[];
  contracts: Row[];
}) {
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || bars.length === 0) return;

    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const { createChart, ColorType, LineStyle, CrosshairMode } = await import(
        "lightweight-charts"
      );
      if (disposed || !containerRef.current) return;

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#8a93a6",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        },
        grid: {
          vertLines: { color: "#26304230" },
          horzLines: { color: "#26304230" },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: "#26304260" },
        timeScale: { borderColor: "#26304260", timeVisible: false },
        height: 380,
        autoSize: true,
      });

      const series = chart.addCandlestickSeries({
        upColor: "#3fd07a",
        downColor: "#ff6b6b",
        wickUpColor: "#3fd07a",
        wickDownColor: "#ff6b6b",
        borderVisible: false,
      });
      series.setData(bars);

      contracts.forEach((c, i) => {
        series.createPriceLine({
          price: c.strike,
          color: LINE_COLORS[i % LINE_COLORS.length],
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${i + 1}. ${contractLabel(c)} · ${money.format(c.notionalValue)}`,
        });
      });

      chart.timeScale().fitContent();
      cleanup = () => chart.remove();
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [ticker, bars, contracts]);

  return (
    <section className="chart">
      <div className="chart-head">
        <h2>{t("chartPanel.title", { ticker })}</h2>
        <span className="muted">{t("chartPanel.sub")}</span>
      </div>

      {bars.length === 0 ? (
        <div className="chart-empty">{t("chartPanel.noHistory", { ticker })}</div>
      ) : (
        <div ref={containerRef} className="chart-canvas" />
      )}

      <div className="legend">
        {contracts.map((c, i) => (
          <div key={c.optionTicker || i} className="legend-item">
            <span
              className="legend-swatch"
              style={{ background: LINE_COLORS[i % LINE_COLORS.length] }}
            />
            <div className="legend-body">
              <div className="legend-title">
                #{i + 1} · {contractLabel(c)}
                <span className={`pill ${c.contractType}`}>{c.contractType}</span>
              </div>
              <div className="legend-meta">
                {t("chartPanel.expires", { exp: c.expiration })} · OI {c.openInterest.toLocaleString("en-US")} ·
                {" "}Open Premium {c.openPremium != null ? money.format(c.openPremium) : "n/a"} ·
                {" "}Notional <b>{money.format(c.notionalValue)}</b>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
