"use client";

import { useMemo } from "react";
import type { ConvictionScore, FlowRow } from "@/lib/flow";
import type { StructureScore } from "@/lib/structure";
import { useLocale } from "@/lib/i18n";
import { money, px } from "../format";

/**
 * Today's Money Flow — de todo el dinero notable en opciones, cuánto apuesta
 * al alza (calls) vs a la baja (puts), + los promedios clave de los sub-agentes.
 */
export default function MoneyFlowCard({
  ticker,
  rows,
  conviction,
  structure,
}: {
  ticker: string;
  rows: FlowRow[];
  conviction: ConvictionScore | null;
  structure: StructureScore | null;
}) {
  const { t } = useLocale();
  const { callPct, putPct, biggest } = useMemo(() => {
    let call = 0, put = 0;
    let top: FlowRow | null = null;
    for (const r of rows) {
      if (r.type === "call") call += r.premium;
      else if (r.type === "put") put += r.premium;
      if (!top || r.premium > top.premium) top = r;
    }
    const total = call + put;
    return {
      callPct: total > 0 ? Math.round((call / total) * 100) : 50,
      putPct: total > 0 ? 100 - Math.round((call / total) * 100) : 50,
      biggest: top,
      pcRatio: call > 0 ? put / call : null,
    };
  }, [rows]);

  const pcRatio = useMemo(() => {
    let call = 0, put = 0;
    for (const r of rows) {
      if (r.type === "call") call += r.premium;
      else if (r.type === "put") put += r.premium;
    }
    return call > 0 ? put / call : null;
  }, [rows]);

  const tiles = [
    biggest && {
      label: t("moneyflow.biggestTrade"),
      value: money.format(biggest.premium),
      sub: `${biggest.underlying} ${biggest.strike != null ? px.format(biggest.strike) : ""}${biggest.type === "call" ? "C" : "P"} · ${t("moneyflow.expires", { exp: biggest.expiration ?? "—" })}`,
      color: biggest.type === "call" ? "#12b76a" : "#f04438",
    },
    pcRatio != null && {
      label: t("moneyflow.pcRatio"),
      value: pcRatio.toFixed(2),
      sub: pcRatio < 0.7 ? t("moneyflow.bullishBand") : pcRatio > 1 ? t("moneyflow.bearishBand") : t("moneyflow.balanced"),
      color: pcRatio < 0.7 ? "#12b76a" : pcRatio > 1 ? "#f04438" : "#101828",
    },
    conviction && {
      label: t("moneyflow.avgSpread"),
      value: conviction.spread.avgPct != null ? `${conviction.spread.avgPct.toFixed(2)}%` : "—",
      sub: conviction.spread.avgPct != null && conviction.spread.avgPct < 2 ? t("moneyflow.veryLiquid") : t("moneyflow.midLiquidity"),
      color: "#101828",
    },
    structure && {
      label: t("moneyflow.volAboveOI"),
      value: `${structure.volOI.pct.toFixed(0)}%`,
      sub: t("moneyflow.newPositions"),
      color: structure.volOI.pct >= 50 ? "#12b76a" : "#101828",
    },
  ].filter(Boolean) as { label: string; value: string; sub: string; color: string }[];

  return (
    <section className="card">
      <div>
        <div className="card-title">{t("moneyflow.title")}</div>
        <div className="card-sub">{t("moneyflow.sub", { ticker })}</div>
      </div>
      <div>
        <div className="mf-bar">
          <div style={{ background: "#12b76a", width: `${callPct}%` }} />
          <div style={{ background: "#f97066", width: `${putPct}%` }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: "#12b76a" }}>{t("moneyflow.bullishPct", { pct: callPct })}</div>
          <div style={{ fontWeight: 600, color: "#f04438" }}>{t("moneyflow.bearishPct", { pct: putPct })}</div>
        </div>
      </div>
      <div className="mf-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="mf-tile">
            <div className="mf-tile-label">{t.label}</div>
            <div className="mf-tile-value" style={{ color: t.color }}>{t.value}</div>
            <div className="mf-tile-sub">{t.sub}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
