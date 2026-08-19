"use client";

import type { AggressionScore } from "@/lib/flow";
import { useLocale } from "@/lib/i18n";
import { int, money } from "../format";

export default function AggressionScoreCard({ score }: { score: AggressionScore }) {
  const { t } = useLocale();
  const denom = score.premiumAsk + score.premiumBid;
  const pctAsk = denom > 0 ? (100 * score.premiumAsk) / denom : 0;
  const label =
    denom === 0
      ? t("aggression.noFlow")
      : score.ratio >= 0.66
        ? t("aggression.buyAsk")
        : score.ratio <= 0.34
          ? t("aggression.sellPressure")
          : t("aggression.mixed");
  const cls = score.ratio >= 0.66 ? "up" : score.ratio <= 0.34 ? "down" : "neutral";
  return (
    <section className="scorecard">
      <div className="score-main">
        <div className="score-cat">{t("aggression.title")}</div>
        <div className={`score-num ${cls}`}>
          {score.score}
          <span className="score-den">/10</span>
        </div>
        <div className="score-q">{t("aggression.q")}</div>
      </div>
      <div className="score-detail">
        <div className={`score-verdict ${cls}`}>{label}</div>
        <div className="split-bar">
          <div className="split-ask" style={{ width: `${pctAsk}%` }} />
          <div className="split-bid" style={{ width: `${100 - pctAsk}%` }} />
        </div>
        <div className="split-legend">
          <span><span className="dot-ask" /> {t("aggression.ask")} {money.format(score.premiumAsk)}</span>
          <span><span className="dot-bid" /> {t("aggression.bid")} {money.format(score.premiumBid)}</span>
          <span className="muted">{t("aggression.midDiscarded", { v: money.format(score.premiumMid) })}</span>
          <span className="muted">· {t("aggression.notable", { n: int.format(score.n) })}</span>
        </div>
      </div>
    </section>
  );
}
