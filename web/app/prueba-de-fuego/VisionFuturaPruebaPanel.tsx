"use client";

// Panel de resumen de la vista "Prueba" (arriba de la escalera). Solo describe lo que muestra el flujo;
// no recomienda entrar ni salir. Motor: lib/visionFuturaPrueba.ts · datos: /api/vision-futura/prueba.

import {
  BUCKET_LABEL, CASES, findConflicts, fmtPrueba, isClosing, SUBAGENT_LABEL,
  type Bucket, type PruebaLadder, type PruebaResponse, type StrikePos, type StructureKind,
} from "@/lib/visionFuturaPrueba";

const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
/** Strikes: TSLA y acciones usan 2.5 / 0.5 — no redondear. */
const sk = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const hhmm = (ms: number, sec = false) =>
  new Date(ms).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", ...(sec ? { second: "2-digit" } : {}), hour12: false });

const LONG = "#12b76a";
const SHORT = "#ef4444";
const TECHO = "#F5C518";
const PISO = "#4FC3F7";

function sumBuckets(list: StrikePos[], keep: Set<number>): Record<Bucket, number> {
  const t = {} as Record<Bucket, number>;
  for (const p of list) {
    if (!keep.has(p.strike)) continue;
    for (const [k, v] of Object.entries(p.buckets) as [Bucket, number][]) t[k] = (t[k] ?? 0) + v;
  }
  return t;
}

