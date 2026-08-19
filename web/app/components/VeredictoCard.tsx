"use client";

import type { ProPrediction } from "@/lib/prediction";
import { useLocale, horizonLabel, type LocaleCtx } from "@/lib/i18n";
import { px } from "../format";

/** Confianza 0-100 → etiqueta llana. */
function confLabel(c: number, t: LocaleCtx["t"]): { text: string; cls: string } {
  if (c >= 66) return { text: t("verdict.confHigh"), cls: "alta" };
  if (c >= 33) return { text: t("verdict.confMed"), cls: "media" };
  return { text: t("verdict.confLow"), cls: "baja" };
}

const DIR_KEY = {
  up: { icon: "📈", key: "verdict.up", cls: "up" },
  down: { icon: "📉", key: "verdict.down", cls: "down" },
  flat: { icon: "➡️", key: "verdict.flat", cls: "flat" },
} as const;

/**
 * Veredicto en lenguaje llano para la vista Estudiante.
 * Todo sale de `ProPrediction` (ya calculado): dirección, target base, confianza y
 * el resumen en prosa. Si la cadena es ilíquida, muestra el aviso en vez de la lectura.
 */
export default function VeredictoCard({
  ticker,
  prediction,
  horizonDays,
}: {
  ticker: string;
  prediction: ProPrediction | null;
  horizonDays: number;
}) {
  const { t } = useLocale();

  if (!prediction) {
    return (
      <section className="verdict">
        <div className="verdict-loading">{t("verdict.loading", { ticker })}</div>
      </section>
    );
  }

  // Salvaguarda de liquidez — regla prioritaria: no dar dirección si no es fiable.
  if (prediction.caveat) {
    return (
      <section className="verdict verdict-warn">
        <div className="verdict-icon">⚠</div>
        <div>
          <div className="verdict-word">{t("verdict.unreliable")}</div>
          <div className="verdict-sub">{prediction.caveat}</div>
        </div>
      </section>
    );
  }

  const d = DIR_KEY[prediction.direction];
  const conf = confLabel(prediction.confidence, t);
  const target = prediction.base.target;
  const chg = prediction.base.changePct;
  const shiftSign = prediction.calibration.shiftPct >= 0 ? "+" : "";
  const shiftPct = prediction.calibration.shiftPct.toFixed(1);

  return (
    <section className={`verdict verdict-${d.cls}`}>
      <div className="verdict-icon">{d.icon}</div>
      <div className="verdict-body">
        <div className="verdict-word">
          {t(d.key)} {t("verdict.toward")} <span className="verdict-target">${px.format(target)}</span>
          <span className="verdict-chg">
            {chg >= 0 ? "+" : ""}{chg.toFixed(1)}%
          </span>
        </div>
        <div className="verdict-line">
          <span className={`verdict-conf ${conf.cls}`}>{conf.text}</span>
          <span className="verdict-horizon">{t("verdict.over", { horizon: horizonLabel(t, horizonDays) })}</span>
          {prediction.calibration.applied && (
            <span
              className="verdict-cal"
              title={t("verdict.adjustedTitle", {
                dir: prediction.calibration.shiftPct >= 0 ? t("verdict.dirLow") : t("verdict.dirHigh"),
                sign: shiftSign,
                pct: shiftPct,
                samples: prediction.calibration.samples,
              })}
            >
              {t("verdict.adjusted", { sign: shiftSign, pct: shiftPct })}
            </span>
          )}
        </div>
        <div className="verdict-sub">{prediction.summary}</div>
      </div>
    </section>
  );
}
