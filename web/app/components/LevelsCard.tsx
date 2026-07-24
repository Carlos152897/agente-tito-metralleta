"use client";

import type { Level, LevelsReport } from "@/lib/levels";
import { int, money, px } from "../format";

const SUP = "#12b76a";
const RES = "#f04438";

function strengthLabel(s: number): string {
  if (s >= 70) return "Muy fuerte";
  if (s >= 50) return "Fuerte";
  if (s >= 30) return "Moderado";
  return "Débil";
}

function Row({ l }: { l: Level }) {
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
        <span>{strengthLabel(l.strength)}</span>
        {l.flipped && <span className="lvl-flip">flipeado</span>}
      </div>
    </div>
  );
}

/**
 * Soportes y resistencias — cruce del precio (pivotes reales) con las opciones
 * (venta de calls = resistencia, venta de puts = soporte).
 */
export default function LevelsCard({ r, ticker }: { r: LevelsReport; ticker: string }) {
  const has = r.supports.length > 0 || r.resistances.length > 0;

  return (
    <section className="card">
      <div>
        <div className="card-title">Soportes y resistencias</div>
        <div className="card-sub">
          Dónde el precio de {ticker} ya frenó antes y dónde hay dinero puesto para frenarlo.
          La fuerza mezcla los rebotes reales con el posicionamiento en opciones.
        </div>
      </div>

      {!has ? (
        <div className="feed-empty">Sin niveles claros en el rango operativo.</div>
      ) : (
        <>
          {(r.keyResistance || r.keySupport) && (
            <div className="lvl-key">
              {r.keyResistance && (
                <div className="lvl-key-box" style={{ borderColor: `${RES}33`, background: "#fef3f2" }}>
                  <div className="lvl-key-label" style={{ color: RES }}>Resistencia clave</div>
                  <div className="lvl-key-price" style={{ color: RES }}>${px.format(r.keyResistance.price)}</div>
                  <div className="lvl-key-sub">
                    {r.keyResistance.distancePct >= 0 ? "+" : ""}{r.keyResistance.distancePct.toFixed(1)}% ·
                    fuerza {r.keyResistance.strength}/100
                  </div>
                </div>
              )}
              {r.keySupport && (
                <div className="lvl-key-box" style={{ borderColor: `${SUP}33`, background: "#f6fef9" }}>
                  <div className="lvl-key-label" style={{ color: SUP }}>Soporte clave</div>
                  <div className="lvl-key-price" style={{ color: SUP }}>${px.format(r.keySupport.price)}</div>
                  <div className="lvl-key-sub">
                    {r.keySupport.distancePct.toFixed(1)}% · fuerza {r.keySupport.strength}/100
                  </div>
                </div>
              )}
            </div>
          )}

          {r.resistances.length > 0 && (
            <div>
              <div className="news-head">Resistencias — techos por encima del precio</div>
              <div className="lvl-list">
                {r.resistances.map((l) => <Row key={`r${l.price}`} l={l} />)}
              </div>
            </div>
          )}

          <div className="lvl-spot">
            Precio actual · <b>${px.format(r.spot)}</b>
          </div>

          {r.supports.length > 0 && (
            <div>
              <div className="news-head">Soportes — suelos por debajo del precio</div>
              <div className="lvl-list">
                {r.supports.map((l) => <Row key={`s${l.price}`} l={l} />)}
              </div>
            </div>
          )}

          <div className="iv-note">
            Un nivel vale más cuando <b>coincide</b> el precio y las opciones: que ya haya
            rebotado ahí <i>y</i> que además haya dinero puesto. Los niveles se agrupan con una
            tolerancia de {r.tolerancePct}% — $299 y $301 son el mismo techo, no dos.
            <b> Flipeado</b> = era techo y ahora hace de suelo (o al revés).
          </div>
        </>
      )}
    </section>
  );
}
