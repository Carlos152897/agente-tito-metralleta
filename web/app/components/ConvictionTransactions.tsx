"use client";

import { useMemo, useState } from "react";
import { EXECUTION_LABEL, executionLevel, spreadPct, type FlowRow } from "@/lib/flow";
import RepeatBadge, { buildRepeatCounts, repeatKey } from "./RepeatBadge";
import { dateOf, int, money, px, timeOf } from "../format";

export interface ConvictionMeta {
  window: string;
  minPremium: number;
  total: number;
  shown: number;
  expiredCount: number;
  vigenteCount: number;
  saved: { total: number; added: number; firstSeen: string | null } | null;
}

const STATUS_LABEL: Record<FlowRow["expiryStatus"], string> = {
  expirado: "Expirado",
  expira_hoy: "Expira hoy",
  vigente: "Vigente",
  desconocido: "—",
};

function contractLabel(r: FlowRow): string {
  const t = r.type === "call" ? "C" : r.type === "put" ? "P" : "?";
  return `${r.underlying} ${r.strike != null ? px.format(r.strike) : "?"}${t}`;
}

type Filter = "todas" | "vigente" | "expirado";

export default function ConvictionTransactions({
  rows,
  meta,
}: {
  rows: FlowRow[];
  meta: ConvictionMeta;
}) {
  const [filter, setFilter] = useState<Filter>("todas");
  const repeatCounts = useMemo(() => buildRepeatCounts(rows), [rows]);

  const shown = useMemo(() => {
    if (filter === "todas") return rows;
    if (filter === "vigente") return rows.filter((r) => r.expiryStatus !== "expirado");
    return rows.filter((r) => r.expiryStatus === "expirado");
  }, [rows, filter]);

  return (
    <div className="clusters">
      <div className="clusters-title">
        📒 Transacciones revisadas · últimos {meta.window}
        <span className="muted">
          {" "}— {int.format(meta.total)} trades ≥ {money.format(meta.minPremium)}
          {meta.shown < meta.total ? `, mostrando ${meta.shown}` : ""}
          {meta.saved && (
            <> · guardadas <b>{int.format(meta.saved.total)}</b>
              {meta.saved.added > 0 && <> (+{int.format(meta.saved.added)} nuevas)</>}</>
          )}
        </span>
      </div>

      <div className="tf-toggle" style={{ marginBottom: 10 }}>
        <button type="button" className={`tf-btn ${filter === "todas" ? "on" : ""}`} onClick={() => setFilter("todas")}>
          Todas ({int.format(rows.length)})
        </button>
        <button type="button" className={`tf-btn ${filter === "vigente" ? "on" : ""}`} onClick={() => setFilter("vigente")}>
          Vigentes ({int.format(meta.vigenteCount)})
        </button>
        <button type="button" className={`tf-btn ${filter === "expirado" ? "on" : ""}`} onClick={() => setFilter("expirado")}>
          Expirados ({int.format(meta.expiredCount)})
        </button>
      </div>

      <div className="tablewrap tall">
        <table>
          <thead>
            <tr>
              <th className="left">Fecha · Hora</th>
              <th className="left">Contrato</th>
              <th className="left">Vencimiento</th>
              <th>Estado</th>
              <th>Lado</th>
              <th>Ejecución</th>
              <th>Spread</th>
              <th>Contratos</th>
              <th>Dinero</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const sp = spreadPct(r.bid, r.ask);
              const level = executionLevel(r.price, r.bid, r.ask, r.side);
              const wide = sp != null && sp > 10;
              return (
                <tr key={r.id} className={r.expiryStatus === "expirado" ? "expired-row" : undefined}>
                  <td className="left">{dateOf(r.timestamp)} · {timeOf(r.timestamp)}</td>
                  <td className="left">
                    {contractLabel(r)}
                    {r.flags.repeated && <RepeatBadge count={repeatCounts.get(repeatKey(r)) ?? 2} />}
                  </td>
                  <td className="left">
                    {r.expiration ?? "—"}
                    {r.dte != null && (
                      <span className="muted"> ({r.dte >= 0 ? `${r.dte}d` : `hace ${Math.abs(r.dte)}d`})</span>
                    )}
                  </td>
                  <td>
                    <span className={`pill st-${r.expiryStatus}`}>{STATUS_LABEL[r.expiryStatus]}</span>
                  </td>
                  <td>
                    <span className={`pill ${r.aggression === "ask" ? "agg-ask" : r.aggression === "bid" ? "agg-bid" : "agg-mid"}`}>
                      {r.aggression === "ask" ? "▲ Compra" : r.aggression === "bid" ? "▼ Venta" : "Mid"}
                    </span>
                  </td>
                  <td className="muted">{EXECUTION_LABEL[level]}</td>
                  <td className={wide ? "sp-wide" : undefined}>
                    {sp != null ? `${sp.toFixed(1)}%` : "—"}{wide ? " ⚠" : ""}
                  </td>
                  <td>{int.format(r.size)}</td>
                  <td>{money.format(r.premium)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="pxsrc" style={{ marginTop: 8 }}>
        <b>Estado</b> compara el vencimiento del contrato con la fecha de hoy: las filas grises ya
        <b> expiraron</b> (útil para ver si la apuesta llegó a su fin) y las <b>vigentes</b> siguen abiertas.
        Todas quedan <b>guardadas</b> en el historial local del agente.
        {meta.saved?.firstSeen && <> Historial desde {dateOf(meta.saved.firstSeen)}.</>}
      </p>
    </div>
  );
}
