"use client";

// Tabla de candidatos de Venta de Primas — las 10 columnas exactas del prompt
// de Carlos, en el orden que pidió. Puede haber varias filas por ticker (un
// spread por cada strike corta razonable, igual que WheelTable) — el orden
// por defecto es VE/$, NUNCA crédito absoluto (un crédito grande sobre un
// colateral enorme es peor negocio que uno pequeño sobre poco colateral).

import type { CreditSpreadCandidate } from "@/lib/creditSpreads";
import { contractsThatFit, type CreditSpreadBudgets } from "@/lib/creditSpreads";

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const money2 = (n: number) => `$${n.toFixed(2)}`;

/** Trunca hacia abajo — nunca redondea el POP hacia arriba (regla explícita del prompt). */
function popPct(pop: number): string {
  return `${(Math.floor(pop * 1000) / 10).toFixed(1)}%`;
}
function evPerDollarPct(x: number): string {
  const v = Math.floor(x * 10000) / 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

const PREMIUM_LABEL: Record<string, string> = { cara: "CARA", normal: "NORMAL", barata: "BARATA" };

export default function VentaPrimasTable({
  rows,
  budgets,
}: {
  rows: CreditSpreadCandidate[];
  budgets: CreditSpreadBudgets;
}) {
  if (rows.length === 0) {
    return <div className="card wheel-empty">Sin candidatos con este POP mínimo. Prueba una pestaña más baja.</div>;
  }

  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th className="left">TICKER</th>
            <th className="left">ESTRUCTURA</th>
            <th className="left">VENCE</th>
            <th>CRÉDITO</th>
            <th>COLATERAL</th>
            <th>POP</th>
            <th className="left">PRIMA</th>
            <th>VE</th>
            <th>VE / $</th>
            <th>CABEN</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const caben = contractsThatFit(budgets.maxCapitalPerTrade, c.collateral);
            const structureLabel = c.structure === "put_credit"
              ? "Put credit spread (ALCISTA)"
              : "Call credit spread (BAJISTA)";
            return (
              <tr key={`${c.ticker}-${c.shortStrike}-${c.expiration}-${c.structure}`}>
                <td className="left">
                  <b>{c.ticker}</b>
                  {c.earningsWithin && (
                    <span className="pill vp-earnings-badge" title="Reporte de resultados antes del vencimiento">
                      REPORTE DENTRO
                    </span>
                  )}
                </td>
                <td className="left">
                  <span className={`pill ${c.structure === "put_credit" ? "call" : "put"}`}>
                    {structureLabel}
                  </span>
                  <div className="muted vp-strikes">
                    vende ${c.shortStrike} / compra ${c.longStrike}
                  </div>
                </td>
                <td className="left">
                  {c.expiration}
                  <span className="muted"> ({c.dte}D)</span>
                </td>
                <td>
                  {money2(c.credit)}
                  {c.creditSource === "estimado" && (
                    <div className="muted vp-strikes" title="Massive no trae bid/ask real para este contrato hoy: estimado desde el último precio con un recorte del 10%.">
                      estimado
                    </div>
                  )}
                </td>
                <td>{money(c.collateral)}</td>
                <td>{popPct(c.pop)}</td>
                <td className="left">
                  <span className={`pill vp-premium-${c.premium.label}`}>{PREMIUM_LABEL[c.premium.label]}</span>
                  {c.premium.percentile != null && (
                    <span className="muted"> pctl {Math.round(c.premium.percentile)}</span>
                  )}
                </td>
                <td className={c.ev >= 0 ? "vp-pos" : "vp-neg"}>{money2(c.ev)}</td>
                <td className={c.evPerDollarCollateral >= 0 ? "vp-pos" : "vp-neg"}>
                  {evPerDollarPct(c.evPerDollarCollateral)}
                </td>
                <td>{caben}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
