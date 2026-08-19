"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BrandMark from "@/app/components/BrandMark";
import NavTabs from "@/app/components/NavTabs";
import VentaPrimasRiskCard, { DEFAULT_VP_PROFILE, loadVpProfile } from "@/app/components/VentaPrimasRiskCard";
import PopFilterTabs, { DEFAULT_POP_TAB, type PopTab } from "@/app/components/PopFilterTabs";
import VentaPrimasTable from "@/app/components/VentaPrimasTable";
import { budgetsOf, type CreditSpreadCandidate, type CreditSpreadRiskProfile } from "@/lib/creditSpreads";
import type { VentaPrimasSseEvent } from "./types";

const KEY_POP_TAB = "visionary.ventaPrimas.popTab";

type Meta = {
  scanned: number; failed: number; withCandidates: number; degraded: boolean;
  dteMin: number; dteMax: number; earningsWithinCount: number;
  marketVerdict: { realizedAvg: number; impliedAvg: number; cheap: boolean; n: number } | null;
  quoteDelayMinutes: number;
};

export default function VentaDePrimasPage() {
  const [profile, setProfile] = useState<CreditSpreadRiskProfile>(DEFAULT_VP_PROFILE);
  const [popTab, setPopTab] = useState<PopTab>(DEFAULT_POP_TAB);

  const [candidates, setCandidates] = useState<CreditSpreadCandidate[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setProfile(loadVpProfile());
    const saved = Number(window.localStorage.getItem(KEY_POP_TAB));
    if (saved === 60 || saved === 70 || saved === 80 || saved === 90) setPopTab(saved);
  }, []);

  const scan = useCallback(() => {
    esRef.current?.close();
    setBusy(true); setError(null); setSteps([]); setCandidates(null); setMeta(null);
    const es = new EventSource("/api/venta-de-primas");
    esRef.current = es;
    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as VentaPrimasSseEvent;
      if (data.type === "step") setSteps((s) => [...s.slice(-4), data.label]);
      else if (data.type === "done") { setCandidates(data.candidates); setMeta(data.meta); setBusy(false); es.close(); }
      else if (data.type === "error") { setError(data.message); setBusy(false); es.close(); }
    };
    es.onerror = () => { setError("Se cortó la conexión con el escáner."); setBusy(false); es.close(); };
  }, []);

  useEffect(() => { scan(); return () => esRef.current?.close(); }, [scan]);

  const pickPopTab = (v: PopTab) => { setPopTab(v); window.localStorage.setItem(KEY_POP_TAB, String(v)); };

  const budgets = useMemo(() => budgetsOf(profile), [profile]);

  const rows = useMemo(() => {
    if (!candidates) return [];
    return candidates
      .filter((c) => c.pop * 100 >= popTab)
      .sort((a, b) => b.evPerDollarCollateral - a.evPerDollarCollateral);
  }, [candidates, popTab]);

  const tickersWithCandidatesAtTab = useMemo(
    () => new Set(rows.map((r) => r.ticker)).size,
    [rows],
  );

  return (
    <main className="ideas-page">
      <div className="hb">
        <BrandMark subtitle="Venta de Primas · spreads de crédito de riesgo definido" />
        <NavTabs />
      </div>

      <div className="ideas-body">
        <p className="vp-disclaimer-top">
          El agente calcula y muestra; vos decidís y ejecutás. <b>Esto no es una orden ni un consejo de
          inversión.</b> Escanea spreads de crédito de riesgo definido con vencimiento entre 21 y 45 días.
        </p>

        <VentaPrimasRiskCard profile={profile} onChange={setProfile} />

        <div className="card">
          <h2 style={{ marginTop: 0 }}>POP mínimo</h2>
          <PopFilterTabs value={popTab} onChange={pickPopTab} />
        </div>

        <div className="ideas-controls">
          <button className="rescan" onClick={() => scan()} disabled={busy}>↻ Volver a escanear</button>
        </div>

        {busy && (
          <div className="card wheel-empty">
            {steps.length > 0 ? steps[steps.length - 1] : "Escaneando el mercado…"}
          </div>
        )}
        {error && <div className="error">⚠ {error}</div>}

        {candidates && meta && (
          <>
            <div className="wheel-status">
              Escaneados {meta.scanned} · {tickersWithCandidatesAtTab} con candidatos (POP ≥{popTab}%) ·
              {" "}vencimientos de {meta.dteMin} a {meta.dteMax} días
              {meta.degraded && <span className="wheel-tag warn"> datos parciales: falló más de la mitad</span>}
            </div>

            {meta.marketVerdict?.cheap && (
              <div className="vp-verdict-banner">
                <b>Hoy la prima está barata en el mercado.</b> La volatilidad que las acciones están
                realizando ({meta.marketVerdict.realizedAvg.toFixed(1)}%) va por encima de la que se paga
                ({meta.marketVerdict.impliedAvg.toFixed(1)}%): es mal momento para vender prima, por bueno
                que se vea un candidato suelto.
              </div>
            )}

            {meta.earningsWithinCount > 0 && (
              <div className="vp-earnings-banner">
                ⚠ {meta.earningsWithinCount} candidato{meta.earningsWithinCount === 1 ? "" : "s"} tiene
                {meta.earningsWithinCount === 1 ? "" : "n"} resultados antes del vencimiento (insignia{" "}
                <b>REPORTE DENTRO</b> en la tabla). No se ocultan: la prima alta antes de un reporte es alta
                justo por el riesgo del reporte, no filtrada por eso.
              </div>
            )}

            <div className="vp-notes">
              <p>
                Hoy Massive no trae bid/ask real (<code>last_quote</code>) para los contratos de este
                barrido. Cuando falta, el crédito se ESTIMA desde el último precio operado con un recorte
                del 10% a cada lado (mismo criterio que ya usa la Wheel para el mismo problema) — esas filas
                quedan marcadas &quot;estimado&quot; en la columna CRÉDITO, nunca se presentan como precio
                real de mercado.
              </p>
              <p>
                Las cotizaciones llegan con un retraso declarado de <b>~{meta.quoteDelayMinutes} minutos</b>.
                Para vencimientos de 21 a 45 días eso no cambia la decisión, pero confirmá el precio en tu
                bróker antes de vender.
              </p>
              <p>
                El sesgo (ALCISTA/BAJISTA) de este barrido sale de una heurística burda —solo mira si el
                precio de hoy está por encima o por debajo del cierre de hace 20 sesiones—, más cruda que el
                análisis de la ficha individual del ticker (niveles, GEX, flujo real). Revisá esa ficha antes
                de operar.
              </p>
              <p>
                El valor esperado (VE) usa la volatilidad <b>realizada</b> de los últimos 22 cierres, así que
                un salto de precio reciente por un reporte de resultados lo sigue castigando durante esa
                ventana aunque el reporte ya haya pasado.
              </p>
              <p>
                Fecha de earnings estimada por cadencia de reportes trimestrales (no hay calendario de
                anuncios en el plan de datos actual). La HORA del anuncio (antes de abrir / después de
                cerrar) tampoco la da ninguna fuente conectada hoy — se trata siempre como
                &quot;desconocida&quot;, que por la regla conservadora cuenta como &quot;dentro&quot; del
                vencimiento.
              </p>
            </div>

            <VentaPrimasTable rows={rows} budgets={budgets} />
          </>
        )}
      </div>
    </main>
  );
}
