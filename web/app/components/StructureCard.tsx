"use client";

import type { ChainSnapshot } from "@/lib/chainStore";
import type { StructureScore } from "@/lib/structure";
import { useLocale, Rich } from "@/lib/i18n";
import { int, money, px } from "../format";

const CALL = "#3fd07a";
const PUT = "#ff6b6b";

export default function StructureCard({ s, history = [] }: { s: StructureScore; history?: ChainSnapshot[] }) {
  const { t } = useLocale();
  const cls = s.score >= 7 ? "up" : s.score <= 3 ? "down" : "neutral";
  const verdict =
    s.notional.strikeCount === 0 ? t("structure.noData")
      : s.score >= 8 ? t("structure.veryClear")
        : s.score >= 6 ? t("structure.clear")
          : s.score >= 4 ? t("structure.moderate")
            : t("structure.diffuse");

  const sideColor = s.strikes.dominantSide === "calls" ? CALL : PUT;

  return (
    <>
      <section className="scorecard cv-card">
        <div className="score-main">
          <div className="score-cat">{t("structure.title")}</div>
          <div className={`score-num ${cls}`}>{s.score}<span className="score-den">/10</span></div>
          <div className="score-q">{t("structure.q")}</div>
        </div>

        <div className="score-detail">
          <div className={`score-verdict ${cls}`}>{verdict}</div>

          <div className="cv-metrics">
            <div className="cv-metric">
              <div className="cv-metric-label">{t("structure.avgNotional")}</div>
              <div className="cv-metric-value">{money.format(s.notional.avgPerStrike)}</div>
              <div className="cv-metric-pts">{s.notional.points}<span className="muted">/10</span></div>
              <div className="cv-metric-hint muted">{t("structure.perStrike", { n: int.format(s.notional.strikeCount) })}</div>
            </div>
            <div className="cv-metric">
              <div className="cv-metric-label">{t("structure.dominantStrikes")}</div>
              <div className="cv-metric-value">
                {s.strikes.dominantCount}<span className="muted" style={{ fontSize: 14 }}>/{s.strikes.consideredCount}</span>
              </div>
              <div className="cv-metric-pts">{s.strikes.points}<span className="muted">/10</span></div>
              <div className="cv-metric-hint muted">{t("structure.dominantHint")}</div>
            </div>
            <div className="cv-metric">
              <div className="cv-metric-label">{t("structure.volOI")}</div>
              <div className="cv-metric-value">{s.volOI.pct.toFixed(0)}%</div>
              <div className="cv-metric-pts">{s.volOI.points}<span className="muted">/10</span></div>
              <div className="cv-metric-hint muted">{t("structure.volOIHint", { a: int.format(s.volOI.exceeded), b: int.format(s.volOI.considered) })}</div>
            </div>
          </div>

          <div className="split-bar">
            <div className="split-ask" style={{ width: `${s.strikes.callPct}%` }} />
            <div className="split-bid" style={{ width: `${s.strikes.putPct}%` }} />
          </div>
          <div className="split-legend">
            <span><span className="dot-ask" /> {t("structure.calls")} {s.strikes.callPct.toFixed(0)}%</span>
            <span><span className="dot-bid" /> {t("structure.puts")} {s.strikes.putPct.toFixed(0)}%</span>
            <span style={{ color: sideColor, fontWeight: 600 }}>
              {t("structure.dominate", { side: s.strikes.dominantSide === "calls" ? "CALLS" : "PUTS" })}
            </span>
            <span className="muted">{t("structure.totalNotional", { v: money.format(s.notional.total) })}</span>
          </div>

          {s.notional.lowLiquidity && (
            <div className="cv-alert">
              <div className="cv-alert-head">
                ⚠ {t("structure.lowLiquidity")}
                <span className="cv-alert-sub">{t("structure.lowLiquidityDetail")}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {s.strikes.top.length > 0 && (
        <div className="clusters">
          <div className="clusters-title">
            🎯 {t("structure.accumTitle")}
            <span className="muted">{t("structure.accumSub")}</span>
          </div>

          <div className="struct-grid">
            <div>
              <div className="struct-sub">{t("structure.topStrikes")}</div>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("structure.strike")}</th><th>{t("structure.notional")}</th><th>{t("structure.pctTotal")}</th>
                      <th>{t("structure.side")}</th><th>{t("structure.dominance")}</th><th>{t("structure.openInterest")}</th><th>{t("structure.volume")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.strikes.top.map((row, i) => (
                      <tr key={row.strike} className={i < s.strikes.consideredCount && row.dominant ? "unusual" : undefined}>
                        <td><b>{px.format(row.strike)}</b></td>
                        <td>{money.format(row.notional)}</td>
                        <td>{row.pctOfTotal.toFixed(1)}%</td>
                        <td>
                          <span className={`pill ${row.side === "calls" ? "agg-ask" : "agg-bid"}`}>
                            {row.side === "calls" ? "CALLS" : "PUTS"}
                          </span>
                        </td>
                        <td className={row.dominant ? "mv-ok" : "muted"}>
                          {(row.dominancePct ?? 0).toFixed(0)}%{row.dominant ? " ✓" : ""}
                        </td>
                        <td>{int.format(row.openInterest)}</td>
                        <td>{int.format(row.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="struct-sub">{t("structure.keyExpirations")}</div>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th className="left">{t("structure.expiration")}</th><th>{t("structure.notional")}</th>
                      <th>{t("structure.pctTotal")}</th><th>{t("structure.contractsCol")}</th><th>{t("structure.bias")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.expirations.map((e) => {
                      const calls = e.notional > 0 ? (e.callNotional / e.notional) * 100 : 0;
                      return (
                        <tr key={e.expiration}>
                          <td className="left">{e.expiration}</td>
                          <td>{money.format(e.notional)}</td>
                          <td>{e.pctOfTotal.toFixed(1)}%</td>
                          <td>{int.format(e.contracts)}</td>
                          <td>
                            <span className={`pill ${calls >= 50 ? "agg-ask" : "agg-bid"}`}>
                              {calls >= 50 ? `${calls.toFixed(0)}% calls` : `${(100 - calls).toFixed(0)}% puts`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <p className="pxsrc" style={{ marginTop: 8 }}>
            <Rich text={t("structure.footnote", { n: s.strikes.consideredCount })} />
          </p>

          <div className="struct-sub" style={{ marginTop: 16 }}>
            {t("structure.dailyHistory", { n: history.length, day: history.length === 1 ? t("structure.day") : t("structure.days") })}
          </div>
          {history.length <= 1 ? (
            <p className="pxsrc">
              <Rich text={t("structure.snapshotNote")} />
            </p>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th className="left">{t("structure.histDay")}</th><th>{t("structure.histScore")}</th><th>{t("structure.histAvgNotional")}</th>
                    <th>{t("structure.histDominant")}</th><th>{t("structure.histVolOI")}</th><th>{t("structure.histCallsPuts")}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => {
                    const prev = history[i + 1];
                    const delta = prev ? h.score - prev.score : null;
                    return (
                      <tr key={h.date}>
                        <td className="left">{h.date}{i === 0 && <span className="muted"> {t("structure.today")}</span>}</td>
                        <td>
                          <b>{h.score}</b><span className="muted">/10</span>
                          {delta != null && delta !== 0 && (
                            <span className={delta > 0 ? "mv-ok" : "mv-bad"}> {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</span>
                          )}
                        </td>
                        <td>{money.format(h.avgNotionalPerStrike)}</td>
                        <td>{h.dominantCount}</td>
                        <td>{h.volOIPct.toFixed(0)}%</td>
                        <td>
                          <span className={h.dominantSide === "calls" ? "mv-ok" : "mv-bad"}>
                            {h.callPct.toFixed(0)}% / {h.putPct.toFixed(0)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
