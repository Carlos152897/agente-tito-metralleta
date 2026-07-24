"use client";

import type { LevelsReport } from "@/lib/levels";
import { probTouch } from "@/lib/expectedMove";
import { px } from "../format";

/**
 * Lista mínima de soportes y resistencias para la vista Estudiante.
 * Fusiona ambos, ordena por cercanía al precio y añade la probabilidad de que el
 * precio LLEGUE a cada nivel dentro del horizonte (probTouch, lognormal). Sin jerga.
 */
export default function NivelesSimples({
  levels,
  iv,
  horizonDays,
}: {
  levels: LevelsReport;
  iv: number;
  horizonDays: number;
}) {
  const spot = levels.spot;
  const rows = [...levels.supports, ...levels.resistances]
    .filter((l) => l.strength >= 20)
    .map((l) => ({
      ...l,
      touch: spot > 0 ? probTouch(spot, l.price, iv, horizonDays) : 0,
    }))
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
    .slice(0, 6);

  if (rows.length === 0) {
    return (
      <section className="card">
        <div className="card-title">Precios clave</div>
        <div className="card-sub">Todavía no hay soportes ni resistencias claros para este ticker.</div>
      </section>
    );
  }

  return (
    <section className="card">
      <div>
        <div className="card-title">Precios clave — ¿hasta dónde puede llegar?</div>
        <div className="card-sub">
          Zonas donde el precio suele frenar. La probabilidad es qué tan factible es que lo
          <b> toque</b> en las próximas ~{horizonDays === 10 ? "1 semana" : horizonDays === 20 ? "2 semanas" : "4 semanas"}.
        </div>
      </div>

      <div className="niveles">
        <div className="niveles-head">
          <span>Precio</span><span>Tipo</span><span>Distancia</span><span>Probabilidad</span>
        </div>
        {rows.map((l) => {
          const isSup = l.kind === "soporte";
          const prob = Math.round(l.touch * 100);
          return (
            <div key={`${l.kind}-${l.price}`} className="niveles-row">
              <span className="niveles-price">${px.format(l.price)}</span>
              <span className={`niveles-tag ${isSup ? "sup" : "res"}`}>
                {isSup ? "🟢 Soporte" : "🔴 Resistencia"}
                {l.flipped && <span className="niveles-flip" title="Antes hacía de lo contrario"> ⤾</span>}
              </span>
              <span className="niveles-dist">
                {l.distancePct >= 0 ? "+" : ""}{l.distancePct.toFixed(1)}%
              </span>
              <span className="niveles-prob">
                <span className="niveles-bar" style={{ width: `${Math.min(100, prob)}%` }} />
                <span className="niveles-pct">{prob}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
