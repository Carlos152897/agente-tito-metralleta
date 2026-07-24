"use client";

import { useEffect, useState } from "react";
import type { CompanyInfo } from "@/lib/types";
import type { Bias, NewsItem, NewsReport } from "@/lib/news";
import { contradictionFlag, flowBias } from "@/lib/news";

function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 0) return "";
  if (min < 60) return `hace ${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.round(h / 24)}d`;
}

const SENT_LABEL: Record<string, string> = { positive: "POSITIVA", negative: "NEGATIVA", neutral: "NEUTRAL" };
const BIAS_LABEL: Record<Bias, string> = {
  bullish: "Noticias positivas", bearish: "Noticias negativas",
  mixed: "Noticias mixtas", neutral: "Sin dirección clara",
};

function Article({ n }: { n: NewsItem }) {
  return (
    <a className="news-item" href={n.url} target="_blank" rel="noopener noreferrer">
      <div className="news-item-top">
        {n.sentiment && <span className={`news-sent ${n.sentiment}`}>{SENT_LABEL[n.sentiment]}</span>}
        {n.matchedBy && <span className="news-sent match">RSS · {n.matchedBy}</span>}
        <span className="news-meta">{n.publisher} · {ago(n.publishedUtc)}</span>
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
        <div className="card-title">Noticias y catalizadores</div>
        <div className="card-sub">
          Por qué se está moviendo {ticker}: lo que dice la prensa, para contrastarlo con lo
          que apuesta el dinero en opciones.
        </div>
      </div>

      {!report && !failed && <div className="feed-empty">Leyendo feeds y noticias de {ticker}…</div>}
      {failed && <div className="feed-empty">No se pudieron leer las noticias ahora mismo.</div>}

      {report && (
        <>
          {flag && flag.kind !== "none" && (
            <div className={`news-flag ${flag.kind}`}>
              <div className="news-flag-title">
                {flag.kind === "conflict" ? "⚠" : "✓"} {flag.title}
              </div>
              <div className="news-flag-detail">{flag.detail}</div>
              <div className="news-flag-foot">
                Flujo {callPct}% en calls · {BIAS_LABEL[report.bias.bias]}
                {report.bias.positive + report.bias.negative > 0 &&
                  ` (${report.bias.positive}↑ / ${report.bias.negative}↓)`}
                {" "}· no altera los 100 pts del scorecard
              </div>
            </div>
          )}

          {report.company.length > 0 && (
            <div>
              <div className="news-head">De la empresa</div>
              <div className="news-list">
                {report.company.slice(0, 4).map((n) => <Article key={n.id} n={n} />)}
              </div>
            </div>
          )}

          {report.promoted.length > 0 && (
            <div>
              <div className="news-head">En los feeds RSS mencionan a {ticker}</div>
              <div className="news-list">
                {report.promoted.map((n) => <Article key={n.id} n={n} />)}
              </div>
            </div>
          )}

          <div>
            <div className="news-head">
              Clima de mercado <span className="news-head-note">— afecta a todos los tickers</span>
            </div>
            <div className="news-list">
              {report.macro.slice(0, 4).map((n) => <Article key={n.id} n={n} />)}
              {report.macro.length === 0 && (
                <div className="feed-empty">Los feeds RSS no respondieron.</div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
