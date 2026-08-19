"use client";

import { useEffect, useState } from "react";
import type { PredictionEval, PredictionReview } from "@/lib/predictionStore";
import { useLocale, type LocaleCtx, type Locale } from "@/lib/i18n";
import { px } from "../format";

type Review = PredictionReview & { total: number };

function fmtDate(d: string, locale: Locale): string {
  try {
    return new Date(`${d}T12:00:00Z`).toLocaleDateString(locale === "en" ? "en-US" : "es", { month: "short", day: "numeric" });
  } catch { return d; }
}

const BEST_KEY = { bear: "memory.bear", base: "memory.base", bull: "memory.bull" } as const;

function Row({ e, t, locale }: { e: PredictionEval; t: LocaleCtx["t"]; locale: Locale }) {
  const err = e.baseErrorPct;
  return (
    <div className="mem-row">
      <span className="mem-date">{fmtDate(e.date, locale)}</span>
      <span className="mem-pred">${px.format(e.base)}</span>
      <span className="mem-actual">
        {e.actualClose != null ? `$${px.format(e.actualClose)}` : "—"}
        {!e.matured && <span className="mem-pending"> {t("memory.inProgress")}</span>}
      </span>
      <span className={`mem-err ${err == null ? "" : Math.abs(err) <= 3 ? "good" : Math.abs(err) <= 7 ? "mid" : "bad"}`}>
        {err == null ? "—" : `${err >= 0 ? "+" : ""}${err.toFixed(1)}%`}
      </span>
      <span className="mem-best">
        {e.matured && e.best ? t("memory.hit", { label: t(BEST_KEY[e.best]) }) : ""}
      </span>
    </div>
  );
}

/**
 * Memoria del agente (vista Estudiante). Muestra cómo le fue a las predicciones pasadas
 * contra el precio real: error del target base, si tocó el nivel y si acertó la dirección.
 * Se acumula hacia adelante — al principio dirá que aún está juntando historial.
 */
export default function MemoriaCard({ ticker }: { ticker: string }) {
  const { t, locale } = useLocale();
  const [r, setR] = useState<Review | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setR(null); setFailed(false);
    // Respiro para que el POST de guardado de esta sesión llegue antes que el GET
    // (si no, la primera vez que se ve un ticker aún no está persistida la foto de hoy).
    const timer = setTimeout(() => {
      fetch(`/api/prediction?ticker=${encodeURIComponent(ticker)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("mem"))))
        .then((d: Review) => { if (!cancelled) setR(d); })
        .catch(() => { if (!cancelled) setFailed(true); });
    }, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ticker]);

  if (failed) return null;

  return (
    <section className="card">
      <div>
        <div className="card-title">{t("memory.title")}</div>
        <div className="card-sub">{t("memory.sub")}</div>
      </div>

      {!r && <div className="feed-empty">{t("memory.loading", { ticker })}</div>}

      {r && r.maturedCount === 0 && (
        <div className="mem-empty">
          {t("memory.emptyLead", { ticker })}
          {r.total > 0
            ? t("memory.emptySaved", { total: r.total, plural: r.total === 1 ? "" : "s" })
            : t("memory.emptyPeriod")}
          {t("memory.emptyTail")}
        </div>
      )}

      {r && r.maturedCount > 0 && (
        <>
          <div className="mem-stats">
            <div className="mem-stat">
              <div className="mem-stat-label">{t("memory.avgError")}</div>
              <div className="mem-stat-value">±{r.meanAbsErrorPct?.toFixed(1)}%</div>
              <div className="mem-stat-sub">{t("memory.avgErrorSub", { n: r.maturedCount, plural: r.maturedCount === 1 ? "" : "s" })}</div>
            </div>
            <div className="mem-stat">
              <div className="mem-stat-label">{t("memory.dirAccuracy")}</div>
              <div className="mem-stat-value">{r.directionHitRate?.toFixed(0)}%</div>
              <div className="mem-stat-sub">{t("memory.dirAccuracySub")}</div>
            </div>
            <div className="mem-stat">
              <div className="mem-stat-label">{t("memory.touchedBase")}</div>
              <div className="mem-stat-value">{r.baseTouchRate?.toFixed(0)}%</div>
              <div className="mem-stat-sub">{t("memory.touchedBaseSub")}</div>
            </div>
            <div className="mem-stat">
              <div className="mem-stat-label">{t("memory.bias")}</div>
              <div className="mem-stat-value">{r.biasPct == null ? "—" : `${r.biasPct >= 0 ? "+" : ""}${r.biasPct.toFixed(1)}%`}</div>
              <div className="mem-stat-sub">
                {r.biasPct == null ? "" : r.biasPct > 1 ? t("memory.biasLow") : r.biasPct < -1 ? t("memory.biasHigh") : t("memory.biasGood")}
              </div>
            </div>
          </div>

          <div className="mem-table">
            <div className="mem-head">
              <span>{t("memory.colDate")}</span><span>{t("memory.colPredicted")}</span><span>{t("memory.colActual")}</span><span>{t("memory.colError")}</span><span></span>
            </div>
            {r.evals.map((e) => <Row key={e.date} e={e} t={t} locale={locale} />)}
          </div>
        </>
      )}
    </section>
  );
}
