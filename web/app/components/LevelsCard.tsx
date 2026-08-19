"use client";

import type { Level, LevelsReport } from "@/lib/levels";
import { useLocale, Rich, type LocaleCtx } from "@/lib/i18n";
import { int, money, px } from "../format";

const SUP = "#12b76a";
const RES = "#f04438";

function strengthLabel(s: number, t: LocaleCtx["t"]): string {
  if (s >= 70) return t("levelsCard.veryStrong");
  if (s >= 50) return t("levelsCard.strong");
  if (s >= 30) return t("levelsCard.moderate");
  return t("levelsCard.weak");
}

function Row({ l, t }: { l: Level; t: LocaleCtx["t"] }) {
  const color = l.kind === "soporte" ? SUP : RES;
  return (
    <div className="lvl-row">
      <div className="lvl-price" style={{ color }}>
        ${px.format(l.price)}
        <span className="lvl-dist">
          {l.distancePct >= 0 ? "+" : ""}{l.distancePct.toFixed(1)}%
        </span>
      </div>
      <div className="lvl-mid">
        <div className="lvl-bar">
          <div style={{ width: `${l.strength}%`, background: color }} />
        </div>
        <div className="lvl-why">{l.why}</div>
      </div>
      <div className="lvl-strength">
        <b style={{ color }}>{l.strength}</b>
        <span>{strengthLabel(l.strength, t)}</span>
        {l.flipped && <span className="lvl-flip">{t("levelsCard.flipped")}</span>}
      </div>
    </div>
  );
}

/**
 * Soportes y resistencias — cruce del precio (pivotes reales) con las opciones
 * (venta de calls = resistencia, venta de puts = soporte).
 */
export default function LevelsCard({ r, ticker }: { r: LevelsReport; ticker: string }) {
  const { t } = useLocale();
  const has = r.supports.length > 0 || r.resistances.length > 0;

  return (
    <section className="card">
      <div>
        <div className="card-title">{t("levelsCard.title")}</div>
        <div className="card-sub">{t("levelsCard.sub", { ticker })}</div>
      </div>

      {!has ? (
        <div className="feed-empty">{t("levelsCard.none")}</div>
      ) : (
        <>
          {(r.keyResistance || r.keySupport) && (
            <div className="lvl-key">
              {r.keyResistance && (
                <div className="lvl-key-box" style={{ borderColor: `${RES}33`, background: "#fef3f2" }}>
                  <div className="lvl-key-label" style={{ color: RES }}>{t("levelsCard.keyResistance")}</div>
                  <div className="lvl-key-price" style={{ color: RES }}>${px.format(r.keyResistance.price)}</div>
                  <div className="lvl-key-sub">
                    {r.keyResistance.distancePct >= 0 ? "+" : ""}{r.keyResistance.distancePct.toFixed(1)}% ·
                    {" "}{t("levelsCard.strengthOf", { s: r.keyResistance.strength })}
                  </div>
                </div>
              )}
              {r.keySupport && (
                <div className="lvl-key-box" style={{ borderColor: `${SUP}33`, background: "#f6fef9" }}>
                  <div className="lvl-key-label" style={{ color: SUP }}>{t("levelsCard.keySupport")}</div>
                  <div className="lvl-key-price" style={{ color: SUP }}>${px.format(r.keySupport.price)}</div>
                  <div className="lvl-key-sub">
                    {r.keySupport.distancePct.toFixed(1)}% · {t("levelsCard.strengthOf", { s: r.keySupport.strength })}
                  </div>
                </div>
              )}
            </div>
          )}

          {r.resistances.length > 0 && (
            <div>
              <div className="news-head">{t("levelsCard.resistancesHead")}</div>
              <div className="lvl-list">
                {r.resistances.map((l) => <Row key={`r${l.price}`} l={l} t={t} />)}
              </div>
            </div>
          )}

          <div className="lvl-spot">
            {t("levelsCard.currentPrice")} · <b>${px.format(r.spot)}</b>
          </div>

          {r.supports.length > 0 && (
            <div>
              <div className="news-head">{t("levelsCard.supportsHead")}</div>
              <div className="lvl-list">
                {r.supports.map((l) => <Row key={`s${l.price}`} l={l} t={t} />)}
              </div>
            </div>
          )}

          <Rich className="iv-note" text={t("levelsCard.note", { tol: r.tolerancePct })} />
        </>
      )}
    </section>
  );
}
