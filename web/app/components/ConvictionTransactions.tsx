"use client";

import { useMemo, useState } from "react";
import { EXECUTION_LABEL, executionLevel, spreadPct, type FlowRow } from "@/lib/flow";
import RepeatBadge, { buildRepeatCounts, repeatKey } from "./RepeatBadge";
import { useLocale, Rich, type LocaleCtx } from "@/lib/i18n";
import { dateOf, int, money, px, timeOf } from "../format";

export interface ConvictionMeta {
  window: string;
  minPremium: number;
  total: number;
  shown: number;
  expiredCount: number;
  vigenteCount: number;
  saved: { total: number; added: number; firstSeen: string | null } | null;
}

function statusLabel(s: FlowRow["expiryStatus"], t: LocaleCtx["t"]): string {
  return s === "expirado" ? t("conviction.expired")
    : s === "expira_hoy" ? t("conviction.expiresToday")
    : s === "vigente" ? t("conviction.active") : "—";
}

function contractLabel(r: FlowRow): string {
  const t = r.type === "call" ? "C" : r.type === "put" ? "P" : "?";
  return `${r.underlying} ${r.strike != null ? px.format(r.strike) : "?"}${t}`;
}

type Filter = "todas" | "vigente" | "expirado";

export default function ConvictionTransactions({
  rows,
  meta,
}: {
  rows: FlowRow[];
  meta: ConvictionMeta;
}) {
  const { t } = useLocale();
  const [filter, setFilter] = useState<Filter>("todas");
  const repeatCounts = useMemo(() => buildRepeatCounts(rows), [rows]);

  const shown = useMemo(() => {
    if (filter === "todas") return rows;
    if (filter === "vigente") return rows.filter((r) => r.expiryStatus !== "expirado");
    return rows.filter((r) => r.expiryStatus === "expirado");
  }, [rows, filter]);

  return (
    <div className="clusters">
      <div className="clusters-title">
        📒 {t("convictionTx.reviewed", { window: meta.window })}
        <span className="muted">
          {t("convictionTx.reviewedMeta", { total: int.format(meta.total), min: money.format(meta.minPremium) })}
          {meta.shown < meta.total ? t("convictionTx.showing", { n: meta.shown }) : ""}
          {meta.saved && (
            <>{t("convictionTx.saved", { n: int.format(meta.saved.total) })}
              {meta.saved.added > 0 && t("convictionTx.savedNew", { n: int.format(meta.saved.added) })}</>
          )}
        </span>
      </div>

      <div className="tf-toggle" style={{ marginBottom: 10 }}>
        <button type="button" className={`tf-btn ${filter === "todas" ? "on" : ""}`} onClick={() => setFilter("todas")}>
          {t("convictionTx.all", { n: int.format(rows.length) })}
        </button>
        <button type="button" className={`tf-btn ${filter === "vigente" ? "on" : ""}`} onClick={() => setFilter("vigente")}>
          {t("convictionTx.active", { n: int.format(meta.vigenteCount) })}
        </button>
        <button type="button" className={`tf-btn ${filter === "expirado" ? "on" : ""}`} onClick={() => setFilter("expirado")}>
          {t("convictionTx.expired", { n: int.format(meta.expiredCount) })}
        </button>
      </div>

      <div className="tablewrap tall">
        <table>
          <thead>
            <tr>
              <th className="left">{t("convictionTx.date")}</th>
              <th className="left">{t("convictionTx.contract")}</th>
              <th className="left">{t("convictionTx.expiration")}</th>
              <th>{t("convictionTx.status")}</th>
              <th>{t("convictionTx.side")}</th>
              <th>{t("convictionTx.execution")}</th>
              <th>{t("convictionTx.spread")}</th>
              <th>{t("convictionTx.contracts")}</th>
              <th>{t("convictionTx.money")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const sp = spreadPct(r.bid, r.ask);
              const level = executionLevel(r.price, r.bid, r.ask, r.side);
              const wide = sp != null && sp > 10;
              return (
                <tr key={r.id} className={r.expiryStatus === "expirado" ? "expired-row" : undefined}>
                  <td className="left">{dateOf(r.timestamp)} · {timeOf(r.timestamp)}</td>
                  <td className="left">
                    {contractLabel(r)}
                    {r.flags.repeated && <RepeatBadge count={repeatCounts.get(repeatKey(r)) ?? 2} />}
                  </td>
                  <td className="left">
                    {r.expiration ?? "—"}
                    {r.dte != null && (
                      <span className="muted"> ({r.dte >= 0 ? `${r.dte}d` : t("conviction.agoDays", { n: Math.abs(r.dte) })})</span>
                    )}
                  </td>
                  <td>
                    <span className={`pill st-${r.expiryStatus}`}>{statusLabel(r.expiryStatus, t)}</span>
                  </td>
                  <td>
                    <span className={`pill ${r.aggression === "ask" ? "agg-ask" : r.aggression === "bid" ? "agg-bid" : "agg-mid"}`}>
                      {r.aggression === "ask" ? t("convictionTx.buy") : r.aggression === "bid" ? t("convictionTx.sell") : t("convictionTx.mid")}
                    </span>
                  </td>
                  <td className="muted">{EXECUTION_LABEL[level]}</td>
                  <td className={wide ? "sp-wide" : undefined}>
                    {sp != null ? `${sp.toFixed(1)}%` : "—"}{wide ? " ⚠" : ""}
                  </td>
                  <td>{int.format(r.size)}</td>
                  <td>{money.format(r.premium)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="pxsrc" style={{ marginTop: 8 }}>
        <Rich text={t("convictionTx.footnote")} />
        {meta.saved?.firstSeen && t("convictionTx.historySince", { date: dateOf(meta.saved.firstSeen) })}
      </p>
    </div>
  );
}
