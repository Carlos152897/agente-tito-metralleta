"use client";

import type { AggressionScore, ConvictionScore } from "@/lib/flow";

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
  const categories: Category[] = [
    { key: "agr", name: "Agresividad", weight: 20, question: "¿Compran al ask con fuerza?", score: aggression?.score ?? null },
    { key: "con", name: "Convicción", weight: 20, question: "¿Cuánto dinero real entró?", score: conviction?.score ?? null },
    { key: "inu", name: "Inusualidad", weight: 20, question: "¿Es flujo anormal?", score: unusuality?.score ?? null },
    { key: "est", name: "Estructura", weight: 15, question: "¿Strike/DTE de convicción o lotería?", score: structure?.score ?? null },
    { key: "iv", name: "Contexto IV", weight: 10, question: "¿IV limpia o inflada?", score: ivContext?.score ?? null },
    { key: "cnf", name: "Confirmación de Precio", weight: 15, question: "¿El precio valida o absorbe?", score: validation?.score ?? null },
  ];

  const active = categories.filter((c) => c.score != null);
  const activePts = active.reduce((s, c) => s + (weighted(c) ?? 0), 0);
  const activeWeight = active.reduce((s, c) => s + c.weight, 0);

  return (
    <section className="scpanel">
      <div className="scpanel-head">
        <h2>Options Flow Scorecard</h2>
        <div className="scpanel-total">
          {active.length === categories.length ? (
            <>Total <b>{Math.round(activePts)}</b> / 100</>
          ) : (
            <span className="muted">
              — / 100 · <b>{active.length}/{categories.length}</b> categorías activas
              {active.length > 0 && <> · {Math.round(activePts)}/{activeWeight} pts activos</>}
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
                  <span className="sccat-pts">→ {pts!.toFixed(1)}/{c.weight} pts</span>
                </div>
              ) : (
                <div className="sccat-score pending">— <span className="sccat-den">pendiente</span></div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
