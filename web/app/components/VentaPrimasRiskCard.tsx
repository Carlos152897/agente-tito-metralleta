"use client";

// Panel de riesgo de Venta de Primas — propio, no reusa lib/risk.ts.
//
// Es una familia distinta del panel de Ideas (`lib/risk.ts`): ahí se dimensiona
// una sola pata larga (el costo ES la pérdida máxima). Acá el techo es el
// COLATERAL de un spread de riesgo definido — otra cuenta, otra unidad, y el
// slider va de 1% (conservador) a 50% (agresivo) tal como lo pidió Carlos,
// distinto del tope de Ideas.

import { useEffect, useState } from "react";
import {
  THETA_BURN_PCT_OF_CAPITAL, budgetsOf, type CreditSpreadRiskProfile,
} from "@/lib/creditSpreads";

const KEY_ACCOUNT = "visionary.ventaPrimas.accountSize";
const KEY_RISK = "visionary.ventaPrimas.riskPct";

export const DEFAULT_VP_PROFILE: CreditSpreadRiskProfile = { accountSize: 10_000, riskPct: 5 };

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

/** Lee el perfil de localStorage. Solo cliente — el saldo nunca llega al servidor. */
export function loadVpProfile(): CreditSpreadRiskProfile {
  if (typeof window === "undefined") return DEFAULT_VP_PROFILE;
  const account = Number(window.localStorage.getItem(KEY_ACCOUNT));
  const risk = Number(window.localStorage.getItem(KEY_RISK));
  return {
    accountSize: Number.isFinite(account) && account > 0 ? account : DEFAULT_VP_PROFILE.accountSize,
    riskPct: Number.isFinite(risk) && risk > 0 ? risk : DEFAULT_VP_PROFILE.riskPct,
  };
}

export default function VentaPrimasRiskCard({
  profile,
  onChange,
}: {
  profile: CreditSpreadRiskProfile;
  onChange: (p: CreditSpreadRiskProfile) => void;
}) {
  const [draft, setDraft] = useState(String(profile.accountSize));

  useEffect(() => {
    setDraft(String(profile.accountSize));
  }, [profile.accountSize]);

  const commitAccount = (raw: string) => {
    const n = Number(raw.replace(/[^0-9.]/g, ""));
    const accountSize = Number.isFinite(n) && n > 0 ? n : 0;
    window.localStorage.setItem(KEY_ACCOUNT, String(accountSize));
    onChange({ ...profile, accountSize });
  };

  const commitRisk = (riskPct: number) => {
    window.localStorage.setItem(KEY_RISK, String(riskPct));
    onChange({ ...profile, riskPct });
  };

  const budgets = budgetsOf(profile);

  return (
    <section className="risk-card">
      <div className="risk-head">
        <h2>Tu perfil de riesgo</h2>
        <span className="muted">
          Se guarda solo en este navegador — tu saldo nunca sale de tu equipo.
        </span>
      </div>

      <div className="risk-controls">
        <label className="risk-field">
          <span>Tamaño de cuenta</span>
          <input
            className="risk-input"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commitAccount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label="Tamaño de cuenta en dólares"
          />
        </label>

        <label className="risk-field grow">
          <span>
            Riesgo por trade — <strong>{profile.riskPct}%</strong>
          </span>
          <input
            className="risk-slider"
            type="range"
            min={1}
            max={50}
            step={0.5}
            value={profile.riskPct}
            onChange={(e) => commitRisk(Number(e.target.value))}
            aria-label="Riesgo por trade como porcentaje de la cuenta"
          />
          <span className="risk-scale">
            <span>conservador 1%</span>
            <span>agresivo 50%</span>
          </span>
        </label>
      </div>

      <div className="risk-budgets">
        <div>
          <span className="muted">Capital máximo por trade</span>
          <strong>{money.format(budgets.maxCapitalPerTrade)}</strong>
        </div>
        <div>
          <span className="muted">Máxima quema de theta ({THETA_BURN_PCT_OF_CAPITAL}% de ese capital)</span>
          <strong>{money.format(budgets.maxThetaBurn)}</strong>
        </div>
      </div>

      <p className="risk-note">
        Los números de arriba son un <strong>techo</strong>, no una sugerencia de compra. El
        límite de theta viene de una regla propia: un contrato que pierde más del{" "}
        {THETA_BURN_PCT_OF_CAPITAL}% de su valor al día se descarta por lotería.
      </p>
    </section>
  );
}
