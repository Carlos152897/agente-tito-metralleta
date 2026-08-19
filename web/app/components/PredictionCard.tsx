"use client";

import type { ProPrediction, Scenario } from "@/lib/prediction";
import { HORIZONS } from "@/lib/prediction";
import type { FlowRow } from "@/lib/flow";
import { useLocale, type LocaleCtx } from "@/lib/i18n";
import { money, px } from "../format";

const KIND: Record<Scenario["kind"], { key: string; color: string; bg: string }> = {
  bear: { key: "prediction.bearCase", color: "#d92d20", bg: "#fef3f2" },
  base: { key: "prediction.baseCase", color: "#101828", bg: "#f8f9fb" },
  bull: { key: "prediction.bullCase", color: "#027a48", bg: "#f6fef9" },
};

function ScenarioBox({ s, t }: { s: Scenario; t: LocaleCtx["t"] }) {
  const k = KIND[s.kind];
  return (
    <div className="sc-box" style={{ background: k.bg, borderColor: `${k.color}22` }}>
      <div className="sc-head" style={{ color: k.color }}>{t(k.key)}</div>
      <div className="sc-target" style={{ color: k.color }}>${px.format(s.target)}</div>
      <div className="sc-chg" style={{ color: k.color }}>
        {s.changePct >= 0 ? "+" : ""}{s.changePct.toFixed(1)}%
      </div>
      <div className="sc-prob">
        <div className="sc-prob-bar">
          <div style={{ width: `${Math.round(s.probability * 100)}%`, background: k.color }} />
        </div>
        <span>{t("prediction.touchChance", { pct: (s.probability * 100).toFixed(0) })}</span>
      </div>
      <div className="sc-driver">{s.driver}</div>
    </div>
  );
}

/**
 * Prediction Pro — los tres escenarios (bear / base / bull) con su probabilidad,
 * el resumen del agente y los 3 flows más notables que sostienen la lectura.
 */
export default function PredictionCard({
  ticker,
  prediction,
  horizonDays,
  onHorizon,
  topFlows,
}: {
  ticker: string;
  prediction: ProPrediction | null;
  horizonDays: number;
  onHorizon: (d: number) => void;
  topFlows: FlowRow[];
}) {
  const { t } = useLocale();
  return (
    <section className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="card-title">
            {t("prediction.title")} <span className="pro-badge" style={{ marginLeft: 6 }}>PRO</span>
          </div>
          <div className="card-sub">{t("prediction.sub", { ticker })}</div>
        </div>
        <div className="hz-tabs">
          {HORIZONS.map((h) => (
            <button
              key={h.days}
              type="button"
              className={`hz-tab ${horizonDays === h.days ? "on" : ""}`}
              onClick={() => onHorizon(h.days)}
            >
              {h.days}d
            </button>
          ))}
        </div>
      </div>

      {!prediction ? (
        <div className="feed-empty">{t("prediction.calculating")}</div>
      ) : (
        <>
          <div className="sc-grid">
            <ScenarioBox s={prediction.bear} t={t} />
            <ScenarioBox s={prediction.base} t={t} />
            <ScenarioBox s={prediction.bull} t={t} />
          </div>

          <div className="pred-summary">
            <div className="pred-summary-head">
              {t("prediction.summaryHead")}
              <span className="pred-conf">
                {t("prediction.confMeta", { conf: prediction.confidence, score: prediction.score, active: prediction.active })}
              </span>
            </div>
            <p>{prediction.summary}</p>
            {prediction.caveat && <div className="pred-caveat">⚠ {prediction.caveat}</div>}
          </div>

          {topFlows.length > 0 && (
            <div>
              <div className="news-head">{t("prediction.topFlows")}</div>
              <div className="tf-list">
                {topFlows.slice(0, 3).map((f) => {
                  const alcista =
                    (f.type === "call" && f.aggression === "ask") ||
                    (f.type === "put" && f.aggression === "bid");
                  return (
                    <div key={f.id} className="tf-row">
                      <span className={`pill ${f.type === "call" ? "call" : "put"}`}>
                        {f.type === "call" ? "CALL" : "PUT"}
                      </span>
                      <div className="tf-body">
                        <div className="tf-title">
                          ${f.strike != null ? px.format(f.strike) : "?"}
                          <span className="muted">
                            {" "}{t("prediction.expires", { exp: f.expiration ?? "—" })}
                            {f.dte != null && ` (${f.dte}d)`}
                          </span>
                        </div>
                        <div className="tf-sub">
                          {f.aggression === "ask" ? t("prediction.buyAggressive") :
                            f.aggression === "bid" ? t("prediction.sellBid") : t("prediction.executedMid")}
                          {" · "}
                          <b style={{ color: alcista ? "#027a48" : "#d92d20" }}>
                            {alcista ? t("prediction.bullishBet") : t("prediction.bearishBet")}
                          </b>
                        </div>
                      </div>
                      <div className="tf-prem">{money.format(f.premium)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
