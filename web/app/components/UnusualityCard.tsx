"use client";

import { useMemo, useState } from "react";
import { UNUSUAL_TRADE_THRESHOLD, type FlowRow, type UnusualScores } from "@/lib/flow";
import RepeatBadge, { buildRepeatCounts, repeatKey } from "./RepeatBadge";
import { useLocale, Rich, type LocaleCtx } from "@/lib/i18n";
import { dateOf, int, money, px, timeOf } from "../format";

export interface UnusualRow extends FlowRow {
  unusualScores: UnusualScores;
  confirmedByAggression: boolean;
}

export interface UnusualityMeta {
  score: number;
  avgByParam: { size: number; delta: number; theta: number; gamma: number; leg: number; expiry: number };
  unusualCount: number;
  n: number;
  confirmedCount: number;
}

const PARAMS: { key: keyof UnusualityMeta["avgByParam"]; labelKey: string; hintKey: string }[] = [
  { key: "size", labelKey: "unusuality.size", hintKey: "unusuality.sizeHint" },
  { key: "delta", labelKey: "unusuality.delta", hintKey: "unusuality.deltaHint" },
  { key: "theta", labelKey: "unusuality.theta", hintKey: "unusuality.thetaHint" },
  { key: "gamma", labelKey: "unusuality.gamma", hintKey: "unusuality.gammaHint" },
  { key: "leg", labelKey: "unusuality.leg", hintKey: "unusuality.legHint" },
  { key: "expiry", labelKey: "unusuality.expiry", hintKey: "unusuality.expiryHint" },
];

function contractLabel(r: FlowRow): string {
  const t = r.type === "call" ? "C" : r.type === "put" ? "P" : "?";
  return `${r.underlying} ${r.strike != null ? px.format(r.strike) : "?"}${t}`;
}

export default function UnusualityCard({ meta, rows }: { meta: UnusualityMeta; rows: UnusualRow[] }) {
  const { t } = useLocale();
  const [soloInusuales, setSoloInusuales] = useState(true);
  const repeatCounts = useMemo(() => buildRepeatCounts(rows), [rows]);

  const shown = useMemo(
    () => (soloInusuales ? rows.filter((r) => r.unusualScores.total >= UNUSUAL_TRADE_THRESHOLD) : rows),
    [rows, soloInusuales],
  );

  const cls = meta.score >= 7 ? "up" : meta.score <= 3 ? "down" : "neutral";
  const verdict =
    meta.n === 0 ? t("unusuality.noData")
      : meta.score >= 8 ? t("unusuality.veryAbnormal")
        : meta.score >= 6 ? t("unusuality.abnormal")
          : meta.score >= 4 ? t("unusuality.somewhatUnusual")
            : t("unusuality.normal");

  return (
    <>
      <section className="scorecard cv-card">
        <div className="score-main">
          <div className="score-cat">{t("unusuality.title")}</div>
          <div className={`score-num ${cls}`}>{meta.score}<span className="score-den">/10</span></div>
          <div className="score-q">{t("unusuality.q")}</div>
        </div>

        <div className="score-detail">
          <div className={`score-verdict ${cls}`}>{verdict}</div>

          <div className="cv-metrics">
            {PARAMS.map((p) => (
              <div key={p.key} className="cv-metric">
                <div className="cv-metric-label">{t(p.labelKey)}</div>
                <div className="cv-metric-value">{meta.avgByParam[p.key].toFixed(1)}<span className="muted" style={{ fontSize: 13 }}>/10</span></div>
                <div className="cv-metric-hint muted">{t(p.hintKey)}</div>
              </div>
            ))}
          </div>

          <div className="split-legend">
            <span>{t("unusuality.unusualCount", { n: int.format(meta.unusualCount), th: UNUSUAL_TRADE_THRESHOLD })}</span>
            <span className="muted">{t("unusuality.reviewedOf", { n: int.format(meta.n) })}</span>
            {meta.confirmedCount > 0 && (
              <span className="cv-confirm">{t("unusuality.confirmed", { n: int.format(meta.confirmedCount) })}</span>
            )}
          </div>
        </div>
      </section>

      {rows.length > 0 && (
        <div className="clusters">
          <div className="clusters-title">
            🔬 {t("unusuality.tableTitle")}
            <span className="muted">{t("unusuality.tableSub")}</span>
          </div>

          <div className="tf-toggle" style={{ marginBottom: 10 }}>
            <button type="button" className={`tf-btn ${soloInusuales ? "on" : ""}`} onClick={() => setSoloInusuales(true)}>
              {t("unusuality.onlyUnusual", { n: int.format(meta.unusualCount) })}
            </button>
            <button type="button" className={`tf-btn ${!soloInusuales ? "on" : ""}`} onClick={() => setSoloInusuales(false)}>
              {t("unusuality.all", { n: int.format(rows.length) })}
            </button>
          </div>

          <div className="tablewrap tall">
            <table>
              <thead>
                <tr>
                  <th className="left">{t("unusuality.date")}</th>
                  <th className="left">{t("unusuality.contract")}</th>
                  <th className="left">{t("unusuality.expiration")}</th>
                  <th>{t("unusuality.money")}</th>
                  <th>Delta</th>
                  <th>{t("unusuality.thetaPerDay")}</th>
                  <th>Gamma</th>
                  <th className="left">{t("unusuality.leg")}</th>
                  <th>{t("unusuality.abbrSize")}</th><th>Δ</th><th>Θ</th><th>Γ</th><th>Leg</th><th>{t("unusuality.abbrExp")}</th>
                  <th>{t("unusuality.unusualCol")}</th>
                  <th className="left">{t("unusuality.validation")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const s = r.unusualScores;
                  return (
                    <tr key={r.id} className={s.total >= UNUSUAL_TRADE_THRESHOLD ? "unusual" : undefined}>
                      <td className="left">{dateOf(r.timestamp)} · {timeOf(r.timestamp)}</td>
                      <td className="left">
                        {contractLabel(r)}
                        {r.flags.repeated && <RepeatBadge count={repeatCounts.get(repeatKey(r)) ?? 2} />}
                      </td>
                      <td className="left">
                        {r.expiration ?? "—"}
                        {r.dte != null && <span className="muted"> ({r.dte}d)</span>}
                      </td>
                      <td>{money.format(r.premium)}</td>
                      <td>{r.delta.toFixed(2)}</td>
                      <td>{r.thetaPctDaily != null ? `${r.thetaPctDaily.toFixed(2)}%` : "—"}</td>
                      <td>{r.gamma.toFixed(4)}</td>
                      <td className="left" title={r.conditionName ?? ""}>
                        {r.conditionCode ?? "—"}
                        <span className={r.flags.multileg ? "leg-multi" : "leg-single"}>
                          {" "}{r.flags.multileg ? t("unusuality.multi") : t("unusuality.single")}
                        </span>
                      </td>
                      <td className="muted">{s.size}</td>
                      <td className="muted">{s.delta}</td>
                      <td className="muted">{s.theta}</td>
                      <td className="muted">{s.gamma}</td>
                      <td className="muted">{s.leg}</td>
                      <td className="muted">{s.expiry}</td>
                      <td><b>{s.total.toFixed(1)}</b><span className="muted">/10</span></td>
                      <td className="left">
                        {r.confirmedByAggression
                          ? <span className="chip chip-ask">{t("unusuality.alsoAggression")}</span>
                          : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="pxsrc" style={{ marginTop: 8 }}>
            <Rich text={t("unusuality.footnote", { th: UNUSUAL_TRADE_THRESHOLD })} />
          </p>
        </div>
      )}
    </>
  );
}
