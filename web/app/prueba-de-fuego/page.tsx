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
import { migrateLegacyKey } from "@/lib/legacyStorage";

const KEY_TAB = "visionary.pruebaDeFuego.tab";

type Tab = "TSLA" | "SPX" | "SPX_VECINOS" | "SPX_0DTE" | "VECINOS_2" | "VECINOS_3" | "buscar";

export default function PruebaDeFuegoPage() {
  const [tab, setTab] = useState<Tab>("TSLA");

  useEffect(() => {
    migrateLegacyKey("tito.pruebaDeFuego.tab", KEY_TAB);
    const saved = window.localStorage.getItem(KEY_TAB);
    if (
      saved === "TSLA" ||
      saved === "SPX" ||
      saved === "SPX_VECINOS" ||
      saved === "SPX_0DTE" ||
      saved === "VECINOS_2" ||
      saved === "VECINOS_3" ||
      saved === "buscar"
    ) {
      setTab(saved);
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
            <button className={tab === "TSLA" ? "active" : ""} onClick={() => pickTab("TSLA")}>
              TSLA
            </button>
            <button className={tab === "SPX" ? "active" : ""} onClick={() => pickTab("SPX")}>
              SPX
            </button>
            <button className={tab === "SPX_VECINOS" ? "active" : ""} onClick={() => pickTab("SPX_VECINOS")}>
              SPX vecinos
            </button>
            <button className={tab === "SPX_0DTE" ? "active" : ""} onClick={() => pickTab("SPX_0DTE")}>
              Agente ODTE
            </button>
            <button className={tab === "VECINOS_2" ? "active" : ""} onClick={() => pickTab("VECINOS_2")}>
              Contratos vecinos 2.0
            </button>
            <button className={tab === "VECINOS_3" ? "active" : ""} onClick={() => pickTab("VECINOS_3")}>
              Contratos 3.0
            </button>
            <button className={tab === "buscar" ? "active" : ""} onClick={() => pickTab("buscar")}>
              Búsqueda de contratos
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
      </div>
    </main>
  );
}
