"use client";

import type { FlowRow } from "@/lib/flow";
import { dateOf, int, money, px, timeOf } from "../format";

function contractLabel(r: FlowRow): string {
  const t = r.type === "call" ? "C" : r.type === "put" ? "P" : "?";
  return `${r.underlying} ${r.strike != null ? px.format(r.strike) : "?"}${t}`;
}

function sideLabel(r: FlowRow): { text: string; cls: string } {
  if (r.aggression === "ask") return { text: "▲ Compra", cls: "agg-ask" };
  if (r.aggression === "bid") return { text: "▼ Venta", cls: "agg-bid" };
  if (r.aggression === "mid") return { text: "Mid", cls: "agg-mid" };
  return { text: r.side, cls: "agg-unknown" };
}

function Flags({ r }: { r: FlowRow }) {
  const chips: { k: string; label: string; cls: string; tip: string }[] = [];
  if (r.flags.big) chips.push({ k: "big", label: "$1M+", cls: "chip-hot", tip: "Trade de más de $1 millón" });
  if (r.flags.convDelta) chips.push({ k: "cd", label: "Delta fuerte", cls: "chip-hot", tip: "Más de $100K con delta mayor a 0.60 (apuesta direccional)" });
  if (r.flags.exceededOI) chips.push({ k: "eoi", label: "Vol > OI", cls: "chip-hot", tip: "El volumen de hoy supera el interés abierto: posiciones nuevas" });
  if (r.flags.leap) chips.push({ k: "leap", label: "LEAP", cls: "chip-neutral", tip: "Vencimiento largo (90+ días)" });
  if (r.flags.repeated) chips.push({ k: "rep", label: "repetido", cls: "chip-neutral", tip: "El mismo contrato se operó varias veces en 5 minutos" });
  if (r.flags.multileg) chips.push({ k: "ml", label: "multileg", cls: "chip-neutral", tip: `Condición OPRA de estrategia combinada${r.conditionCode ? ` (${r.conditionCode})` : ""}` });
  if (r.flags.simultaneous) chips.push({ k: "sim", label: "simultáneo", cls: "chip-neutral", tip: "Otros contratos del mismo subyacente se ejecutaron a la misma hora" });
  return (
    <span className="chips">
      {chips.map((c) => <span key={c.k} className={`chip ${c.cls}`} title={c.tip}>{c.label}</span>)}
    </span>
  );
}

const HEADERS = ["Fecha", "Hora", "Contrato", "Vencimiento", "Lado", "Precio", "Contratos", "Dinero", "Delta", "Puntos", "Señales"];

export default function NotableTable({ rows }: { rows: FlowRow[] }) {
  return (
    <>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>{HEADERS.map((h) => <th key={h} className={h === "Contrato" || h === "Señales" || h === "Vencimiento" ? "left" : ""}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sc = r.scores ?? { volume: 0, timing: 0, repetition: 0, total: 0 };
              const lado = sideLabel(r);
              const desglose = `Volumen ${sc.volume}/10 · Horario ${sc.timing}/10 · Repetición ${sc.repetition}/10`;
              return (
                <tr key={r.id} className={r.unusual ? "unusual" : undefined}>
                  <td>{dateOf(r.timestamp)}</td>
                  <td>{timeOf(r.timestamp)}</td>
                  <td className="left">{contractLabel(r)}</td>
                  <td className="left">
                    {r.expiration ?? "—"}
                    {r.dte != null && <span className="muted"> ({r.dte}d)</span>}
                  </td>
                  <td><span className={`pill ${lado.cls}`}>{lado.text}</span></td>
                  <td>{px.format(r.price)}</td>
                  <td>{int.format(r.size)}</td>
                  <td>{money.format(r.premium)}</td>
                  <td>{r.delta.toFixed(2)}</td>
                  <td title={desglose}><b>{sc.total}</b><span className="muted">/30</span></td>
                  <td className="left"><Flags r={r} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="pxsrc" style={{ marginTop: 8 }}>
        <b>Puntos</b> = tamaño de la orden + momento del día + cuántas veces se repite el contrato (máximo 30;
        pasa el cursor sobre el número para ver el desglose). Las <span style={{ background: "#3a3210", padding: "1px 6px", borderRadius: 4 }}>filas amarillas</span> son
        trades con puntaje inusual. <b>Lado</b>: ▲ Compra = pagaron el precio del vendedor (agresivo) · ▼ Venta = aceptaron el precio del comprador.
      </p>
    </>
  );
}
