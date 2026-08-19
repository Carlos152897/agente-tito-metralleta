"use client";

import { useState } from "react";
import type { UnusualRow } from "./UnusualityCard";
import RepeatBadge, { buildRepeatCounts, repeatKey } from "./RepeatBadge";
import { useLocale, type LocaleCtx } from "@/lib/i18n";
import { int, money, px, timeET } from "../format";

const GRID = "70px 1.9fr 70px 80px 95px 1.5fr 80px";

function contractLabel(r: UnusualRow): string {
  const t = r.type === "call" ? "Call" : r.type === "put" ? "Put" : "?";
  const exp = r.expiration ?? "—";
  const dte = r.dte != null ? ` (${r.dte}d)` : "";
  return `${r.underlying} $${r.strike != null ? px.format(r.strike) : "?"} ${t} · ${exp}${dte}`;
}

function signalFor(r: UnusualRow, t: LocaleCtx["t"]): string {
  const s: string[] = [];
  if (r.aggression === "ask") s.push(t("tradesFeed.buyAggressive"));
  else if (r.aggression === "bid") s.push(t("tradesFeed.sellBid"));
  if (r.flags.exceededOI) s.push(t("tradesFeed.exceededOI"));
  if (r.flags.repeated) s.push(t("tradesFeed.repeatBuyer"));
  if (r.flags.multileg) s.push(t("tradesFeed.combo"));
  else if (r.flags.leap) s.push(t("tradesFeed.leap"));
  if (s.length === 0) s.push(r.conditionName ?? "Ticket notable");
  return s.slice(0, 2).join(" · ");
}

/**
 * Feed de trades inusuales + pestaña de predicciones (se activa con Prediction Pro).
 * El Score /100 sale del puntaje de Inusualidad de cada trade (promedio de griegos ×10).
 */
export default function TradesFeed({ rows }: { rows: UnusualRow[] }) {
  const { t } = useLocale();
  const [tab, setTab] = useState<"trades" | "preds">("trades");
  const top = rows.slice(0, 8);
  const repeatCounts = buildRepeatCounts(rows);

  return (
    <section className="card">
      <div className="feed-tabs">
        <button type="button" className={`hb-tab ${tab === "trades" ? "on" : ""}`} onClick={() => setTab("trades")}>
          {t("tradesFeed.unusualTab")}
        </button>
        <button type="button" className={`hb-tab ${tab === "preds" ? "on" : ""}`} onClick={() => setTab("preds")}>
          {t("tradesFeed.predsTab")}
        </button>
      </div>

      {tab === "trades" && (
        <>
          <div className="card-sub">{t("tradesFeed.sub")}</div>
          <div className="feed-head" style={{ gridTemplateColumns: GRID }}>
            <div>{t("tradesFeed.time")}</div><div>{t("tradesFeed.contract")}</div><div>{t("tradesFeed.type")}</div><div>{t("tradesFeed.contracts")}</div><div>{t("tradesFeed.premium")}</div><div>{t("tradesFeed.signal")}</div><div style={{ textAlign: "right" }}>{t("tradesFeed.score")}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {top.map((r) => {
              const score100 = Math.round(r.unusualScores.total * 10);
              const scoreColor = score100 >= 80 ? "#d92d20" : score100 >= 60 ? "#f79009" : "#667085";
              return (
                <div key={r.id} className="feed-row" style={{ gridTemplateColumns: GRID }}>
                  <div style={{ fontSize: 12, color: "#667085" }}>{timeET(r.timestamp).slice(0, 5)}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {contractLabel(r)}
                    {r.flags.repeated && <RepeatBadge count={repeatCounts.get(repeatKey(r)) ?? 2} />}
                  </div>
                  <div>
                    <span className={`pill ${r.type === "call" ? "call" : "put"}`}>{r.type === "call" ? "CALL" : "PUT"}</span>
                  </div>
                  <div style={{ fontSize: 13 }}>{int.format(r.size)}</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{money.format(r.premium)}</div>
                  <div style={{ fontSize: 12, color: "#667085" }}>{signalFor(r, t)}</div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor }}>{score100}/100</span>
                  </div>
                </div>
              );
            })}
            {top.length === 0 && <div className="feed-empty">{t("tradesFeed.noTrades")}</div>}
          </div>
        </>
      )}

      {tab === "preds" && (
        <div className="feed-empty">
          {t("tradesFeed.comingSoon")}<br />
          {t("tradesFeed.comingSoonDetail")}
        </div>
      )}
    </section>
  );
}
