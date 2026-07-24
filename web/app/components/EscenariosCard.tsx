"use client";

import type { ProPrediction, Scenario } from "@/lib/prediction";
import { px } from "../format";

const META = {
  bear: { label: "Bajista", cls: "bear", icon: "🔻" },
  base: { label: "Base (lo más probable)", cls: "base", icon: "🎯" },
  bull: { label: "Alcista", cls: "bull", icon: "🔺" },
} as const;

function Card({ kind, s }: { kind: "bear" | "base" | "bull"; s: Scenario }) {
  const m = META[kind];
  return (
    <div className={`esc-card ${m.cls}`}>
      <div className="esc-head">{m.icon} {m.label}</div>
      <div className="esc-target">${px.format(s.target)}</div>
      <div className="esc-chg">{s.changePct >= 0 ? "+" : ""}{s.changePct.toFixed(1)}%</div>
      <div className="esc-prob">{Math.round(s.probability * 100)}% de tocarlo</div>
      <div className="esc-driver">{s.driver}</div>
    </div>
  );
}

/**
 * Los 3 escenarios de la acción para la vista Estudiante: bajista / base / alcista.
 * Todo sale de `ProPrediction` (ya calculado). Si es ilíquido, no se muestra.
 */
export default function EscenariosCard({ prediction }: { prediction: ProPrediction | null }) {
  if (!prediction || prediction.caveat) return null;
  return (
    <section className="card">
      <div>
        <div className="card-title">Los 3 caminos posibles</div>
        <div className="card-sub">
          Ningún precio es seguro. Estos son los tres escenarios que el agente ve, con qué tan
          probable es llegar a cada uno en el horizonte elegido.
        </div>
      </div>
      <div className="esc-grid">
        <Card kind="bear" s={prediction.bear} />
        <Card kind="base" s={prediction.base} />
        <Card kind="bull" s={prediction.bull} />
      </div>
    </section>
  );
}
