"use client";

import type { ChainSnapshot } from "@/lib/chainStore";
import type { StructureScore } from "@/lib/structure";
import { int, money, px } from "../format";

const CALL = "#3fd07a";
const PUT = "#ff6b6b";

export default function StructureCard({ s, history = [] }: { s: StructureScore; history?: ChainSnapshot[] }) {
  const cls = s.score >= 7 ? "up" : s.score <= 3 ? "down" : "neutral";
  const verdict =
    s.notional.strikeCount === 0 ? "Sin datos"
      : s.score >= 8 ? "Posicionamiento muy claro"
        : s.score >= 6 ? "Posicionamiento claro"
          : s.score >= 4 ? "Posicionamiento moderado"
            : "Posicionamiento difuso";

  const sideColor = s.strikes.dominantSide === "calls" ? CALL : PUT;

  return (
    <>
      <section className="scorecard cv-card">
        <div className="score-main">
          <div className="score-cat">Estructura</div>
          <div className={`score-num ${cls}`}>{s.score}<span className="score-den">/10</span></div>
          <div className="score-q">¿Dónde se acumula el posicionamiento?</div>
        </div>

        <div className="score-detail">
          <div className={`score-verdict ${cls}`}>{verdict}</div>

          <div className="cv-metrics">
            <div className="cv-metric">
              <div className="cv-metric-label">Nocional promedio</div>
              <div className="cv-metric-value">{money.format(s.notional.avgPerStrike)}</div>
              <div className="cv-metric-pts">{s.notional.points}<span className="muted">/10</span></div>
              <div className="cv-metric-hint muted">por strike · {int.format(s.notional.strikeCount)} strikes</div>
            </div>
            <div className="cv-metric">
              <div className="cv-metric-label">Strikes con dominio</div>
              <div className="cv-metric-value">
                {s.strikes.dominantCount}<span className="muted" style={{ fontSize: 14 }}>/{s.strikes.consideredCount}</span>
              </div>
              <div className="cv-metric-pts">{s.strikes.points}<span className="muted">/10</span></div>
              <div className="cv-metric-hint muted">domina calls o puts (≥60%)</div>
            </div>
            <div className="cv-metric">
              <div className="cv-metric-label">Volumen &gt; Open Interest</div>
              <div className="cv-metric-value">{s.volOI.pct.toFixed(0)}%</div>
              <div className="cv-metric-pts">{s.volOI.points}<span className="muted">/10</span></div>
              <div className="cv-metric-hint muted">{int.format(s.volOI.exceeded)} de {int.format(s.volOI.considered)} contratos</div>
            </div>
          </div>

          <div className="split-bar">
            <div className="split-ask" style={{ width: `${s.strikes.callPct}%` }} />
            <div className="split-bid" style={{ width: `${s.strikes.putPct}%` }} />
          </div>
          <div className="split-legend">
            <span><span className="dot-ask" /> Calls {s.strikes.callPct.toFixed(0)}%</span>
            <span><span className="dot-bid" /> Puts {s.strikes.putPct.toFixed(0)}%</span>
            <span style={{ color: sideColor, fontWeight: 600 }}>
              Dominan los {s.strikes.dominantSide === "calls" ? "CALLS" : "PUTS"}
            </span>
            <span className="muted">· nocional total {money.format(s.notional.total)}</span>
          </div>

          {s.notional.lowLiquidity && (
            <div className="cv-alert">
              <div className="cv-alert-head">
                ⚠ Baja Liquidez
                <span className="cv-alert-sub"> — el nocional promedio por strike no llega a $25M</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {s.strikes.top.length > 0 && (
        <div className="clusters">
          <div className="clusters-title">
            🎯 Dónde se acumula — strikes y vencimientos
            <span className="muted"> — nocional = strike × open interest × 100</span>
          </div>

          <div className="struct-grid">
            <div>
              <div className="struct-sub">Top strikes por nocional</div>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Strike</th><th>Nocional</th><th>% del total</th>
                      <th>Lado</th><th>Dominio</th><th>Open Interest</th><th>Volumen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.strikes.top.map((t, i) => (
                      <tr key={t.strike} className={i < s.strikes.consideredCount && t.dominant ? "unusual" : undefined}>
                        <td><b>{px.format(t.strike)}</b></td>
                        <td>{money.format(t.notional)}</td>
                        <td>{t.pctOfTotal.toFixed(1)}%</td>
                        <td>
                          <span className={`pill ${t.side === "calls" ? "agg-ask" : "agg-bid"}`}>
                            {t.side === "calls" ? "CALLS" : "PUTS"}
                          </span>
                        </td>
                        <td className={t.dominant ? "mv-ok" : "muted"}>
                          {(t.dominancePct ?? 0).toFixed(0)}%{t.dominant ? " ✓" : ""}
                        </td>
                        <td>{int.format(t.openInterest)}</td>
                        <td>{int.format(t.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="struct-sub">Vencimientos más relevantes</div>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th className="left">Vencimiento</th><th>Nocional</th>
                      <th>% del total</th><th>Contratos</th><th>Sesgo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.expirations.map((e) => {
                      const calls = e.notional > 0 ? (e.callNotional / e.notional) * 100 : 0;
                      return (
                        <tr key={e.expiration}>
                          <td className="left">{e.expiration}</td>
                          <td>{money.format(e.notional)}</td>
                          <td>{e.pctOfTotal.toFixed(1)}%</td>
                          <td>{int.format(e.contracts)}</td>
                          <td>
                            <span className={`pill ${calls >= 50 ? "agg-ask" : "agg-bid"}`}>
                              {calls >= 50 ? `${calls.toFixed(0)}% calls` : `${(100 - calls).toFixed(0)}% puts`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <p className="pxsrc" style={{ marginTop: 8 }}>
            <b>Dominio</b> = qué % del nocional de ese strike está en el lado mayoritario; con ≥60% se
            considera que <b>domina</b> (✓). Las filas amarillas son los strikes con dominio dentro de
            los {s.strikes.consideredCount} de mayor nocional — esos son los que puntúan. El <b>sesgo</b>
            indica si en ese vencimiento pesan más los calls o los puts.
          </p>

          <div className="struct-sub" style={{ marginTop: 16 }}>
            📅 Historial diario ({history.length} {history.length === 1 ? "día" : "días"} de 45)
          </div>
          {history.length <= 1 ? (
            <p className="pxsrc">
              La cadena de opciones es una <b>foto del momento</b> — no existe serie histórica de open
              interest para reconstruir hacia atrás. Desde hoy se guarda una foto por día de mercado y
              el historial se irá acumulando hasta los 45 días que pide el análisis.
            </p>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th className="left">Día</th><th>Score</th><th>Nocional prom.</th>
                    <th>Strikes c/dominio</th><th>Vol &gt; OI</th><th>Calls / Puts</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => {
                    const prev = history[i + 1];
                    const delta = prev ? h.score - prev.score : null;
                    return (
                      <tr key={h.date}>
                        <td className="left">{h.date}{i === 0 && <span className="muted"> (hoy)</span>}</td>
                        <td>
                          <b>{h.score}</b><span className="muted">/10</span>
                          {delta != null && delta !== 0 && (
                            <span className={delta > 0 ? "mv-ok" : "mv-bad"}> {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</span>
                          )}
                        </td>
                        <td>{money.format(h.avgNotionalPerStrike)}</td>
                        <td>{h.dominantCount}</td>
                        <td>{h.volOIPct.toFixed(0)}%</td>
                        <td>
                          <span className={h.dominantSide === "calls" ? "mv-ok" : "mv-bad"}>
                            {h.callPct.toFixed(0)}% / {h.putPct.toFixed(0)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
