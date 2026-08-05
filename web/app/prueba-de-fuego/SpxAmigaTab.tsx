"use client";

import { useCallback, useEffect, useState } from "react";
import type { Aggressor, SpxAmigaBoard, StrikeLadderRow } from "@/lib/spxAmiga";

// "SPX amiga" — Agente 0DTE (Carlos, 2026-08-04). JSON plano + poll cada
// minuto, mismo patrón que SpxLevelsCard.tsx (no SSE: /api/spx-amiga son 2
// fetches rápidos en paralelo, sin pasos largos que narrar).
const POLL_MS = 60_000;

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function aggressorLabel(a: Aggressor): string {
  if (a === "compra") return "🟢 compra";
  if (a === "venta") return "🔴 venta";
  return "⚪ mixto";
}

function LadderTable({ title, rows, color }: { title: string; rows: StrikeLadderRow[]; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color }}>{title}</div>
      {rows.length === 0 ? (
        <div className="wheel-empty" style={{ fontSize: 12 }}>Sin datos todavía.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "var(--muted)", fontSize: 11 }}>
              <th style={{ padding: "3px 8px", textAlign: "center" }}>Strike</th>
              <th style={{ padding: "3px 8px", textAlign: "right" }}>Vol.</th>
              <th style={{ padding: "3px 8px", textAlign: "right" }}>OI</th>
              <th style={{ padding: "3px 8px", textAlign: "right" }}>Δ</th>
              <th style={{ padding: "3px 8px", textAlign: "left" }}>Agresor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.strike}>
                <td style={{ padding: "3px 8px", textAlign: "center", fontWeight: 600 }}>{r.strike}</td>
                <td style={{ padding: "3px 8px", textAlign: "right" }}>{r.volume.toLocaleString()}</td>
                <td style={{ padding: "3px 8px", textAlign: "right" }}>{r.openInterest.toLocaleString()}</td>
                <td style={{ padding: "3px 8px", textAlign: "right" }}>{r.delta.toFixed(2)}</td>
                <td style={{ padding: "3px 8px", fontSize: 11 }}>{aggressorLabel(r.aggressor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function SpxAmigaTab() {
  const [data, setData] = useState<SpxAmigaBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    fetch("/api/spx-amiga")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? "Error inesperado.");
        return body as SpxAmigaBoard;
      })
      .then((body) => {
        setData(body);
        setError(null);
      })
      .catch((e: Error) => setError(e.message || "No se pudo armar el tablero de SPX amiga."))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!data && busy) return <div className="card wheel-empty">Cargando…</div>;
  if (!data && error) return <div className="error">⚠ {error}</div>;
  if (!data) return null;

  const { spot, expiration, marketOpen, ladder, gex, fiveMinute, moneyFlow, bestTrade, scenarios, verdict } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>🎯 Agente 0DTE — Análisis de SPX (vencimiento de HOY)</div>
        <div className="wheel-status">
          SPX · {marketOpen ? "🟢 mercado abierto" : "🔴 mercado cerrado"} · vencimiento {expiration}
        </div>
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Precio en vivo</div>
            <div className="stat-value">${spot.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>🪜 Escalera de Strikes — top 10 por volumen</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <LadderTable title="Top 10 Calls" rows={ladder.calls} color="#12b76a" />
          <LadderTable title="Top 10 Puts" rows={ladder.puts} color="#f04438" />
        </div>
      </div>

      <div className="card" style={{ gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>🧲 Gamma del día (GEX)</div>
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Imán</div>
            <div className="stat-value">{gex.magnet != null ? `$${gex.magnet}` : "—"}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Zona de inversión (Flip)</div>
            <div className="stat-value">{gex.flip != null ? `$${gex.flip.toFixed(2)}` : "—"}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Régimen</div>
            <div className="stat-value">
              {gex.regime === "positivo" ? "γ+ (pin)" : gex.regime === "negativo" ? "γ− (amplifica)" : "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>⏱️ Próximos ~5 min</div>
        {fiveMinute ? (
          <>
            <div className="stats">
              <div className="stat">
                <div className="stat-label">Rango ±1σ</div>
                <div className="stat-value">
                  ${fiveMinute.rangeLow.toFixed(2)} – ${fiveMinute.rangeHigh.toFixed(2)}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">CHARM</div>
                <div className="stat-value">{fiveMinute.charm.toFixed(4)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">VANNA</div>
                <div className="stat-value">{fiveMinute.vanna.toFixed(4)}</div>
              </div>
            </div>
            <p className="wheel-disclaimer" style={{ fontSize: 12 }}>{fiveMinute.narrative}</p>
          </>
        ) : (
          <div className="wheel-empty">Mercado cerrado — sin lectura en vivo.</div>
        )}
      </div>

      <div className="card" style={{ gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>🎯 Mejor trade ahora</div>
        {bestTrade == null ? (
          <div className="wheel-empty">Mercado cerrado — sin trade en vivo para sugerir.</div>
        ) : bestTrade.lateral ? (
          <div className="wheel-empty">↔ LATERAL — esperar. {bestTrade.reason}</div>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {bestTrade.type === "call" ? "🟢 COMPRÁ CALL" : "🔴 COMPRÁ PUT"} ${bestTrade.entryStrike}
            </div>
            <div className="stats">
              <div className="stat">
                <div className="stat-label">Entrada</div>
                <div className="stat-value">${bestTrade.entry.toFixed(2)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Stop</div>
                <div className="stat-value">${bestTrade.stopUnderlying.toFixed(2)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">TP1 (toma)</div>
                <div className="stat-value">${bestTrade.tp1Underlying.toFixed(2)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">TP2 (corre)</div>
                <div className="stat-value">
                  {bestTrade.tp2Underlying != null ? `$${bestTrade.tp2Underlying.toFixed(2)}` : "—"}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Riesgo:Beneficio</div>
                <div className="stat-value">1:{bestTrade.riskReward.toFixed(2)}</div>
              </div>
            </div>
            {bestTrade.spread && (
              <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Vertical spread ({bestTrade.spread.type})</div>
                <p className="wheel-disclaimer" style={{ fontSize: 12 }}>
                  Comprá ${bestTrade.spread.longStrike}, vendé ${bestTrade.spread.shortStrike} — costo{" "}
                  {fmtMoney(bestTrade.spread.cost)}, max. ganancia {fmtMoney(bestTrade.spread.maxProfit)}, max.
                  pérdida {fmtMoney(bestTrade.spread.maxLoss)}.
                </p>
              </div>
            )}
            <p className="wheel-disclaimer" style={{ fontSize: 12 }}>{bestTrade.reason}</p>
          </>
        )}
      </div>

      <div className="card" style={{ gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>💵 ¿Dónde está el dinero?</div>
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Premium al ask — Calls</div>
            <div className="stat-value" style={{ color: "#12b76a" }}>{fmtMoney(moneyFlow.callAskPremium)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Premium al ask — Puts</div>
            <div className="stat-value" style={{ color: "#f04438" }}>{fmtMoney(moneyFlow.putAskPremium)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Sesgo</div>
            <div className="stat-value">
              {moneyFlow.bias === "calls" ? "🟢 calls" : moneyFlow.bias === "puts" ? "🔴 puts" : "⚪ parejo"} (
              {moneyFlow.biasPct.toFixed(0)}%)
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>📊 Escenarios hasta el cierre</div>
        {scenarios.length === 0 ? (
          <div className="wheel-empty">Mercado cerrado — sin escenarios en vivo.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--muted)", fontSize: 11 }}>
                <th style={{ padding: "4px 10px", textAlign: "left" }}>Escenario</th>
                <th style={{ padding: "4px 10px", textAlign: "center" }}>Strike de cierre</th>
                <th style={{ padding: "4px 10px", textAlign: "right" }}>Prob. de tocar</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.label}>
                  <td style={{ padding: "4px 10px", textTransform: "capitalize" }}>{s.label}</td>
                  <td style={{ padding: "4px 10px", textAlign: "center", fontWeight: 600 }}>${s.strike}</td>
                  <td style={{ padding: "4px 10px", textAlign: "right" }}>{(s.probTouch * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>✅ Veredicto GEX</div>
        {verdict ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {verdict.verdict === "seguir" ? "✅ SEGUIR el flujo" : "🔁 FADEAR el flujo"}
            </div>
            <p className="wheel-disclaimer" style={{ fontSize: 12 }}>{verdict.reason}</p>
          </>
        ) : (
          <div className="wheel-empty">Sin régimen de GEX definido todavía.</div>
        )}
      </div>

      <button className="rescan" onClick={load} disabled={busy}>
        🔄 Analizar de nuevo
      </button>

      <div className="disclaimer">
        ⚠️ Lectura de flujo y posicionamiento de opciones. NO es consejo de inversión.
      </div>
    </div>
  );
}
