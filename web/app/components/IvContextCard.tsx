"use client";

import type { IvContextScore } from "@/lib/ivcontext";
import { useLocale, type LocaleCtx } from "@/lib/i18n";
import { int, money, px } from "../format";

function regimeLabel(r: string, t: LocaleCtx["t"]): string {
  const key = ({
    dormida: "ivContext.regimeDormida", compresion: "ivContext.regimeCompresion",
    expansion: "ivContext.regimeExpansion", inflada: "ivContext.regimeInflada",
    normal: "ivContext.regimeNormal", desconocido: "ivContext.regimeDesconocido",
  } as Record<string, string>)[r];
  return key ? t(key) : r;
}

function ivColor(ivPct: number): string {
  if (ivPct >= 90) return "#f04438";
  if (ivPct >= 61) return "#f79009";
  if (ivPct >= 40) return "#12b76a";
  return "var(--muted)";
}

/** Fecha real + días restantes — nunca uno sin el otro. */
function expLabel(expiration: string | null, dte: number | null): string {
  if (!expiration) return "—";
  return dte == null ? expiration : `${expiration} (${dte}d)`;
}

/**
 * Sub-agente 5 — Contexto IV. Muestra lo que pide el documento: promedio de IV
 * por vencimiento y los contratos de mayor IV, más el IV Rank y su régimen.
 */
export default function IvContextCard({ s }: { s: IvContextScore }) {
  const { t } = useLocale();
  const cls = s.score >= 7 ? "up" : s.score <= 3 ? "down" : "neutral";
  const maxIvExp = Math.max(...s.byExpiration.map((e) => e.avgIv), 1);

  return (
    <>
      <section className="scorecard cv-card">
        <div className="score-main">
          <div className="score-cat">{t("ivContext.title")}</div>
          <div className={`score-num ${cls}`}>{s.score}<span className="score-den">/10</span></div>
          <div className="score-q">{t("ivContext.q")}</div>
        </div>

        <div className="score-detail">
          <div className={`score-verdict ${cls}`}>{regimeLabel(s.regime, t)}</div>

          <div className="cv-metrics">
            <div className="cv-metric">
              <div className="cv-metric-label">{t("ivContext.currentIv")}</div>
              <div className="cv-metric-value" style={{ color: s.iv.current != null ? ivColor(s.iv.current) : undefined }}>
                {s.iv.current != null ? `${s.iv.current.toFixed(1)}%` : "—"}
              </div>
              <div className="cv-metric-pts">{s.iv.points}<span className="muted">/10</span></div>
              <div className="cv-metric-hint muted">
                {s.iv.band} {t("ivContext.weighted")}
              </div>
            </div>

            <div className="cv-metric">
              <div className="cv-metric-label">{t("ivContext.ivRank")}</div>
              <div className="cv-metric-value">
                {s.rank.value != null ? `${s.rank.value.toFixed(0)}%` : "—"}
              </div>
              <div className="cv-metric-pts">{s.rank.points}<span className="muted">/10</span></div>
              <div className="cv-metric-hint muted">
                {s.rank.band}
                {s.rank.low != null && s.rank.high != null &&
                  t("ivContext.range", { lo: s.rank.low.toFixed(0), hi: s.rank.high.toFixed(0) })}
              </div>
            </div>

            <div className="cv-metric">
              <div className="cv-metric-label">{t("ivContext.frontSkew")}</div>
              <div className="cv-metric-value" style={{ color: (s.frontSkew ?? 0) > 10 ? "#f04438" : undefined }}>
                {s.frontSkew != null ? `${s.frontSkew >= 0 ? "+" : ""}${s.frontSkew.toFixed(1)} pts` : "—"}
              </div>
              <div className="cv-metric-hint muted">
                {s.frontSkew != null && s.frontSkew > 10
                  ? t("ivContext.frontSkewHint")
                  : t("ivContext.frontSkewNormal")}
              </div>
            </div>
          </div>

          <div className="iv-note">{s.note}</div>

          {s.iv.special && (
            <div className="iv-special">
              ⚠ <b>{t("ivContext.specialTitle")}</b>{t("ivContext.specialDetail")}
            </div>
          )}

          <div className="iv-source muted">
            {t("ivContext.rankSourceLead")}{" "}
            {s.rank.source === "iv-history"
              ? <><b>{t("ivContext.rankHistory")}</b>{t("ivContext.rankHistoryDays", { n: s.rank.days })}</>
              : s.rank.source === "realized-proxy"
                ? <>
                    <b>{t("ivContext.rankProxy")}</b>{t("ivContext.rankProxyDetail", { n: s.rank.days })}
                  </>
                : t("ivContext.rankNone")}
          </div>
        </div>
      </section>

      {s.byExpiration.length > 0 && (
        <div className="clusters">
          <h2 className="clusters-title">
            {t("ivContext.byExpiration")}
            <span className="muted">{t("ivContext.contractsWithIv", { n: s.iv.contracts })}</span>
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("ivContext.expiration")}</th>
                  <th className="num">{t("ivContext.trades")}</th>
                  <th className="num">{t("ivContext.avgIv")}</th>
                  <th className="num">{t("ivContext.maxIv")}</th>
                  <th className="num">{t("ivContext.premium")}</th>
                  <th>{t("ivContext.level")}</th>
                </tr>
              </thead>
              <tbody>
                {s.byExpiration.map((e) => (
                  <tr key={e.expiration}>
                    <td><b>{expLabel(e.expiration, e.dte)}</b></td>
                    <td className="num">{int.format(e.trades)}</td>
                    <td className="num" style={{ color: ivColor(e.avgIv), fontWeight: 700 }}>
                      {e.avgIv.toFixed(1)}%
                    </td>
                    <td className="num muted">{e.maxIv.toFixed(1)}%</td>
                    <td className="num">{money.format(e.premium)}</td>
                    <td>
                      <div className="iv-bar">
                        <div style={{ width: `${(e.avgIv / maxIvExp) * 100}%`, background: ivColor(e.avgIv) }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {s.topContracts.length > 0 && (
        <div className="clusters">
          <h2 className="clusters-title">
            {t("ivContext.topContracts")}
            <span className="muted">{t("ivContext.topContractsSub")}</span>
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("ivContext.contract")}</th>
                  <th>{t("ivContext.type")}</th>
                  <th>{t("ivContext.expiration")}</th>
                  <th className="num">IV</th>
                  <th className="num">{t("optionChain.contracts")}</th>
                  <th className="num">{t("ivContext.premium")}</th>
                </tr>
              </thead>
              <tbody>
                {s.topContracts.map((c) => (
                  <tr key={c.id}>
                    <td><b>${c.strike != null ? px.format(c.strike) : "?"}</b></td>
                    <td>
                      <span className={`pill ${c.type === "call" ? "call" : "put"}`}>
                        {c.type === "call" ? "CALL" : "PUT"}
                      </span>
                    </td>
                    <td>{expLabel(c.expiration, c.dte)}</td>
                    <td className="num" style={{ color: ivColor(c.iv), fontWeight: 700 }}>
                      {c.iv.toFixed(1)}%
                    </td>
                    <td className="num">{int.format(c.size)}</td>
                    <td className="num">{money.format(c.premium)}</td>
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
