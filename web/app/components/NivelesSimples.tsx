"use client";

import type { LevelsReport } from "@/lib/levels";
import { probTouch } from "@/lib/expectedMove";
import { useLocale, horizonLabel } from "@/lib/i18n";
import { px } from "../format";

/**
 * Lista mínima de soportes y resistencias para la vista Estudiante.
 * Fusiona ambos, ordena por cercanía al precio y añade la probabilidad de que el
 * precio LLEGUE a cada nivel dentro del horizonte (probTouch, lognormal). Sin jerga.
 */
export default function NivelesSimples({
  levels,
  iv,
  horizonDays,
}: {
  levels: LevelsReport;
  iv: number;
  horizonDays: number;
}) {
  const { t } = useLocale();
  const spot = levels.spot;
  const rows = [...levels.supports, ...levels.resistances]
    .filter((l) => l.strength >= 20)
    .map((l) => ({
      ...l,
      touch: spot > 0 ? probTouch(spot, l.price, iv, horizonDays) : 0,
    }))
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
    .slice(0, 6);

  if (rows.length === 0) {
    return (
      <section className="card">
        <div className="card-title">{t("levels.titleEmpty")}</div>
        <div className="card-sub">{t("levels.subEmpty")}</div>
      </section>
    );
  }

  return (
    <section className="card">
      <div>
        <div className="card-title">{t("levels.title")}</div>
        <div className="card-sub">{t("levels.sub", { horizon: horizonLabel(t, horizonDays) })}</div>
      </div>

      <div className="niveles">
        <div className="niveles-head">
          <span>{t("levels.price")}</span><span>{t("levels.type")}</span><span>{t("levels.distance")}</span><span>{t("levels.probability")}</span>
        </div>
        {rows.map((l) => {
          const isSup = l.kind === "soporte";
          const prob = Math.round(l.touch * 100);
          return (
            <div key={`${l.kind}-${l.price}`} className="niveles-row">
              <span className="niveles-price">${px.format(l.price)}</span>
              <span className={`niveles-tag ${isSup ? "sup" : "res"}`}>
                {isSup ? t("levels.support") : t("levels.resistance")}
                {l.flipped && <span className="niveles-flip" title={t("levels.flipped")}> ⤾</span>}
              </span>
              <span className="niveles-dist">
                {l.distancePct >= 0 ? "+" : ""}{l.distancePct.toFixed(1)}%
              </span>
              <span className="niveles-prob">
                <span className="niveles-bar" style={{ width: `${Math.min(100, prob)}%` }} />
                <span className="niveles-pct">{prob}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
