"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { timeGreeting } from "@/lib/greeting";
import { isMarketOpen } from "@/lib/marketHours";
import { loadProfile } from "@/app/components/RiskProfileCard";
import { useLocale } from "@/lib/i18n";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";

const CHIP_COLORS = ["#34d399", "#22d3ee", "#fb923c", "#60a5fa", "#c084fc"];
const CHIPS = ["SPX", "SPY", "TSLA", "NVDA", "AAPL"];

interface HeroTicker {
  ticker: string;
  price: number;
  changePct: number | null;
}

// Accesos rápidos — pedido explícito de Carlos a partir de un mockup de
// referencia que solo tenía 4 (Day Trading/Ideas/Wheel/Time & Sales): el
// proyecto ya tiene 8 secciones, así que se amplió a las 7 que tiene sentido
// acceder rápido desde acá (Ticker queda afuera — la búsqueda de arriba ES
// esa página). Un color/ícono propio por tarjeta, mismo lenguaje neón del
// mockup, sin inventar íconos con emoji — SVG inline.
const QUICK_LINKS: {
  href: string; label: string; desc: string; color: string; icon: (c: string) => React.ReactNode;
}[] = [
  {
    href: "/prueba-de-fuego", label: "Day Trading", desc: "Charts, setups and execution.", color: "#34d399",
    icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l5-6 4 3 6-8" /><path d="M14 6h4v4" />
      </svg>
    ),
  },
  {
    href: "/ideas", label: "Ideas", desc: "High probability plays and watchlist.", color: "#fbbf24",
    icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0012 3z" />
      </svg>
    ),
  },
  {
    href: "/wheel", label: "Wheel", desc: "Cash secured puts strategy.", color: "#c084fc",
    icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><path d="M12 3v18M3 12h18" />
      </svg>
    ),
  },
  {
    href: "/venta-de-primas", label: "Venta de Primas", desc: "Credit spreads de riesgo definido.", color: "#fb923c",
    icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
    ),
  },
  {
    href: "/flow", label: "Time & Sales", desc: "Real-time flow and volume.", color: "#60a5fa",
    icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />
      </svg>
    ),
  },
  {
    href: "/unusual-swing", label: "Unusual Swing", desc: "Acumulación institucional real.", color: "#f472b6",
    icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12l4-5 4 3 4-6 6 8" /><circle cx="19" cy="6" r="2" />
      </svg>
    ),
  },
  {
    href: "/analisis-mercado", label: "Análisis del mercado", desc: "Risk ON/OFF, VIX, Fed y noticias.", color: "#2dd4bf",
    icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z" />
      </svg>
    ),
  },
  {
    href: "/ajustes", label: "Ajustes", desc: "Cookie de MarketSnack y preferencias.", color: "#94a3b8",
    icon: (c) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
];

export default function HeroLanding({ onSearch }: { onSearch: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [marketOpen, setMarketOpen] = useState(false);
  const [tolerancePct, setTolerancePct] = useState(4);
  const [tickers, setTickers] = useState<HeroTicker[]>([]);
  const { t } = useLocale();

  useEffect(() => {
    setMarketOpen(isMarketOpen());
    setTolerancePct(loadProfile().tolerancePct);
    fetch("/api/hero-tickers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.tickers)) setTickers(d.tickers); })
      .catch(() => {});
  }, []);

  const submit = () => {
    const t = q.trim().toUpperCase();
    if (!t) return;
    setQ("");
    onSearch(t);
  };

  return (
    <div className="hero">
      <div className="hero-topbar">
        <div className="hero-wordmark">
          <img src="/logo.png" alt="" className="hero-wordmark-icon" />
          <div>
            <div className="hero-wordmark-name">
              VISIONARY <span>TRADES</span>
            </div>
            <div className="hero-wordmark-tag">Built different. Built disciplined.</div>
          </div>
        </div>
        <div className="hero-topbar-right">
          <div className={`hero-status ${marketOpen ? "open" : "closed"}`}>
            <span className="dot" />
            Market Overview — {marketOpen ? t("hero.open") : t("hero.closed")}
          </div>
          <LanguageSwitcher />
        </div>
      </div>

      {tickers.length > 0 && (
        <div className="hero-tickers">
          {tickers.map((tk) => (
            <div key={tk.ticker} className="hero-ticker">
              <span className="hero-ticker-sym">{tk.ticker}</span>
              <span className="hero-ticker-price">{tk.price.toFixed(2)}</span>
              {tk.changePct != null && (
                <span className={`hero-ticker-chg ${tk.changePct >= 0 ? "up" : "down"}`}>
                  {tk.changePct >= 0 ? "▲" : "▼"} {Math.abs(tk.changePct).toFixed(2)}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="hero-greeting">{timeGreeting()}</div>
      <div className="hero-tagline">Discipline today. Freedom tomorrow.</div>

      <div className="hero-logo-wrap">
        <img src="/logo.png" alt="Visionary Trades" className="hero-logo" />
      </div>

      <div className="hero-search-row">
        <input
          className="hero-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={t("hero.searchPlaceholder")}
          spellCheck={false}
        />
        <button className="hero-search-btn" onClick={submit} aria-label={t("common.search")}>
          🔍
        </button>
      </div>

      <div className="hero-chips">
        {CHIPS.map((s, i) => (
          <button
            key={s}
            type="button"
            className="hero-chip"
            style={{ borderColor: CHIP_COLORS[i % CHIP_COLORS.length], color: CHIP_COLORS[i % CHIP_COLORS.length] }}
            onClick={() => onSearch(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="hero-quick-grid">
        {QUICK_LINKS.map((q) => (
          <Link key={q.href} href={q.href} className="hero-quick-card" style={{ ["--card-color" as string]: q.color }}>
            <div className="hero-quick-icon">{q.icon(q.color)}</div>
            <div className="hero-quick-title">{q.label}</div>
            <div className="hero-quick-desc">{q.desc}</div>
          </Link>
        ))}
      </div>

      <div className="hero-motto">
        Plan. <span className="hero-motto-accent">Execute</span>. Review. Repeat.
      </div>
      <div className="hero-motto-sub">Your edge is your consistency.</div>

      <div className="hero-stats-row">
        <div className="hero-stat-card focus">
          <div className="hero-stat-icon">🎯</div>
          <div className="hero-stat-title">Daily Focus</div>
          <div className="hero-stat-desc">Protect your capital. Take high quality trades.</div>
          <div className="hero-stat-bar"><div className="fill focus" /></div>
          <div className="hero-stat-foot">1 Goal. 1 Plan. 1 Day at a Time.</div>
        </div>

        <div className="hero-stat-center">
          <img src="/logo.png" alt="" />
        </div>

        <div className="hero-stat-card risk">
          <div className="hero-stat-icon">🛡️</div>
          <div className="hero-stat-title">Risk Management</div>
          <div className="hero-stat-desc">
            Risk: {tolerancePct}% per trade
            <br />
            Reward 2R+
          </div>
          <div className="hero-stat-bar">
            <div className="fill risk" style={{ width: `${Math.min(100, (tolerancePct / 10) * 100)}%` }} />
          </div>
          <div className="hero-stat-foot">Protect today. Profit tomorrow.</div>
        </div>
      </div>

      <div className="hero-footer">
        <div className="hero-footer-name">VISIONARY TRADES</div>
        <div className="hero-footer-social">
          <span>▶</span>
          <span>𝕏</span>
          <span>📷</span>
        </div>
      </div>
    </div>
  );
}
