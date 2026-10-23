"use client";

// Sección "Verticales amiga" de VisionFutura (Carlos, oct 2026): la regla "Sombra 1–5 DTE"
// (credit spreads de SPX de 1 a 5 días) del script que compartió una amiga, con su
// lectura en vivo y el backtest diario acumulado. Lógica en lib/amigaVerticales.ts
// (traducción exacta del script, verificada contra el original) y lib/amigaStore.ts.

import { useCallback, useEffect, useState } from "react";
import type { Candidato, Evento, Jugada } from "@/lib/amigaVerticales";
import type { Lectura, LecturaPlazo } from "@/lib/amigaStore";

interface AmigaData {
  live: Lectura | null;
  liveError: string | null;
  resumen: {
    jugadas: number; calificadas: number; abiertas: number; ganadas: number; total: number; media: number | null;
    peor: Jugada | null;
    tabla: { plazo: number; hora: string; jugadas: number; calificadas: number; ganadas: number; total: number; media: number | null }[];
  };
  jugadas: Jugada[];
  lecturas: Lectura[];
  salidas: { fecha: string; hora: string; jugadaId: string; texto: string }[];
  calendario: (Evento & { nota?: string })[];
}

const UP = "var(--green)";
const DOWN = "var(--red-soft)";
const usd = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const k = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const GATE_NAME: Record<string, string> = { L: "Liquidez", I: "Imán", "σ": "Distancia σ", "Δ": "Delta", M: "Muro", P: "Precio real", $: "Crédito", N: "Noticias" };

function Jugadita({ j }: { j: Candidato }) {
  const T = j.lado === "call" ? "CALL" : "PUT";
  return (
    <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontWeight: 700, color: j.lado === "call" ? DOWN : UP }}>✅ {j.lado === "call" ? "Call credit" : "Put credit"} {k(j.corto)}/{k(j.largo)}</div>
      <div><b style={{ color: "var(--amber-text)" }}>VENDER</b> {T} <b>{k(j.corto)}</b> <span style={{ color: "var(--muted)" }}>@ bid ${j.bidCorto?.toFixed(2) ?? "—"}</span></div>
      <div><b style={{ color: "var(--accent)" }}>COMPRAR</b> {T} <b>{k(j.largo)}</b> <span style={{ color: "var(--muted)" }}>@ ask ${j.askLargo?.toFixed(2) ?? "—"}</span></div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Crédito ${j.credito.toFixed(2)} (${Math.round(j.credito * 100)}) · riesgo ${Math.round((j.ancho - j.credito) * 100)} · toma de ganancia al recomprar ≤ ${(j.credito * 0.5).toFixed(2)}
      </div>
    </div>
  );
}

