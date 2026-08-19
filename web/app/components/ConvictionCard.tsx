"use client";

import { EXECUTION_LABEL, spreadPct, type ConvictionScore, type ExecutionLevel, type FlowRow } from "@/lib/flow";
import { useLocale, type LocaleCtx } from "@/lib/i18n";
import { int, money, px } from "../format";

function statusLabel(s: FlowRow["expiryStatus"], t: LocaleCtx["t"]): string {
  return s === "expirado" ? t("conviction.expired")
    : s === "expira_hoy" ? t("conviction.expiresToday")
    : s === "vigente" ? t("conviction.active") : "—";
}

const ASK = "#3fd07a";
const BID = "#ff6b6b";

/** Orden de más a menos agresivo, para la barra de niveles de ejecución. */
const LEVEL_ORDER: ExecutionLevel[] = ["above_ask", "below_bid", "at_ask", "at_bid", "near", "mid", "unclear"];
const LEVEL_COLOR: Record<ExecutionLevel, string> = {
  above_ask: "#3fd07a", below_bid: "#ff6b6b",
  at_ask: "#2f9e63", at_bid: "#c9524f",
  near: "#ffb020", mid: "#5b6675", unclear: "#3a4048",
};

function Metric({ label, value, points, hint }: { label: string; value: string; points: number; hint: string }) {
  return (
    <div className="cv-metric">
      <div className="cv-metric-label">{label}</div>
      <div className="cv-metric-value">{value}</div>
      <div className="cv-metric-pts">{points}<span className="muted">/10</span></div>
      <div className="cv-metric-hint muted">{hint}</div>
    </div>
  );
}

export default function ConvictionCard({ conviction }: { conviction: ConvictionScore }) {
  const { t } = useLocale();
  const { score, spread, dominance, execution, n } = conviction;
  const domSide = dominance.side === "ask" ? t("conviction.buy") : t("conviction.sell");
  const domColor = dominance.side === "ask" ? ASK : BID;

  const cls = score >= 7 ? "up" : score <= 3 ? "down" : "neutral";
  const verdict =
    n === 0 ? t("conviction.noData")
      : score >= 8 ? t("conviction.veryHigh")
        : score >= 6 ? t("conviction.high")
          : score >= 4 ? t("conviction.mid")
            : t("conviction.low");

  const totalLevels = LEVEL_ORDER.reduce((s, l) => s + execution.counts[l], 0);

  return (
    <section className="scorecard cv-card">
      <div className="score-main">
        <div className="score-cat">{t("conviction.title")}</div>
        <div className={`score-num ${cls}`}>{score}<span className="score-den">/10</span></div>
        <div className="score-q">{t("conviction.q")}</div>
      </div>

      <div className="score-detail">
        <div className={`score-verdict ${cls}`}>{verdict}</div>

        <div className="cv-metrics">
          <Metric
            label={t("conviction.spread")}
            value={spread.avgPct != null ? `${spread.avgPct.toFixed(2)}%` : "—"}
            points={spread.points}
            hint={spread.avgPct == null ? t("conviction.noQuotes") : spread.avgPct < 2 ? t("conviction.veryLiquid") : spread.avgPct <= 5 ? t("conviction.acceptable") : t("conviction.wide")}
          />
          <Metric
            label={t("conviction.dominance", { side: domSide })}
            value={`${dominance.dominantPct.toFixed(0)}%`}
            points={dominance.points}
            hint={t("conviction.dominanceHint", { ask: dominance.askPct.toFixed(0), bid: dominance.bidPct.toFixed(0) })}
          />
          <Metric
            label={t("conviction.execStrength")}
            value={execution.avgRaw.toFixed(1)}
            points={execution.points}
            hint={t("conviction.execHint")}
          />
        </div>

        {totalLevels > 0 && (
          <>
            <div className="cv-bar">
              {LEVEL_ORDER.filter((l) => execution.counts[l] > 0).map((l) => (
                <div
                  key={l}
                  className="cv-bar-seg"
                  style={{ width: `${(100 * execution.counts[l]) / totalLevels}%`, background: LEVEL_COLOR[l] }}
                  title={`${EXECUTION_LABEL[l]}: ${execution.counts[l]} trades`}
                />
              ))}
            </div>
            <div className="cv-legend muted">
              {LEVEL_ORDER.filter((l) => execution.counts[l] > 0).map((l) => (
                <span key={l}>
                  <span className="cv-dot" style={{ background: LEVEL_COLOR[l] }} />
                  {EXECUTION_LABEL[l]} <b>{execution.counts[l]}</b>
                </span>
              ))}
              <span className="muted">· {t("conviction.trades", { n: int.format(n) })}</span>
            </div>
          </>
        )}

        {spread.wideCount > 0 && (
          <div className="cv-alert">
            <div className="cv-alert-head">
              ⚠ {t("conviction.wideAlert", { n: spread.wideCount, plural: spread.wideCount > 1 ? "s" : "" })}
              <span className="cv-alert-sub"> {t("conviction.wideAlertSub")}</span>
            </div>
            {spread.wideAlert.length > 0 && (
              <div className="cv-alert-list">
                {spread.wideAlert.slice(0, 3).map((r) => {
                  const sp = spreadPct(r.bid, r.ask);
                  return (
                    <div key={r.id} className="cv-alert-item">
                      <div className="cv-alert-row1">
                        <b className="cv-alert-contract">
                          {r.underlying} {r.strike != null ? px.format(r.strike) : "?"}{r.type === "call" ? "C" : "P"}
                        </b>
                        <span className={`pill st-${r.expiryStatus}`}>{statusLabel(r.expiryStatus, t)}</span>
                        <span className="cv-alert-money">{money.format(r.premium)}</span>
                      </div>
                      <div className="cv-alert-row2">
                        {t("conviction.expires", { exp: "" })}<b>{r.expiration ?? "—"}</b>
                        {r.dte != null && <> ({r.dte >= 0 ? t("conviction.inDays", { n: r.dte }) : t("conviction.agoDays", { n: Math.abs(r.dte) })})</>}
                        {" · "}bid {px.format(r.bid)} / ask {px.format(r.ask)}
                        {sp != null && <> · spread <b>{sp.toFixed(1)}%</b></>}
                      </div>
                    </div>
                  );
                })}
                {spread.wideAlert.length > 3 && <div className="muted">{t("conviction.more", { n: spread.wideAlert.length - 3 })}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
