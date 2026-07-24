"use client";

import { useEffect, useState } from "react";
import type { CompanyInfo } from "@/lib/types";
import type { Bias, NewsReport } from "@/lib/news";
import { contradictionFlag, flowBias } from "@/lib/news";

const BIAS: Record<Bias, { text: string; cls: string }> = {
  bullish: { text: "Noticias positivas", cls: "up" },
  bearish: { text: "Noticias negativas", cls: "down" },
  mixed: { text: "Noticias mixtas", cls: "flat" },
  neutral: { text: "Sin noticias marcadas", cls: "flat" },
};

/**
 * Contexto de noticias en UNA línea para la vista Estudiante.
 * Reusa /api/news y la bandera de contradicción (flujo vs. noticias). Sin listas ni jerga.
 */
export default function ContextoLinea({
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

  if (failed) return null;
  if (!report) return <div className="ctx-line ctx-loading">📰 Leyendo noticias de {ticker}…</div>;

  const b = BIAS[report.bias.bias];
  const flag = callPct != null ? contradictionFlag(flowBias(callPct), report.bias) : null;
  const agree =
    flag?.kind === "confirm" ? { txt: "coincide con el flujo ✓", cls: "up" }
    : flag?.kind === "conflict" ? { txt: "contradice al flujo ⚠", cls: "down" }
    : null;

  return (
    <div className={`ctx-line ctx-${b.cls}`}>
      <span className="ctx-icon">📰</span>
      <span className="ctx-text"><b>{b.text}</b> sobre {ticker}</span>
      {agree && <span className={`ctx-flag ${agree.cls}`}>{agree.txt}</span>}
    </div>
  );
}
