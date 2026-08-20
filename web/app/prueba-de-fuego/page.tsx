"use client";

import { useEffect, useState } from "react";
import BrandMark from "@/app/components/BrandMark";
import NavTabs from "@/app/components/NavTabs";
import TickerLiveTab from "./TickerLiveTab";
import SpxVecinosTab from "./SpxVecinosTab";
import AgenteOdteTab from "./AgenteOdteTab";
import ContratosVecinos2Tab from "./ContratosVecinos2Tab";
import ContratosVecinos3Tab from "./ContratosVecinos3Tab";
import ContractSearchTab from "./ContractSearchTab";
import GrandesEmpresasTab from "./GrandesEmpresasTab";
import { migrateLegacyKey } from "@/lib/legacyStorage";

const KEY_TAB = "visionary.pruebaDeFuego.tab";

type Tab = "TSLA" | "SPX" | "SPX_VECINOS" | "SPX_0DTE" | "VECINOS_2" | "VECINOS_3" | "buscar" | "GRANDES";

// TSLA/SPX/SPX_VECINOS/SPX_0DTE: pedido explícito de Carlos (ago 2026) —
// sacadas de la navegación visible, NO borradas. El componente, la ruta y el
// `case` de render siguen intactos más abajo a propósito, por si hace falta
// traerlas de vuelta: para eso alcanza con volver a agregar el `<button>`
// correspondiente al array de abajo.
const VISIBLE_TABS: Tab[] = ["VECINOS_2", "VECINOS_3", "buscar", "GRANDES"];
const DEFAULT_TAB: Tab = "GRANDES";

export default function PruebaDeFuegoPage() {
  const [tab, setTab] = useState<Tab>(DEFAULT_TAB);

  useEffect(() => {
    migrateLegacyKey("tito.pruebaDeFuego.tab", KEY_TAB);
    const saved = window.localStorage.getItem(KEY_TAB);
    if (VISIBLE_TABS.includes(saved as Tab)) {
      setTab(saved as Tab);
    }
  }, []);

  const pickTab = (t: Tab) => {
    setTab(t);
    window.localStorage.setItem(KEY_TAB, t);
  };

  return (
    <main className="ideas-page">
      <div className="hb">
        <BrandMark subtitle="🔥 Prueba de Fuego · day-trading en vivo" />
        <NavTabs />
      </div>

      <div className="ideas-body">
        <div className="view-toggle-row">
          <div className="view-toggle">
            <button className={tab === "VECINOS_2" ? "active" : ""} onClick={() => pickTab("VECINOS_2")}>
              Contratos vecinos 2.0
            </button>
            <button className={tab === "VECINOS_3" ? "active" : ""} onClick={() => pickTab("VECINOS_3")}>
              Contratos 3.0
            </button>
            <button className={tab === "buscar" ? "active" : ""} onClick={() => pickTab("buscar")}>
              Búsqueda de contratos
            </button>
            <button className={tab === "GRANDES" ? "active" : ""} onClick={() => pickTab("GRANDES")}>
              Grandes empresas
            </button>
          </div>
        </div>

        {tab === "TSLA" && <SpxVecinosTab ticker="TSLA" />}
        {tab === "SPX" && <TickerLiveTab ticker="SPX" />}
        {tab === "SPX_VECINOS" && <SpxVecinosTab ticker="SPX" />}
        {tab === "SPX_0DTE" && <AgenteOdteTab />}
        {tab === "VECINOS_2" && <ContratosVecinos2Tab />}
        {tab === "VECINOS_3" && <ContratosVecinos3Tab />}
        {tab === "buscar" && <ContractSearchTab />}
        {tab === "GRANDES" && <GrandesEmpresasTab />}
      </div>
    </main>
  );
}
