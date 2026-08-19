"use client";

import { useEffect, useState } from "react";
import type { CompanyInfo } from "@/lib/types";
import type { Bias, NewsReport } from "@/lib/news";
import { contradictionFlag, flowBias } from "@/lib/news";
import { useLocale } from "@/lib/i18n";

const BIAS_KEY: Record<Bias, { key: string; cls: string }> = {
  bullish: { key: "context.positive", cls: "up" },
  bearish: { key: "context.negative", cls: "down" },
  mixed: { key: "context.mixed", cls: "flat" },
  neutral: { key: "context.neutral", cls: "flat" },
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
  const { t } = useLocale();
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
  if (!report) return <div className="ctx-line ctx-loading">{t("context.loading", { ticker })}</div>;

  const b = BIAS_KEY[report.bias.bias];
  const flag = callPct != null ? contradictionFlag(flowBias(callPct), report.bias) : null;
  const agree =
    flag?.kind === "confirm" ? { txt: t("context.confirms"), cls: "up" }
    : flag?.kind === "conflict" ? { txt: t("context.conflicts"), cls: "down" }
    : null;

  return (
    <div className={`ctx-line ctx-${b.cls}`}>
      <span className="ctx-icon">📰</span>
      <span className="ctx-text"><b>{t(b.key)}</b> {t("context.about", { ticker })}</span>
      {agree && <span className={`ctx-flag ${agree.cls}`}>{agree.txt}</span>}
    </div>
  );
}
