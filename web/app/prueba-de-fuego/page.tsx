"use client";

import { useEffect, useState } from "react";
import BrandMark from "@/app/components/BrandMark";
import NavTabs from "@/app/components/NavTabs";
import TickerLiveTab from "./TickerLiveTab";
import SpxVecinosTab from "./SpxVecinosTab";
import SpxAmigaTab from "./SpxAmigaTab";
import AgenteOdteTab from "./AgenteOdteTab";
import ContractSearchTab from "./ContractSearchTab";
import SimulacionTab from "./SimulacionTab";
import { migrateLegacyKey } from "@/lib/legacyStorage";

const KEY_TAB = "visionary.pruebaDeFuego.tab";

type Tab = "TSLA" | "SPX" | "SPX_VECINOS" | "SPX_AMIGA" | "SPX_0DTE" | "buscar" | "simulacion";

export default function PruebaDeFuegoPage() {
  const [tab, setTab] = useState<Tab>("TSLA");

  useEffect(() => {
    migrateLegacyKey("tito.pruebaDeFuego.tab", KEY_TAB);
    const saved = window.localStorage.getItem(KEY_TAB);
    if (
      saved === "TSLA" ||
      saved === "SPX" ||
      saved === "SPX_VECINOS" ||
      saved === "SPX_AMIGA" ||
      saved === "SPX_0DTE" ||
      saved === "buscar" ||
      saved === "simulacion"
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
            <button className={tab === "SPX_AMIGA" ? "active" : ""} onClick={() => pickTab("SPX_AMIGA")}>
              SPX amiga
            </button>
            <button className={tab === "SPX_0DTE" ? "active" : ""} onClick={() => pickTab("SPX_0DTE")}>
              Agente ODTE
            </button>
            <button className={tab === "buscar" ? "active" : ""} onClick={() => pickTab("buscar")}>
              Búsqueda de contratos
            </button>
            <button className={tab === "simulacion" ? "active" : ""} onClick={() => pickTab("simulacion")}>
              Simulación
            </button>
          </div>
        </div>

        {tab === "TSLA" && <SpxVecinosTab ticker="TSLA" />}
        {tab === "SPX" && <TickerLiveTab ticker="SPX" />}
        {tab === "SPX_VECINOS" && <SpxVecinosTab ticker="SPX" />}
        {tab === "SPX_AMIGA" && <SpxAmigaTab />}
        {tab === "SPX_0DTE" && <AgenteOdteTab />}
        {tab === "buscar" && <ContractSearchTab />}
        {tab === "simulacion" && <SimulacionTab />}
      </div>
    </main>
  );
}
