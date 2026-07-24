"use client";

import type { TfBar } from "@/lib/types";
import { px } from "../../format";

export interface HoverInfo {
  x: number;
  y: number;
  price: number;
  /** Vela bajo el cursor, si el cursor está en el histórico. */
  bar: TfBar | null;
  /** Días en el futuro, si el cursor está pasada la frontera AHORA. */
  tDays: number | null;
}

function dayLabel(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "2-digit",
  });
}

/**
 * Crosshair + tooltip. Es HTML (no SVG) a propósito: el tooltip necesita fluir
 * con el texto y voltearse de lado cuando se acerca al borde.
 */
export default function ChartCrosshair({
  hover,
  plotTop,
  plotBottom,
  plotLeft,
  plotRight,
}: {
  hover: HoverInfo | null;
  plotTop: number;
  plotBottom: number;
  plotLeft: number;
  plotRight: number;
}) {
  if (!hover) return null;
  const flip = hover.x > (plotLeft + plotRight) / 2;

  return (
    <>
      <div
        className="pc-cross-v"
        style={{ left: hover.x, top: plotTop, height: plotBottom - plotTop }}
      />
      <div className="pc-cross-dot" style={{ left: hover.x, top: hover.y }} />
      <div
        className="pc-tip"
        style={{
          left: flip ? undefined : hover.x + 12,
          right: flip ? `calc(100% - ${hover.x - 12}px)` : undefined,
          top: Math.max(plotTop, Math.min(hover.y - 10, plotBottom - 90)),
        }}
      >
        {hover.bar ? (
          <>
            <div className="pc-tip-head">{dayLabel(hover.bar.time)}</div>
            <div className="pc-tip-grid">
              <span>A</span><b>${px.format(hover.bar.open)}</b>
              <span>M</span><b>${px.format(hover.bar.high)}</b>
              <span>m</span><b>${px.format(hover.bar.low)}</b>
              <span>C</span><b>${px.format(hover.bar.close)}</b>
            </div>
          </>
        ) : (
          <>
            <div className="pc-tip-head">
              {hover.tDays != null ? `en ${Math.round(hover.tDays)} días` : "proyección"}
            </div>
            <div className="pc-tip-price">${px.format(hover.price)}</div>
          </>
        )}
      </div>
    </>
  );
}
