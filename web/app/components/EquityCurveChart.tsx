// Curva de balance del backtest — SVG propio y minimalista, sin dependencias
// (mismo espíritu que lib/chartGeometry.ts, pero mucho más simple: solo una polilínea).

const WIDTH = 720;
const HEIGHT = 220;
const PAD = 32;

export default function EquityCurveChart({
  points,
  startingBalance,
}: {
  points: { date: string; balance: number }[];
  startingBalance: number;
}) {
  if (points.length === 0) {
    return <div className="card wheel-empty">Sin operaciones para graficar.</div>;
  }

  const values = [startingBalance, ...points.map((p) => p.balance)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);

  const innerW = WIDTH - PAD * 2;
  const innerH = HEIGHT - PAD * 2;

  const xAt = (i: number) => PAD + (i / Math.max(points.length - 1, 1)) * innerW;
  const yAt = (v: number) => PAD + innerH - ((v - min) / span) * innerH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.balance).toFixed(1)}`).join(" ");
  const zeroY = yAt(startingBalance);
  const last = points[points.length - 1];
  const up = last.balance >= startingBalance;

  return (
    <div className="card">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label="Curva de balance del backtest">
        <line x1={PAD} y1={zeroY} x2={WIDTH - PAD} y2={zeroY} stroke="var(--border-soft)" strokeDasharray="4 4" />
        <text x={PAD} y={zeroY - 6} fontSize="11" fill="var(--muted)">
          balance inicial ${startingBalance.toLocaleString("en-US")}
        </text>
        <path d={path} fill="none" stroke={up ? "#12b76a" : "#f04438"} strokeWidth={2} />
        <circle cx={xAt(points.length - 1)} cy={yAt(last.balance)} r={4} fill={up ? "#12b76a" : "#f04438"} />
        <text x={WIDTH - PAD} y={yAt(last.balance) - 10} fontSize="12" fontWeight={700} textAnchor="end" fill={up ? "#12b76a" : "#f04438"}>
          ${last.balance.toFixed(0)}
        </text>
        <text x={PAD} y={HEIGHT - 8} fontSize="10" fill="var(--muted)">{points[0].date}</text>
        <text x={WIDTH - PAD} y={HEIGHT - 8} fontSize="10" fill="var(--muted)" textAnchor="end">{last.date}</text>
      </svg>
    </div>
  );
}
