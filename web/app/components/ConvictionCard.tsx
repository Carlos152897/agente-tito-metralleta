"use client";

import { EXECUTION_LABEL, spreadPct, type ConvictionScore, type ExecutionLevel, type FlowRow } from "@/lib/flow";
import { int, money, px } from "../format";

const STATUS_LABEL: Record<FlowRow["expiryStatus"], string> = {
  expirado: "Expirado",
  expira_hoy: "Expira hoy",
  vigente: "Vigente",
  desconocido: "—",
};

const ASK = "#3fd07a";
const BID = "#ff6b6b";

/** Orden de más a menos agresivo, para la barra de niveles de ejecución. */
const LEVEL_ORDER: ExecutionLevel[] = ["above_ask", "below_bid", "at_ask", "at_bid", "near", "mid", "unclear"];
const LEVEL_COLOR: Record<ExecutionLevel, string> = {
  above_ask: "#3fd07a", below_bid: "#ff6b6b",
  at_ask: "#2f9e63", at_bid: "#c9524f",
  near: "#ffb020", mid: "#5b6675", unclear: "#3a4048",
};

function Metric({ label, value, points, hint }: { label: string; value: string; points: number; hint: string }) {
  return (
    <div className="cv-metric">
      <div className="cv-metric-label">{label}</div>
      <div className="cv-metric-value">{value}</div>
      <div className="cv-metric-pts">{points}<span className="muted">/10</span></div>
      <div className="cv-metric-hint muted">{hint}</div>
    </div>
  );
}

export default function ConvictionCard({ conviction }: { conviction: ConvictionScore }) {
  const { score, spread, dominance, execution, n } = conviction;
  const domSide = dominance.side === "ask" ? "compra" : "venta";
  const domColor = dominance.side === "ask" ? ASK : BID;

  const cls = score >= 7 ? "up" : score <= 3 ? "down" : "neutral";
  const verdict =
    n === 0 ? "Sin datos"
      : score >= 8 ? "Convicción muy alta"
        : score >= 6 ? "Convicción alta"
          : score >= 4 ? "Convicción media"
            : "Convicción baja";

  const totalLevels = LEVEL_ORDER.reduce((s, l) => s + execution.counts[l], 0);

  return (
    <section className="scorecard cv-card">
      <div className="score-main">
        <div className="score-cat">Convicción</div>
        <div className={`score-num ${cls}`}>{score}<span className="score-den">/10</span></div>
        <div className="score-q">¿Cuánto dinero real entró?</div>
      </div>

      <div className="score-detail">
        <div className={`score-verdict ${cls}`}>{verdict}</div>

        <div className="cv-metrics">
          <Metric
            label="Spread"
            value={spread.avgPct != null ? `${spread.avgPct.toFixed(2)}%` : "—"}
            points={spread.points}
            hint={spread.avgPct == null ? "sin quotes" : spread.avgPct < 2 ? "muy líquido" : spread.avgPct <= 5 ? "aceptable" : "ancho"}
          />
          <Metric
            label={`Dominancia ${domSide}`}
            value={`${dominance.dominantPct.toFixed(0)}%`}
            points={dominance.points}
            hint={`${dominance.askPct.toFixed(0)}% compra · ${dominance.bidPct.toFixed(0)}% venta`}
          />
          <Metric
            label="Fuerza de ejecución"
            value={execution.avgRaw.toFixed(1)}
            points={execution.points}
            hint="qué tan agresivas fueron las órdenes"
          />
        </div>

        {totalLevels > 0 && (
          <>
            <div className="cv-bar">
              {LEVEL_ORDER.filter((l) => execution.counts[l] > 0).map((l) => (
                <div
                  key={l}
                  className="cv-bar-seg"
                  style={{ width: `${(100 * execution.counts[l]) / totalLevels}%`, background: LEVEL_COLOR[l] }}
                  title={`${EXECUTION_LABEL[l]}: ${execution.counts[l]} trades`}
                />
              ))}
            </div>
            <div className="cv-legend muted">
              {LEVEL_ORDER.filter((l) => execution.counts[l] > 0).map((l) => (
                <span key={l}>
                  <span className="cv-dot" style={{ background: LEVEL_COLOR[l] }} />
                  {EXECUTION_LABEL[l]} <b>{execution.counts[l]}</b>
                </span>
              ))}
              <span className="muted">· {int.format(n)} trades</span>
            </div>
          </>
        )}

        {spread.wideCount > 0 && (
          <div className="cv-alert">
            <div className="cv-alert-head">
              ⚠ {spread.wideCount} trade{spread.wideCount > 1 ? "s" : ""} con spread &gt; 10%
              <span className="cv-alert-sub"> — apartados del promedio, revisar a fondo</span>
            </div>
            {spread.wideAlert.length > 0 && (
              <div className="cv-alert-list">
                {spread.wideAlert.slice(0, 3).map((r) => {
                  const sp = spreadPct(r.bid, r.ask);
                  return (
                    <div key={r.id} className="cv-alert-item">
                      <div className="cv-alert-row1">
                        <b className="cv-alert-contract">
                          {r.underlying} {r.strike != null ? px.format(r.strike) : "?"}{r.type === "call" ? "C" : "P"}
                        </b>
                        <span className={`pill st-${r.expiryStatus}`}>{STATUS_LABEL[r.expiryStatus]}</span>
                        <span className="cv-alert-money">{money.format(r.premium)}</span>
                      </div>
                      <div className="cv-alert-row2">
                        Vence <b>{r.expiration ?? "—"}</b>
                        {r.dte != null && <> ({r.dte >= 0 ? `en ${r.dte}d` : `hace ${Math.abs(r.dte)}d`})</>}
                        {" · "}bid {px.format(r.bid)} / ask {px.format(r.ask)}
                        {sp != null && <> · spread <b>{sp.toFixed(1)}%</b></>}
                      </div>
                    </div>
                  );
                })}
                {spread.wideAlert.length > 3 && <div className="muted">+{spread.wideAlert.length - 3} más…</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
