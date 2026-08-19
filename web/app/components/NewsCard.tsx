"use client";

import { useEffect, useState } from "react";
import type { CompanyInfo } from "@/lib/types";
import type { Bias, NewsItem, NewsReport } from "@/lib/news";
import { contradictionFlag, flowBias } from "@/lib/news";
import { useLocale, type LocaleCtx } from "@/lib/i18n";

function ago(iso: string, locale: "es" | "en"): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 0) return "";
  const unit = (n: number, u: string) => (locale === "en" ? `${n}${u} ago` : `hace ${n}${u}`);
  if (min < 60) return unit(min, "m");
  const h = Math.round(min / 60);
  if (h < 24) return unit(h, "h");
  return unit(Math.round(h / 24), "d");
}

function sentLabel(s: string, t: LocaleCtx["t"]): string {
  return s === "positive" ? t("news.positive") : s === "negative" ? t("news.negative") : t("news.neutral");
}
function biasLabel(b: Bias, t: LocaleCtx["t"]): string {
  return b === "bullish" ? t("news.biasBullish") : b === "bearish" ? t("news.biasBearish")
    : b === "mixed" ? t("news.biasMixed") : t("news.biasNeutral");
}

function Article({ n, t, locale }: { n: NewsItem; t: LocaleCtx["t"]; locale: "es" | "en" }) {
  return (
    <a className="news-item" href={n.url} target="_blank" rel="noopener noreferrer">
      <div className="news-item-top">
        {n.sentiment && <span className={`news-sent ${n.sentiment}`}>{sentLabel(n.sentiment, t)}</span>}
        {n.matchedBy && <span className="news-sent match">RSS · {n.matchedBy}</span>}
        <span className="news-meta">{n.publisher} · {ago(n.publishedUtc, locale)}</span>
      </div>
      <div className="news-title">{n.title}</div>
      {n.reasoning && <div className="news-why">{n.reasoning}</div>}
    </a>
  );
}

/**
 * Tarea 7 — Noticias y catalizadores.
 * Capa 1 (macro) = los feeds RSS del documento; capa 2 (empresa) = Massive con
 * sentimiento por ticker. La bandera confronta el flujo contra las noticias
 * SIN tocar los 100 pts del scorecard.
 */
export default function NewsCard({
  ticker,
  company,
  callPct,
}: {
  ticker: string;
  company: CompanyInfo | null;
  callPct: number | null;
}) {
  const { t, locale } = useLocale();
  const [report, setReport] = useState<NewsReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReport(null); setFailed(false);
    const q = new URLSearchParams({ ticker });
    if (company?.name) q.set("name", company.name);
    fetch(`/api/news?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("news"))))
      .then((d: NewsReport) => { if (!cancelled) setReport(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [ticker, company?.name]);

  const flag =
    report && callPct != null ? contradictionFlag(flowBias(callPct), report.bias) : null;

  return (
    <section className="card">
      <div>
        <div className="card-title">{t("news.title")}</div>
        <div className="card-sub">{t("news.sub", { ticker })}</div>
      </div>

      {!report && !failed && <div className="feed-empty">{t("news.loading", { ticker })}</div>}
      {failed && <div className="feed-empty">{t("news.failed")}</div>}

      {report && (
        <>
          {flag && flag.kind !== "none" && (
            <div className={`news-flag ${flag.kind}`}>
              <div className="news-flag-title">
                {flag.kind === "conflict" ? "⚠" : "✓"} {flag.title}
              </div>
              <div className="news-flag-detail">{flag.detail}</div>
              <div className="news-flag-foot">
                {t("news.flowFoot", {
                  pct: callPct ?? 0,
                  bias: biasLabel(report.bias.bias, t),
                  counts: report.bias.positive + report.bias.negative > 0
                    ? ` (${report.bias.positive}↑ / ${report.bias.negative}↓)` : "",
                })}
              </div>
            </div>
          )}

          {report.company.length > 0 && (
            <div>
              <div className="news-head">{t("news.fromCompany")}</div>
              <div className="news-list">
                {report.company.slice(0, 4).map((n) => <Article key={n.id} n={n} t={t} locale={locale} />)}
              </div>
            </div>
          )}

          {report.promoted.length > 0 && (
            <div>
              <div className="news-head">{t("news.rssMentions", { ticker })}</div>
              <div className="news-list">
                {report.promoted.map((n) => <Article key={n.id} n={n} t={t} locale={locale} />)}
              </div>
            </div>
          )}

          <div>
            <div className="news-head">
              {t("news.marketClimate")} <span className="news-head-note">{t("news.marketClimateNote")}</span>
            </div>
            <div className="news-list">
              {report.macro.slice(0, 4).map((n) => <Article key={n.id} n={n} t={t} locale={locale} />)}
              {report.macro.length === 0 && (
                <div className="feed-empty">{t("news.rssFailed")}</div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
