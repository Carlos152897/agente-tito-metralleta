"use client";

import type { ValidationScore } from "@/lib/validation";
import { BACKTEST_TARGET_DAYS } from "@/lib/validation";
import { int, money, px } from "../format";
import { dateET } from "../format";

const OK = "#12b76a";
const BAD = "#f04438";

function expLabel(expiration: string | null): string {
  return expiration ?? "—";
}

/**
 * Sub-agente 6 — Validación de Flows / Confirmación de Precio.
 * Backtest: para cada flow guardado mide cuánto tardó el precio en desarrollarse
 * a favor y en contra del contrato.
 */
export default function ValidationCard({ s }: { s: ValidationScore }) {
  const cls = s.score >= 7 ? "up" : s.score <= 3 ? "down" : "neutral";
  const hr = s.hitRate.value;

  return (
    <>
      <section className="scorecard cv-card">
        <div className="score-main">
          <div className="score-cat">Confirmación de Precio</div>
          <div className={`score-num ${cls}`}>{s.score}<span className="score-den">/10</span></div>
          <div className="score-q">¿El precio valida o absorbe?</div>
        </div>

        <div className="score-detail">
          <div className={`score-verdict ${cls}`}>{s.verdict}</div>

          <div className="cv-metrics">
            <div className="cv-metric">
              <div className="cv-metric-label">Tasa de validación</div>
              <div className="cv-metric-value" style={{ color: hr != null && hr >= 55 ? OK : hr != null && hr < 45 ? BAD : undefined }}>
                {hr != null ? `${hr.toFixed(1)}%` : "—"}
              </div>
              <div className="cv-metric-pts">{s.hitRate.points}<span className="muted">/10</span></div>
              <div className="cv-metric-hint muted">
                {s.hitRate.validated} de {s.hitRate.resolved} flows juzgados
                {s.weightedHitRate != null && ` · ${s.weightedHitRate.toFixed(0)}% ponderado por dinero`}
              </div>
            </div>

            <div className="cv-metric">
              <div className="cv-metric-label">Velocidad del movimiento</div>
              <div className="cv-metric-value">
                {s.speed.medianSessions != null ? `${s.speed.medianSessions} ses` : "—"}
              </div>
              <div className="cv-metric-pts">{s.speed.points}<span className="muted">/10</span></div>
              <div className="cv-metric-hint muted">{s.speed.band}</div>
            </div>

            <div className="cv-metric">
              <div className="cv-metric-label">Recorrido medio</div>
              <div className="cv-metric-value">
                <span style={{ color: OK }}>+{s.avgMfe?.toFixed(1) ?? "—"}%</span>
                <span className="muted" style={{ fontSize: 14 }}> / </span>
                <span style={{ color: BAD }}>−{s.avgMae?.toFixed(1) ?? "—"}%</span>
              </div>
              <div className="cv-metric-hint muted">a favor / en contra del contrato</div>
            </div>
          </div>

          <div className="val-dirs">
            {s.byDirection.map((d) => (
              <div key={d.direction} className="val-dir">
                <span className={`pill ${d.direction === "alcista" ? "call" : "put"}`}>
                  {d.direction.toUpperCase()}
                </span>
                <b>{d.hitRate != null ? `${d.hitRate.toFixed(0)}%` : "—"}</b>
                <span className="muted">{d.validated}/{d.total} confirmados</span>
              </div>
            ))}
          </div>

          <div className="iv-note">
            Un flow cuenta como <b>validado</b> si el precio se movió a favor del contrato{" "}
            <b>{s.thresholdPct.toFixed(1)}%</b> antes de irse en contra. Ese umbral se adapta a
            la volatilidad del ticker: un 2% fijo sería ruido en una acción que recorre 5% al día.
          </div>

          {s.coverage.belowTarget && (
            <div className="iv-special">
              ⚠ <b>El documento pide al menos {BACKTEST_TARGET_DAYS} días de backtest</b> y hoy
              hay <b>{s.coverage.days}</b>. El historial se acumula hacia adelante en cada
              búsqueda ({int.format(s.coverage.flows)} flows guardados
              {s.coverage.pending > 0 && `, ${int.format(s.coverage.pending)} aún sin juzgar`}).
              Tómalo como preliminar hasta llegar a {BACKTEST_TARGET_DAYS} días.
            </div>
          )}
        </div>
      </section>

      {s.outcomes.length > 0 && (
        <div className="clusters">
          <h2 className="clusters-title">
            Qué pasó después de cada flow
            <span className="muted"> — cuánto tardó el movimiento en desarrollarse</span>
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha del flow</th>
                  <th>Contrato</th>
                  <th>Apuesta</th>
                  <th className="num">Premium</th>
                  <th className="num">A favor</th>
                  <th className="num">En contra</th>
                  <th className="num">Tardó</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {s.outcomes.slice(0, 25).map((o) => (
                  <tr key={o.id}>
                    <td>
                      {dateET(o.timestamp)}
                      <span className="muted"> ({o.daysElapsed}d atrás)</span>
                    </td>
                    <td>
                      <b>${o.strike != null ? px.format(o.strike) : "?"}</b>{" "}
                      <span className={`pill ${o.type === "call" ? "call" : "put"}`}>
                        {o.type === "call" ? "CALL" : "PUT"}
                      </span>
                      <div className="muted" style={{ fontSize: 11 }}>vence {expLabel(o.expiration)}</div>
                    </td>
                    <td>
                      <span className={`pill ${o.direction === "alcista" ? "call" : "put"}`}>
                        {o.direction.toUpperCase()}
                      </span>
                    </td>
                    <td className="num">{money.format(o.premium)}</td>
                    <td className="num" style={{ color: OK }}>+{o.mfePct.toFixed(1)}%</td>
                    <td className="num" style={{ color: BAD }}>−{o.maePct.toFixed(1)}%</td>
                    <td className="num">
                      {o.daysToValidate != null ? `${o.daysToValidate} ses` : "—"}
                    </td>
                    <td>
                      {!o.resolved ? (
                        <span className="val-tag pending">Muy reciente</span>
                      ) : o.validated ? (
                        <span className="val-tag ok">Validado</span>
                      ) : (
                        <span className="val-tag bad">Absorbido</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