export default function VisionFuturaPruebaPanel(props: {
  data: PruebaResponse | null;
  ladder: PruebaLadder | null;
  error: string | null;
  loading: boolean;
  /** Mensaje en lugar del panel (otro instrumento, repetición…). */
  unavailable?: string | null;
  receivedAt: number | null;
  windowName: string;
}) {
  const { data, ladder } = props;
  const box: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--panel-2)", fontSize: 13, display: "flex", flexDirection: "column", gap: 6 };
  if (props.unavailable) return <div style={{ ...box, color: "var(--muted)" }}>{props.unavailable}</div>;
  const cookie = data?.cookieExpired || (props.error ?? "").includes("Cookie de MarketSnack expirada");
  if (!data || !ladder) {
    return (
      <div style={box}>
        {cookie && <div style={{ color: "#fff", background: "#b42318", padding: "6px 10px", borderRadius: 8, fontWeight: 700 }}>Cookie de MarketSnack expirada — actualízala en Ajustes.</div>}
        <span style={{ color: "var(--muted)" }}>{props.error && !cookie ? `No se pudo leer el flujo: ${props.error}` : "Cargando el flujo trade por trade de MarketSnack…"}</span>
      </div>
    );
  }

  // Todo lo del posicionamiento va en la unidad de las barras (contratos o $ de delta).
  const unit = data.unit ?? "delta";
  const usd = (v: number) => fmtPrueba(v, unit);
  const dTag = unit === "delta" ? " Δ" : "";
  const vsLabel = data.cumulative
    ? `el día hasta hace ${data.window === "1D" ? "15 min" : data.window === 60 ? "1 h" : `${data.window} min`}`
    : data.window === "1D" ? "hace 15 min" : "la ventana anterior";
  const view = new Set(ladder.bars.map((b) => b.strike));
  const curB = sumBuckets(data.cur, view);
  const prevB = sumBuckets(data.prev, view);
  const top = [...ladder.bars].sort((a, b) => Math.abs(b.net) - Math.abs(a.net))[0] ?? null;
  const caseRank = CASES.map((k) => ({ k, v: curB[k] ?? 0 })).filter((x) => x.v !== 0).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const subs = (Object.keys(SUBAGENT_LABEL) as Exclude<StructureKind, "suelta">[])
    .map((k) => ({ k, v: data.bySubagent[k] ?? 0, n: data.structures[k] ?? 0 }))
    .filter((x) => x.v !== 0 || x.n > 0)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const totCur = ladder.bars.reduce((a, b) => a + Math.abs(b.net), 0);
  const totPrev = ladder.bars.reduce((a, b) => a + Math.abs(b.prevNet), 0);
  const totChg = totPrev > 0 ? ((totCur - totPrev) / totPrev) * 100 : null;
  const entering = ladder.bars.filter((b) => b.trend === "entrando").length;
  const leaving = ladder.bars.filter((b) => b.trend === "saliendo").length;
  const conflicts = findConflicts(ladder.bars);
  const techo = ladder.techos[0] ?? null;
  const piso = ladder.pisos[0] ?? null;
  const incomplete = data.bounds.prev[0] < data.coveredFrom - 60_000;
  const filling = data.segmentsDone < data.segmentsTotal;
  const marketOpen = data.asOf >= Date.now() - 60_000;
  const quiet = marketOpen && data.lastTradeT != null && Date.now() - data.lastTradeT > 3 * 60_000;
  const trend = (cur: number, prev: number) => {
    const a = Math.abs(cur), p = Math.abs(prev);
    if (a > p * 1.1) return <span style={{ color: "#f5f7fb" }}>▲ entrando</span>;
    if (a < p * 0.9) return <span style={{ color: "var(--faint)" }}>▼ saliendo</span>;
    return <span style={{ color: "var(--muted)" }}>= igual</span>;
  };
  const dist = (m: { distPts: number; distPct: number }) => `${m.distPts >= 0 ? "+" : "−"}${sk(Math.abs(m.distPts))} pts (${Math.abs(m.distPct).toFixed(2)}%)`;
  const head: React.CSSProperties = { fontWeight: 700, color: "var(--text)" };

  return (
    <div style={box}>
      {cookie && <div style={{ color: "#fff", background: "#b42318", padding: "6px 10px", borderRadius: 8, fontWeight: 700 }}>Cookie de MarketSnack expirada — actualízala en Ajustes. Se muestran los últimos datos guardados.</div>}
      <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
        <span>Flujo trade por trade · {data.inst} {data.inst === "SPX" ? "0DTE" : "venc. más próximo"} · {data.date} · trades ≥ ${n0(data.minPremium)} · {n0(data.tradesTotal)} trades del día</span>
        <span>{n0(data.classified)} clasificados en {props.windowName} · {n0(data.unclassified)} al mid (no clasificados)</span>
        <span>Actualizado {props.receivedAt ? hhmm(props.receivedAt, true) : "—"} NY{data.lastTradeT ? ` · último trade ${hhmm(data.lastTradeT, true)}` : ""}</span>
        {filling && <span style={{ color: "var(--amber-text)" }}>Cargando el día: {data.segmentsDone} de {data.segmentsTotal} tramos (completo desde {hhmm(data.coveredFrom)})</span>}
        {!filling && incomplete && <span style={{ color: "var(--amber-text)" }}>Ventana incompleta: hay datos desde {hhmm(data.coveredFrom)}</span>}
        {quiet && <span style={{ color: "var(--amber-text)" }}>Sin trades nuevos desde {hhmm(data.lastTradeT!)}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "8px 18px" }}>
        <div>
          <div style={head}>1. ¿Dónde hay más posicionamiento?</div>
          {top ? (
            <div>
              <b>{sk(top.strike)}</b>: <span style={{ color: top.net >= 0 ? LONG : SHORT, fontWeight: 700 }}>{top.net >= 0 ? "LARGO" : "CORTO"} {usd(top.net)}{dTag}</span>{data.cumulative ? <span style={{ color: "var(--muted)" }}> · acumulado del día</span> : null}
              {top.dominant ? <> · domina <b>{top.dominant}</b></> : null}
            </div>
          ) : <div style={{ color: "var(--muted)" }}>Sin posicionamiento en esta ventana.</div>}
        </div>

        <div>
          <div style={head}>2. ¿Qué están haciendo más?</div>
          {caseRank.length ? caseRank.map((x, i) => (
            <div key={x.k}>{i + 1}. {BUCKET_LABEL[x.k]} <span style={{ color: x.v > 0 ? LONG : SHORT }}>{usd(x.v)}</span>{isClosing(x.k, x.v) && <span style={{ color: "var(--muted)" }}> (pesan más los cierres)</span>}</div>
          )) : <div style={{ color: "var(--muted)" }}>Sin opciones sueltas.</div>}
          {subs.length > 0 && (
            <div style={{ marginTop: 4, color: "var(--muted)" }}>
              <div>Por subagente:</div>
              {subs.map((x) => (
                <div key={x.k}>{SUBAGENT_LABEL[x.k]} <span style={{ color: x.v > 0 ? LONG : x.v < 0 ? SHORT : undefined }}>{usd(x.v)}</span> · {n0(x.n)} spreads</div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={head}>3. ¿Están entrando o saliendo?</div>
          <div>
            Total {totChg == null ? "—" : `${totChg >= 0 ? "+" : ""}${totChg.toFixed(0)}%`} vs {vsLabel} · {trend(totCur, totPrev)} · {entering} strikes ▲ / {leaving} ▼
          </div>
          {CASES.map((k) => (curB[k] || prevB[k]) ? (
            <div key={k} style={{ color: "var(--muted)" }}>{BUCKET_LABEL[k]}: {usd(prevB[k] ?? 0)} → {usd(curB[k] ?? 0)} · {trend(curB[k] ?? 0, prevB[k] ?? 0)}</div>
          ) : null)}
        </div>

        <div>
          <div style={head}>4. Techo, piso e imanes</div>
          <div>Techo clave: {techo ? <b style={{ color: TECHO }}>{sk(techo.strike)}</b> : "—"}{techo ? ` · defensa ${usd(techo.score).replace("+", "")}` : ""}</div>
          <div>Piso clave: {piso ? <b style={{ color: PISO }}>{sk(piso.strike)}</b> : "—"}{piso ? ` · defensa ${usd(piso.score).replace("+", "")}` : ""}</div>
          <div>🧲+ atrae: {ladder.magnetPos ? <><b style={{ color: LONG }}>{sk(ladder.magnetPos.strike)}</b> {dist(ladder.magnetPos)} · {ladder.magnetPos.why}</> : "—"}</div>
          <div>🧲− rechaza: {ladder.magnetNeg ? <><b style={{ color: ladder.magnetNeg.why === "techo clave" ? TECHO : PISO }}>{sk(ladder.magnetNeg.strike)}</b> {dist(ladder.magnetNeg)} · {ladder.magnetNeg.why}</> : "—"}</div>
        </div>

        <div>
          <div style={head}>5. Conflictos</div>
          {conflicts.length ? conflicts.map((c) => (
            <div key={`${c.long}-${c.short}`}>
              {c.long === c.short
                ? <><b>{sk(c.long)}</b>: largo <span style={{ color: LONG }}>{usd(c.longAmt)}</span> y corto <span style={{ color: SHORT }}>{usd(-c.shortAmt)}</span> en el mismo strike</>
                : <>largo <b>{sk(c.long)}</b> <span style={{ color: LONG }}>{usd(c.longAmt)}</span> vs corto <b>{sk(c.short)}</b> <span style={{ color: SHORT }}>{usd(-c.shortAmt)}</span></>}
            </div>
          )) : <div style={{ color: "var(--muted)" }}>Sin largos y cortos grandes juntos.</div>}
        </div>
      </div>
    </div>
  );
}
