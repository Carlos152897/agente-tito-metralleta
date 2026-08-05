import type { BacktestTrade } from "@/lib/backtest";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const money2 = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const EXIT_LABEL: Record<BacktestTrade["exitReason"], string> = {
  take_profit: "🎯 take profit",
  stop_loss: "🛑 stop loss",
  close: "🔔 cierre",
  flow_reversal: "🌊 flujo se volteó",
  trailing_stop: "📈 trailing stop",
};

export default function BacktestTradeLog({ trades }: { trades: BacktestTrade[] }) {
  if (trades.length === 0) {
    return <div className="card wheel-empty">El backtest no encontró señal suficiente para abrir ninguna operación en este período.</div>;
  }

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11, textTransform: "uppercase" }}>
            <th style={{ padding: "6px 8px" }}>Fecha</th>
            <th style={{ padding: "6px 8px" }}>Contrato</th>
            <th style={{ padding: "6px 8px" }}>DTE</th>
            <th style={{ padding: "6px 8px" }}>Entrada</th>
            <th style={{ padding: "6px 8px" }}>Salida</th>
            <th style={{ padding: "6px 8px" }}>Motivo</th>
            <th style={{ padding: "6px 8px" }}>Contratos</th>
            <th style={{ padding: "6px 8px" }}>P&amp;L</th>
            <th style={{ padding: "6px 8px" }}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={`${t.date}-${t.strike}-${t.expiration}`} style={{ borderTop: "1px solid var(--border-soft)" }}>
              <td style={{ padding: "6px 8px" }}>{t.date}</td>
              <td style={{ padding: "6px 8px" }}>
                <span className={`wheel-tag ${t.direction === "call" ? "" : "warn"}`}>{t.direction.toUpperCase()}</span>{" "}
                ${t.strike} · vence {t.expiration}
              </td>
              <td style={{ padding: "6px 8px" }}>{t.dte}d</td>
              <td style={{ padding: "6px 8px" }}>{money2(t.entryPrice)}</td>
              <td style={{ padding: "6px 8px" }}>{money2(t.exitPrice)}</td>
              <td style={{ padding: "6px 8px" }}>
                {EXIT_LABEL[t.exitReason]}
                {t.triggerSymbol && (
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>vía {t.triggerSymbol}</div>
                )}
              </td>
              <td style={{ padding: "6px 8px" }}>{t.contracts}</td>
              <td style={{ padding: "6px 8px", fontWeight: 700, color: t.pnl >= 0 ? "#12b76a" : "#f04438" }}>
                {money(t.pnl)} <small style={{ fontWeight: 400 }}>({pct(t.pnlPct)})</small>
              </td>
              <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>{money(t.balanceAfter)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
