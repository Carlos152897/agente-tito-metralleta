"use client";

import type { AggressionScore } from "@/lib/flow";
import { int, money } from "../format";

export default function AggressionScoreCard({ score }: { score: AggressionScore }) {
  const denom = score.premiumAsk + score.premiumBid;
  const pctAsk = denom > 0 ? (100 * score.premiumAsk) / denom : 0;
  const label =
    denom === 0
      ? "Sin flujo agresivo"
      : score.ratio >= 0.66
        ? "Compra agresiva (al ask)"
        : score.ratio <= 0.34
          ? "Presión al bid"
          : "Mixto";
  const cls = score.ratio >= 0.66 ? "up" : score.ratio <= 0.34 ? "down" : "neutral";
  return (
    <section className="scorecard">
      <div className="score-main">
        <div className="score-cat">Agresividad</div>
        <div className={`score-num ${cls}`}>
          {score.score}
          <span className="score-den">/10</span>
        </div>
        <div className="score-q">¿Compran al ask con fuerza?</div>
      </div>
      <div className="score-detail">
        <div className={`score-verdict ${cls}`}>{label}</div>
        <div className="split-bar">
          <div className="split-ask" style={{ width: `${pctAsk}%` }} />
          <div className="split-bid" style={{ width: `${100 - pctAsk}%` }} />
        </div>
        <div className="split-legend">
          <span><span className="dot-ask" /> Ask {money.format(score.premiumAsk)}</span>
          <span><span className="dot-bid" /> Bid {money.format(score.premiumBid)}</span>
          <span className="muted">Mid {money.format(score.premiumMid)} (descartado)</span>
          <span className="muted">· {int.format(score.n)} notables</span>
        </div>
      </div>
    </section>
  );
}
