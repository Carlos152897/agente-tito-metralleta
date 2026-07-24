"use client";

import type { ProPrediction } from "@/lib/prediction";
import { px } from "../format";

/** Confianza 0-100 → etiqueta llana. */
function confLabel(c: number): { text: string; cls: string } {
  if (c >= 66) return { text: "confianza alta", cls: "alta" };
  if (c >= 33) return { text: "confianza media", cls: "media" };
  return { text: "confianza baja", cls: "baja" };
}

const DIR = {
  up: { icon: "📈", word: "Probablemente SUBE", cls: "up" },
  down: { icon: "📉", word: "Probablemente BAJA", cls: "down" },
  flat: { icon: "➡️", word: "Se mueve LATERAL", cls: "flat" },
} as const;

/**
 * Veredicto en lenguaje llano para la vista Estudiante.
 * Todo sale de `ProPrediction` (ya calculado): dirección, target base, confianza y
 * el resumen en prosa. Si la cadena es ilíquida, muestra el aviso en vez de la lectura.
 */
export default function VeredictoCard({
  ticker,
  prediction,
  horizonDays,
}: {
  ticker: string;
  prediction: ProPrediction | null;
  horizonDays: number;
}) {
  if (!prediction) {
    return (
      <section className="verdict">
        <div className="verdict-loading">Armando la lectura de {ticker}…</div>
      </section>
    );
  }

  // Salvaguarda de liquidez — regla prioritaria: no dar dirección si no es fiable.
  if (prediction.caveat) {
    return (
      <section className="verdict verdict-warn">
        <div className="verdict-icon">⚠</div>
        <div>
          <div className="verdict-word">Datos no fiables — no operar</div>
          <div className="verdict-sub">{prediction.caveat}</div>
        </div>
      </section>
    );
  }

  const d = DIR[prediction.direction];
  const conf = confLabel(prediction.confidence);
  const target = prediction.base.target;
  const chg = prediction.base.changePct;

  return (
    <section className={`verdict verdict-${d.cls}`}>
      <div className="verdict-icon">{d.icon}</div>
      <div className="verdict-body">
        <div className="verdict-word">
          {d.word} hacia <span className="verdict-target">${px.format(target)}</span>
          <span className="verdict-chg">
            {chg >= 0 ? "+" : ""}{chg.toFixed(1)}%
          </span>
        </div>
        <div className="verdict-line">
          <span className={`verdict-conf ${conf.cls}`}>{conf.text}</span>
          <span className="verdict-horizon">· en las próximas ~{horizonDays === 10 ? "1 semana" : horizonDays === 20 ? "2 semanas" : "4 semanas"}</span>
        </div>
        <div className="verdict-sub">{prediction.summary}</div>
      </div>
    </section>
  );
}
