"use client";

/**
 * Loader de análisis para la vista Estudiante (y Pro).
 *
 * El backend emite ~40-100 pasos técnicos ("Descargando página 3", "Revisando flujo
 * página 5"…) de DOS streams en paralelo, que cambian a toda velocidad y se ven como un
 * glitch. Para el usuario los colapsamos en **4 fases claras y ordenadas** con una barra
 * que avanza SUAVE. No leemos el texto de cada paso — solo cuántos han llegado — así el
 * progreso solo sube y nunca parpadea ni retrocede.
 */

const PHASES = [
  "Conectando con el mercado",
  "Leyendo el flujo de opciones",
  "Descargando la cadena de opciones",
  "Calculando escenarios y niveles",
];

export default function AnalysisLoader({
  ticker,
  steps,
}: {
  ticker: string | null;
  steps: string[];
}) {
  // Progreso suave y siempre creciente: curva asintótica sobre el nº de pasos recibidos.
  // Con cada paso avanza un poco (sensación fluida) sin depender de un total exacto que
  // varía por ticker. Se topa en 97% hasta que el análisis termina y el loader se oculta.
  const progress = Math.min(0.97, 1 - Math.exp(-steps.length / 16));
  const phase =
    progress < 0.30 ? 0 : progress < 0.60 ? 1 : progress < 0.85 ? 2 : 3;
  const pct = Math.round(progress * 100);

  return (
    <section className="loader card">
      <div className="loader-steps">
        {PHASES.map((label, i) => (
          <div
            key={i}
            className={`loader-node ${i < phase ? "done" : i === phase ? "active" : "pending"}`}
          >
            <span className="loader-num">{i < phase ? "✓" : i + 1}</span>
            <span className="loader-node-label">{label}</span>
          </div>
        ))}
      </div>

      <div className="loader-progress">
        <div className="loader-track">
          <div className="loader-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="loader-pct">{pct}%</div>
      </div>

      <div className="loader-current" key={phase}>
        Analizando {ticker ?? "el ticker"} — {PHASES[phase]}…
      </div>
    </section>
  );
}
