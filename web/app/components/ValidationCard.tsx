"use client";

import type { ValidationScore } from "@/lib/validation";
import { BACKTEST_TARGET_DAYS } from "@/lib/validation";
import { useLocale, Rich } from "@/lib/i18n";
import { int, money, px } from "../format";
import { dateET } from "../format";

const OK = "#12b76a";
const BAD = "#f04438";

function expLabel(expiration: string | null): string {
  return expiration ?? "—";
}

/**
 * Sub-agente 6 — Validación de Flows / Confirmación de Precio.
 * Backtest: para cada flow guardado mide cuánto tardó el precio en desarrollarse
 * a favor y en contra del contrato.
 */
export default function ValidationCard({ s }: { s: ValidationScore }) {
  const { t } = useLocale();
  const cls = s.score >= 7 ? "up" : s.score <= 3 ? "down" : "neutral";
  const hr = s.hitRate.value;

  return (
    <>
      <section className="scorecard cv-card">
        <div className="score-main">
          <div className="score-cat">{t("validation.title")}</div>
          <div className={`score-num ${cls}`}>{s.score}<span className="score-den">/10</span></div>
          <div className="score-q">{t("validation.q")}</div>
        </div>

        <div className="score-detail">
          <div className={`score-verdict ${cls}`}>{s.verdict}</div>

          <div className="cv-metrics">
            <div className="cv-metric">
              <div className="cv-metric-label">{t("validation.hitRate")}</div>
              <div className="cv-metric-value" style={{ color: hr != null && hr >= 55 ? OK : hr != null && hr < 45 ? BAD : undefined }}>
                {hr != null ? `${hr.toFixed(1)}%` : "—"}
              </div>
              <div className="cv-metric-pts">{s.hitRate.points}<span className="muted">/10</span></div>
              <div className="cv-metric-hint muted">
                {t("validation.judged", { a: s.hitRate.validated, b: s.hitRate.resolved })}
                {s.weightedHitRate != null && t("validation.weighted", { pct: s.weightedHitRate.toFixed(0) })}
              </div>
            </div>

            <div className="cv-metric">
              <div className="cv-metric-label">{t("validation.speed")}</div>
              <div className="cv-metric-value">
                {s.speed.medianSessions != null ? t("validation.sessions", { n: s.speed.medianSessions }) : "—"}
              </div>
              <div className="cv-metric-pts">{s.speed.points}<span className="muted">/10</span></div>
              <div className="cv-metric-hint muted">{s.speed.band}</div>
            </div>

            <div className="cv-metric">
              <div className="cv-metric-label">{t("validation.avgMove")}</div>
              <div className="cv-metric-value">
                <span style={{ color: OK }}>+{s.avgMfe?.toFixed(1) ?? "—"}%</span>
                <span className="muted" style={{ fontSize: 14 }}> / </span>
                <span style={{ color: BAD }}>−{s.avgMae?.toFixed(1) ?? "—"}%</span>
              </div>
              <div className="cv-metric-hint muted">{t("validation.favorAgainst")}</div>
            </div>
          </div>

          <div className="val-dirs">
            {s.byDirection.map((d) => (
              <div key={d.direction} className="val-dir">
                <span className={`pill ${d.direction === "alcista" ? "call" : "put"}`}>
                  {d.direction === "alcista" ? t("validation.bullish") : t("validation.bearish")}
                </span>
                <b>{d.hitRate != null ? `${d.hitRate.toFixed(0)}%` : "—"}</b>
                <span className="muted">{t("validation.confirmed", { n: d.validated, total: d.total })}</span>
              </div>
            ))}
          </div>

          <Rich className="iv-note" text={t("validation.note", { pct: s.thresholdPct.toFixed(1) })} />

          {s.coverage.belowTarget && (
            <div className="iv-special">
              ⚠ <b>{t("validation.coverageTitle", { target: BACKTEST_TARGET_DAYS })}</b>
              <Rich text={t("validation.coverageDetail", {
                days: s.coverage.days,
                flows: int.format(s.coverage.flows),
                pending: s.coverage.pending > 0 ? t("validation.pendingNote", { n: int.format(s.coverage.pending) }) : "",
                target: BACKTEST_TARGET_DAYS,
              })} />
            </div>
          )}
        </div>
      </section>

      {s.outcomes.length > 0 && (
        <div className="clusters">
          <h2 className="clusters-title">
            {t("validation.outcomesTitle")}
            <span className="muted">{t("validation.outcomesSub")}</span>
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("validation.flowDate")}</th>
                  <th>{t("validation.contract")}</th>
                  <th>{t("validation.bet")}</th>
                  <th className="num">{t("validation.premium")}</th>
                  <th className="num">{t("validation.favor")}</th>
                  <th className="num">{t("validation.against")}</th>
                  <th className="num">{t("validation.took")}</th>
                  <th>{t("validation.result")}</th>
                </tr>
              </thead>
              <tbody>
                {s.outcomes.slice(0, 25).map((o) => (
                  <tr key={o.id}>
                    <td>
                      {dateET(o.timestamp)}
                      <span className="muted"> {t("validation.daysAgo", { n: o.daysElapsed })}</span>
                    </td>
                    <td>
                      <b>${o.strike != null ? px.format(o.strike) : "?"}</b>{" "}
                      <span className={`pill ${o.type === "call" ? "call" : "put"}`}>
                        {o.type === "call" ? "CALL" : "PUT"}
                      </span>
                      <div className="muted" style={{ fontSize: 11 }}>{t("validation.vence", { exp: expLabel(o.expiration) })}</div>
                    </td>
                    <td>
                      <span className={`pill ${o.direction === "alcista" ? "call" : "put"}`}>
                        {o.direction === "alcista" ? t("validation.bullish") : t("validation.bearish")}
                      </span>
                    </td>
                    <td className="num">{money.format(o.premium)}</td>
                    <td className="num" style={{ color: OK }}>+{o.mfePct.toFixed(1)}%</td>
                    <td className="num" style={{ color: BAD }}>−{o.maePct.toFixed(1)}%</td>
                    <td className="num">
                      {o.daysToValidate != null ? t("validation.sessions", { n: o.daysToValidate }) : "—"}
                    </td>
                    <td>
                      {!o.resolved ? (
                        <span className="val-tag pending">{t("validation.veryRecent")}</span>
                      ) : o.validated ? (
                        <span className="val-tag ok">{t("validation.validated")}</span>
                      ) : (
                        <span className="val-tag bad">{t("validation.absorbed")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