function PlazoCard({ p }: { p: LecturaPlazo }) {
  const ok = p.jugadas.length > 0;
  return (
    <div style={{ border: "1px solid var(--border)", borderLeft: `4px solid ${ok ? UP : "var(--border)"}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6, background: "var(--panel-2)" }}>
      <div style={{ fontSize: 13 }}>
        <b>Plazo {p.plazo}</b> <span style={{ color: "var(--muted)" }}>· vence {p.vencimiento}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        {p.iv != null ? <>IV {(p.iv * 100).toFixed(1)}% · 1σ ±{Math.round(p.sigma ?? 0)} pts · imán {k(p.iman)} · muro puts {k(p.muroPut)} · muro calls {k(p.muroCall)}</> : "sin IV"}
        {p.pctReal != null && p.pctReal < 1 && <> · {Math.round(p.pctReal * 100)}% con precio real</>}
      </div>
      {ok ? (
        <>
          {p.jugadas.map((j) => <Jugadita key={`${j.lado}-${j.corto}`} j={j} />)}
          {p.jugadas.length === 2 && <div style={{ fontSize: 12, color: "var(--accent)" }}>Los dos lados pasan: iron condor</div>}
        </>
      ) : (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          ⛔ Sin jugada{p.motivo ? `: ${p.motivo}` : ""}
          {p.mejorRechazado && (
            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
              <span>El mejor ({p.mejorRechazado.lado} {k(p.mejorRechazado.corto)}/{k(p.mejorRechazado.largo)}) falla:</span>
              {p.mejorRechazado.comp.filter((c) => !c.ok).map((c) => (
                <span key={c.id} title={c.detalle} style={{ padding: "1px 7px", borderRadius: 999, border: `1px solid ${DOWN}`, color: DOWN }}>
                  {c.id} {GATE_NAME[c.id]}: {c.detalle}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const estadoTxt: Record<Jugada["estado"], string> = { abierta: "abierta", ganancia: "toma de ganancia", stop: "stop", vencida: "vencida" };

export default function VisionFuturaAmiga({ replayDate, replayTickMs }: { replayDate?: string | null; replayTickMs?: number | null }) {
  const [data, setData] = useState<AmigaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vision-futura/amiga", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `Error ${res.status}`);
      setData(json as AmigaData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar Verticales amiga.");
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const runToday = async () => {
    setRunning(true);
    try { await fetch("/api/vision-futura/amiga/run", { cache: "no-store" }); } finally { setRunning(false); load(); }
  };

  const replay = !!replayDate && replayTickMs != null;
  // En la repetición: la última lectura del día ≤ la hora elegida, y las jugadas/salidas hasta esa hora.
  const lecturaReplay = replay
    ? [...(data?.lecturas ?? [])].filter((l) => l.fecha === replayDate && Date.parse(l.at) <= replayTickMs!).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null
    : null;
  const lectura = replay ? lecturaReplay : data?.live ?? null;
  // Hora (minutos NY) del momento elegido en la repetición, para mostrar solo lo que ya pasó.
  const tickMin = replay
    ? (() => { const t = new Date(replayTickMs!).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }); return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); })()
    : 0;
  const hhmm = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const salidasDia = replay ? (data?.salidas ?? []).filter((s) => s.fecha === replayDate && hhmm(s.hora) <= tickMin) : [];

  return (
    <div className="card" style={{ gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
        <h4 style={{ margin: 0 }}>Verticales amiga</h4>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Regla “Sombra 1–5 DTE” (SPX) · credit spreads de 1 a 5 días · lecturas 10:00 · 12:30 · 15:30 ET</span>
      </div>

      <details style={{ fontSize: 12, color: "var(--muted)" }}>
        <summary style={{ cursor: "pointer" }}>Las reglas</summary>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>
          <li>Vencimientos: los 5 siguientes después de hoy. Vende put credit (debajo del precio) o call credit (encima), de 10 o 15 puntos.</li>
          <li><b>L</b> OI ≥ 800 en las dos patas · <b>I</b> no vender hacia el imán (strike de más |GEX| con OI ≥ 1,000) · <b>σ</b> corto a ≥ 1σ · <b>Δ</b> corto entre 0.10 y 0.20</li>
          <li><b>M</b> corto en el muro de OI de su lado o más lejos · <b>P</b> bid/ask real y angosto (≤ 25% del medio) · <b>$</b> crédito ≥ 10% del ancho · <b>N</b> sin FOMC/CPI/NFP/PPI/PCE hasta el vencimiento</li>
          <li>Si pasan los dos lados: iron condor. Entre varios gana el que más rinde (crédito ÷ riesgo).</li>
          <li>Salidas: toma de ganancia si recomprar cuesta ≤ 50% del crédito (lecturas 12:30 y 15:30), stop si el precio cruzó el corto, o al vencimiento.</li>
        </ul>
      </details>

      {error && <div style={{ fontSize: 13, color: "var(--amber-text)" }}>{error}</div>}

      {/* Lectura */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <b style={{ fontSize: 14 }}>
            {replay
              ? lectura ? `Lectura de las ${lectura.hora} (SPX ${k(lectura.spot)})` : "Todavía no hubo lectura a esta hora (la primera es a las 10:00)"
              : lectura ? `Lectura de ahora (SPX ${k(lectura.spot)}, tastytrade)` : "Lectura de ahora"}
          </b>
          {!replay && data?.liveError && <span style={{ fontSize: 12, color: "var(--amber-text)" }}>{data.liveError}</span>}
        </div>
        {!replay && <div style={{ fontSize: 12, color: "var(--faint)" }}>Las lecturas oficiales de la regla son a las 10:00, 12:30 y 15:30; esta es una lectura continua con los precios de este momento.</div>}
        {lectura && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 10 }}>
            {lectura.plazos.map((p) => <PlazoCard key={p.plazo} p={p} />)}
          </div>
        )}
        {replay && salidasDia.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {salidasDia.map((s) => (
              <div key={s.texto} style={{ fontSize: 13, border: "1px solid var(--accent)", background: "var(--accent-dim)", borderRadius: 8, padding: "6px 10px" }}>
                🔁 {s.hora} · {s.texto}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historial / backtest */}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <b style={{ fontSize: 14 }}>Backtest acumulado (historial)</b>
            <button
              onClick={runToday}
              disabled={running}
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", cursor: running ? "wait" : "pointer" }}
            >
              {running ? "Procesando…" : "Procesar las lecturas de hoy"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
            <span><b>{data.resumen.jugadas}</b> jugadas</span>
            <span><b>{data.resumen.calificadas}</b> calificadas · <b>{data.resumen.abiertas}</b> abiertas</span>
            <span>Ganadas <b style={{ color: UP }}>{data.resumen.ganadas}</b> de {data.resumen.calificadas}{data.resumen.calificadas ? ` (${Math.round((data.resumen.ganadas / data.resumen.calificadas) * 100)}%)` : ""}</span>
            <span>Total <b style={{ color: data.resumen.total >= 0 ? UP : DOWN }}>{usd(data.resumen.total)}</b></span>
            {data.resumen.media != null && <span>Media {usd(data.resumen.media)} por jugada</span>}
            {data.resumen.peor && <span>Peor {usd(data.resumen.peor.resultado ?? 0)}</span>}
          </div>
          {data.jugadas.length === 0 ? (
            <div className="wheel-empty" style={{ fontSize: 13 }}>Sin jugadas todavía. Se registran al procesar cada día (automático al guardar la repetición después del cierre).</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {["Fecha", "Hora", "Plazo", "Vence", "Jugada", "Crédito", "Estado", "Resultado", "Salida"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "5px 8px", color: "var(--muted)", fontWeight: 500, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.jugadas
                    // En la repetición: solo las abiertas hasta la hora elegida.
                    .filter((j) => !replay || j.fecha < replayDate! || (j.fecha === replayDate && hhmm(j.hora) <= tickMin))
                    .map((j) => (
                      <tr key={j.id} style={{ background: replay && j.fecha === replayDate ? "rgba(47,107,255,0.08)" : undefined }}>
                        <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{j.fecha}</td>
                        <td style={{ padding: "5px 8px" }}>{j.hora}</td>
                        <td style={{ padding: "5px 8px" }}>{j.plazo}</td>
                        <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{j.vencimiento}</td>
                        <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>Vender {j.lado} {k(j.corto)}/{k(j.largo)}</td>
                        <td style={{ padding: "5px 8px" }}>${j.credito.toFixed(2)}</td>
                        <td style={{ padding: "5px 8px" }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                            color: j.resultado == null ? "var(--muted)" : j.resultado >= 0 ? UP : DOWN,
                            border: `1px solid ${j.resultado == null ? "var(--border)" : j.resultado >= 0 ? UP : DOWN}`,
                          }}>
                            {j.resultado == null ? "ABIERTA" : j.resultado >= 0 ? "GANADA" : "PERDIDA"}
                          </span>{" "}
                          <span style={{ color: "var(--faint)" }}>{estadoTxt[j.estado]}</span>
                        </td>
                        <td style={{ padding: "5px 8px", fontWeight: 700, color: j.resultado == null ? "var(--muted)" : j.resultado >= 0 ? UP : DOWN }}>
                          {j.resultado == null ? "—" : usd(j.resultado)}
                        </td>
                        <td style={{ padding: "5px 8px", color: "var(--muted)" }}>{j.salida || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {data.resumen.tabla.some((t) => t.jugadas > 0) && (
            <details style={{ fontSize: 12, color: "var(--muted)" }}>
              <summary style={{ cursor: "pointer" }}>Resultado por plazo y hora</summary>
              <table style={{ borderCollapse: "collapse", marginTop: 6, fontSize: 12 }}>
                <thead><tr>{["Plazo", "Hora", "Jugadas", "Calificadas", "Ganadas", "Media", "Total"].map((h) => <th key={h} style={{ textAlign: "left", padding: "3px 8px" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.resumen.tabla.filter((t) => t.jugadas > 0).map((t) => (
                    <tr key={`${t.plazo}-${t.hora}`}>
                      <td style={{ padding: "3px 8px" }}>{t.plazo}</td><td style={{ padding: "3px 8px" }}>{t.hora}</td>
                      <td style={{ padding: "3px 8px" }}>{t.jugadas}</td><td style={{ padding: "3px 8px" }}>{t.calificadas}</td>
                      <td style={{ padding: "3px 8px" }}>{t.ganadas}</td>
                      <td style={{ padding: "3px 8px" }}>{t.media == null ? "—" : usd(t.media)}</td>
                      <td style={{ padding: "3px 8px" }}>{t.calificadas ? usd(t.total) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <div style={{ fontSize: 12, color: "var(--faint)" }}>
            Backtest con precios reales: promedio de los llenados al bid y al ask de cada contrato en MarketSnack en los 30 min previos a cada lectura (sin operaciones → sin precio, y la compuerta P lo rechaza).
            Calendario de noticias (compuerta N): {data.calendario.length ? data.calendario.map((e) => `${e.tipo} ${e.fecha}`).join(", ") : "vacío"} — editable en data/vision-futura/amiga/eventos.json (agrega CPI, NFP, PPI y PCE).
          </div>
        </div>
      )}
    </div>
  );
}
