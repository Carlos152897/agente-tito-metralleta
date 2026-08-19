"use client";

import type { AggressionScore, ConvictionScore } from "@/lib/flow";
import { useLocale } from "@/lib/i18n";

interface Category {
  key: string;
  name: string;
  weight: number; // %
  question: string;
  score: number | null; // 0-10, null = pendiente
}

/** Puntaje ponderado de una categoría: (score/10) × peso. */
function weighted(cat: Category): number | null {
  return cat.score == null ? null : (cat.score / 10) * cat.weight;
}

export default function ScorecardPanel({
  aggression,
  conviction,
  unusuality,
  structure,
  ivContext,
  validation,
}: {
  aggression: AggressionScore | null;
  conviction?: ConvictionScore | null;
  unusuality?: { score: number } | null;
  structure?: { score: number } | null;
  ivContext?: { score: number } | null;
  validation?: { score: number } | null;
}) {
  const { t } = useLocale();
  const categories: Category[] = [
    { key: "agr", name: t("categories.agrName"), weight: 20, question: t("categories.agrQ"), score: aggression?.score ?? null },
    { key: "con", name: t("categories.conName"), weight: 20, question: t("categories.conQ"), score: conviction?.score ?? null },
    { key: "inu", name: t("categories.inuName"), weight: 20, question: t("categories.inuQ"), score: unusuality?.score ?? null },
    { key: "est", name: t("categories.estName"), weight: 15, question: t("categories.estQ"), score: structure?.score ?? null },
    { key: "iv", name: t("categories.ivName"), weight: 10, question: t("categories.ivQ"), score: ivContext?.score ?? null },
    { key: "cnf", name: t("categories.cnfName"), weight: 15, question: t("categories.cnfQ"), score: validation?.score ?? null },
  ];

  const active = categories.filter((c) => c.score != null);
  const activePts = active.reduce((s, c) => s + (weighted(c) ?? 0), 0);
  const activeWeight = active.reduce((s, c) => s + c.weight, 0);

  return (
    <section className="scpanel">
      <div className="scpanel-head">
        <h2>{t("scorecard.title")}</h2>
        <div className="scpanel-total">
          {active.length === categories.length ? (
            <>{t("scorecard.totalOf", { n: Math.round(activePts) })}</>
          ) : (
            <span className="muted">
              — / 100 · <b>{t("scorecard.activeCategories", { active: active.length, total: categories.length })}</b>
              {active.length > 0 && <>{t("scorecard.activePts", { pts: Math.round(activePts), weight: activeWeight })}</>}
            </span>
          )}
        </div>
      </div>
      <div className="scgrid">
        {categories.map((c) => {
          const pts = weighted(c);
          const on = c.score != null;
          return (
            <div key={c.key} className={`sccat ${on ? "on" : "off"}`}>
              <div className="sccat-name">{c.name} <span className="sccat-w">{c.weight}%</span></div>
              <div className="sccat-q">{c.question}</div>
              {on ? (
                <div className="sccat-score">
                  {c.score}<span className="sccat-den">/10</span>
                  <span className="sccat-pts">{t("scorecard.ptsOf", { pts: pts!.toFixed(1), weight: c.weight })}</span>
                </div>
              ) : (
                <div className="sccat-score pending">— <span className="sccat-den">{t("scorecard.pending")}</span></div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
