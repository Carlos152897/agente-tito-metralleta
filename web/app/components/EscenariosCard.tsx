"use client";

import type { ProPrediction, Scenario } from "@/lib/prediction";
import { useLocale, type LocaleCtx } from "@/lib/i18n";
import { px } from "../format";

const META = {
  bear: { key: "scenarios.bear", cls: "bear", icon: "🔻" },
  base: { key: "scenarios.base", cls: "base", icon: "🎯" },
  bull: { key: "scenarios.bull", cls: "bull", icon: "🔺" },
} as const;

function Card({ kind, s, t }: { kind: "bear" | "base" | "bull"; s: Scenario; t: LocaleCtx["t"] }) {
  const m = META[kind];
  return (
    <div className={`esc-card ${m.cls}`}>
      <div className="esc-head">{m.icon} {t(m.key)}</div>
      <div className="esc-target">${px.format(s.target)}</div>
      <div className="esc-chg">{s.changePct >= 0 ? "+" : ""}{s.changePct.toFixed(1)}%</div>
      <div className="esc-prob">{t("scenarios.touchChance", { pct: Math.round(s.probability * 100) })}</div>
      <div className="esc-driver">{s.driver}</div>
    </div>
  );
}

/**
 * Los 3 escenarios de la acción para la vista Estudiante: bajista / base / alcista.
 * Todo sale de `ProPrediction` (ya calculado). Si es ilíquido, no se muestra.
 */
export default function EscenariosCard({ prediction }: { prediction: ProPrediction | null }) {
  const { t } = useLocale();
  if (!prediction || prediction.caveat) return null;
  return (
    <section className="card">
      <div>
        <div className="card-title">{t("scenarios.title")}</div>
        <div className="card-sub">{t("scenarios.sub")}</div>
      </div>
      <div className="esc-grid">
        <Card kind="bear" s={prediction.bear} t={t} />
        <Card kind="base" s={prediction.base} t={t} />
        <Card kind="bull" s={prediction.bull} t={t} />
      </div>
    </section>
  );
}
