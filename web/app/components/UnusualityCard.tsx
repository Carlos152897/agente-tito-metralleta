"use client";

import { useMemo, useState } from "react";
import { UNUSUAL_TRADE_THRESHOLD, type FlowRow, type UnusualScores } from "@/lib/flow";
import RepeatBadge, { buildRepeatCounts, repeatKey } from "./RepeatBadge";
import { dateOf, int, money, px, timeOf } from "../format";

export interface UnusualRow extends FlowRow {
  unusualScores: UnusualScores;
  confirmedByAggression: boolean;
}

export interface UnusualityMeta {
  score: number;
  avgByParam: { size: number; delta: number; theta: number; gamma: number; leg: number; expiry: number };
  unusualCount: number;
  n: number;
  confirmedCount: number;
}

const PARAMS: { key: keyof UnusualityMeta["avgByParam"]; label: string; hint: string }[] = [
  { key: "size", label: "Tamaño", hint: "$ de la orden" },
  { key: "delta", label: "Delta", hint: "qué tan direccional" },
  { key: "theta", label: "Theta", hint: "decaimiento diario" },
  { key: "gamma", label: "Gamma", hint: "zona institucional" },
  { key: "leg", label: "Condición", hint: "single vs multileg" },
  { key: "expiry", label: "Vencimiento", hint: "plazo del contrato" },
];

function contractLabel(r: FlowRow): string {
  const t = r.type === "call" ? "C" : r.type === "put" ? "P" : "?";
  return `${r.underlying} ${r.strike != null ? px.format(r.strike) : "?"}${t}`;
}

export default function UnusualityCard({ meta, rows }: { meta: UnusualityMeta; rows: UnusualRow[] }) {
  const [soloInusuales, setSoloInusuales] = useState(true);
  const repeatCounts = useMemo(() => buildRepeatCounts(rows), [rows]);

  const shown = useMemo(
    () => (soloInusuales ? rows.filter((r) => r.unusualScores.total >= UNUSUAL_TRADE_THRESHOLD) : rows),
    [rows, soloInusuales],
  );

  const cls = meta.score >= 7 ? "up" : meta.score <= 3 ? "down" : "neutral";
  const verdict =
    meta.n === 0 ? "Sin datos"
      : meta.score >= 8 ? "Flujo muy anormal"
        : meta.score >= 6 ? "Flujo anormal"
          : meta.score >= 4 ? "Algo fuera de lo común"
            : "Flujo normal";

  return (
    <>
      <section className="scorecard cv-card">
        <div className="score-main">
          <div className="score-cat">Inusualidad</div>
          <div className={`score-num ${cls}`}>{meta.score}<span className="score-den">/10</span></div>
          <div className="score-q">¿Es flujo anormal?</div>
        </div>

        <div className="score-detail">
          <div className={`score-verdict ${cls}`}>{verdict}</div>

          <div className="cv-metrics">
            {PARAMS.map((p) => (
              <div key={p.key} className="cv-metric">
                <div className="cv-metric-label">{p.label}</div>
                <div className="cv-metric-value">{meta.avgByParam[p.key].toFixed(1)}<span className="muted" style={{ fontSize: 13 }}>/10</span></div>
                <div className="cv-metric-hint muted">{p.hint}</div>
              </div>
            ))}
          </div>

          <div className="split-legend">
            <span><b>{int.format(meta.unusualCount)}</b> transacciones inusuales (≥{UNUSUAL_TRADE_THRESHOLD}/10)</span>
            <span className="muted">de {int.format(meta.n)} revisadas en 30 días</span>
            {meta.confirmedCount > 0 && (
              <span className="cv-confirm">✓ {int.format(meta.confirmedCount)} confirmadas por el agente de Agresividad</span>
            )}
          </div>
        </div>
      </section>

      {rows.length > 0 && (
        <div className="clusters">
          <div className="clusters-title">
            🔬 Transacciones inusuales
            <span className="muted"> — puntuadas por griegos: tamaño · delta · theta · gamma · condición · vencimiento</span>
          </div>

          <div className="tf-toggle" style={{ marginBottom: 10 }}>
            <button type="button" className={`tf-btn ${soloInusuales ? "on" : ""}`} onClick={() => setSoloInusuales(true)}>
              Solo inusuales ({int.format(meta.unusualCount)})
            </button>
            <button type="button" className={`tf-btn ${!soloInusuales ? "on" : ""}`} onClick={() => setSoloInusuales(false)}>
              Todas ({int.format(rows.length)})
            </button>
          </div>

          <div className="tablewrap tall">
            <table>
              <thead>
                <tr>
                  <th className="left">Fecha · Hora</th>
                  <th className="left">Contrato</th>
                  <th className="left">Vencimiento</th>
                  <th>Dinero</th>
                  <th>Delta</th>
                  <th>Theta/día</th>
                  <th>Gamma</th>
                  <th className="left">Condición</th>
                  <th>Tam</th><th>Δ</th><th>Θ</th><th>Γ</th><th>Leg</th><th>Venc</th>
                  <th>Inusual</th>
                  <th className="left">Validación</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const s = r.unusualScores;
                  return (
                    <tr key={r.id} className={s.total >= UNUSUAL_TRADE_THRESHOLD ? "unusual" : undefined}>
                      <td className="left">{dateOf(r.timestamp)} · {timeOf(r.timestamp)}</td>
                      <td className="left">
                        {contractLabel(r)}
                        {r.flags.repeated && <RepeatBadge count={repeatCounts.get(repeatKey(r)) ?? 2} />}
                      </td>
                      <td className="left">
                        {r.expiration ?? "—"}
                        {r.dte != null && <span className="muted"> ({r.dte}d)</span>}
                      </td>
                      <td>{money.format(r.premium)}</td>
                      <td>{r.delta.toFixed(2)}</td>
                      <td>{r.thetaPctDaily != null ? `${r.thetaPctDaily.toFixed(2)}%` : "—"}</td>
                      <td>{r.gamma.toFixed(4)}</td>
                      <td className="left" title={r.conditionName ?? ""}>
                        {r.conditionCode ?? "—"}
                        <span className={r.flags.multileg ? "leg-multi" : "leg-single"}>
                          {" "}{r.flags.multileg ? "multi" : "single"}
                        </span>
                      </td>
                      <td className="muted">{s.size}</td>
                      <td className="muted">{s.delta}</td>
                      <td className="muted">{s.theta}</td>
                      <td className="muted">{s.gamma}</td>
                      <td className="muted">{s.leg}</td>
                      <td className="muted">{s.expiry}</td>
                      <td><b>{s.total.toFixed(1)}</b><span className="muted">/10</span></td>
                      <td className="left">
                        {r.confirmedByAggression
                          ? <span className="chip chip-ask">✓ también en Agresividad</span>
                          : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="pxsrc" style={{ marginTop: 8 }}>
            Cada trade se puntúa en 6 parámetros (columnas <b>Tam · Δ · Θ · Γ · Leg · Venc</b>) y el promedio
            da su puntaje <b>Inusual</b>. Las filas amarillas superan {UNUSUAL_TRADE_THRESHOLD}/10 — perfil institucional.
            La columna <b>Validación</b> cruza con lo que reporta el agente de Agresividad; es una verificación
            aparte y <b>no altera el puntaje</b>.
          </p>
        </div>
      )}
    </>
  );
}
