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

// Mezcla un hex con blanco (amt>0, aclara) o negro (amt<0, oscurece) — para
// derivar los 2-3 tonos que necesita cada ícono "de vidrio/3D" (claro arriba,
// oscuro abajo) a partir del único color por tarjeta que ya existía.
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255;
  const p = Math.min(1, Math.abs(amt));
  const mix = (v: number) => Math.round((t - v) * p + v);
  return `#${((1 << 24) + (mix(r) << 16) + (mix(g) << 8) + mix(b)).toString(16).slice(1)}`;
}

// Accesos rápidos — pedido explícito de Carlos a partir de un mockup de
// referencia con íconos "renderizados" (degradados + brillo de vidrio +
// sombra), no líneas planas. Las primeras 4 (Day Trading/Ideas/Wheel/Time &
// Sales) calcan ese mockup; las otras 4 secciones del proyecto se diseñaron
// con el mismo lenguaje (gradiente claro→oscuro del color de la tarjeta vía
// shade(), resalto blanco y drop-shadow) pero íconos propios. `gid` es el
// prefijo de los ids de <linearGradient>/<radialGradient> de cada ícono —
// tienen que ser únicos por tarjeta o un navegador puede resolver el
// url(#id) del ícono equivocado al haber 8 SVG con el mismo id en la página.
const QUICK_LINKS: {
  href: string; label: string; desc: string; color: string; gid: string;
  icon: (c: string, gid: string) => React.ReactNode; pillIcon: (c: string) => React.ReactNode;
}[] = [
  {
    href: "/prueba-de-fuego", label: "Day Trading", desc: "Charts, setups and execution.", color: "#34d399", gid: "dt",
    icon: (c, k) => {
      const light = shade(c, 0.55), deep = shade(c, -0.55);
      return (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id={`${k}-body`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={light} /><stop offset="100%" stopColor={c} />
            </linearGradient>
          </defs>
          <line x1="4" y1="20" x2="4" y2="12" stroke={deep} strokeWidth="1.6" strokeLinecap="round" />
          <rect x="2.5" y="14" width="3" height="4" rx="0.9" fill={`url(#${k}-body)`} />
          <line x1="11" y1="20" x2="11" y2="9" stroke={deep} strokeWidth="1.6" strokeLinecap="round" />
          <rect x="9.5" y="11" width="3" height="5" rx="0.9" fill={`url(#${k}-body)`} />
          <line x1="18" y1="18" x2="18" y2="4" stroke={deep} strokeWidth="1.6" strokeLinecap="round" />
          <rect x="16.5" y="6" width="3" height="6" rx="0.9" fill={`url(#${k}-body)`} />
          <path d="M2 19l6-6 5 2 7-11" stroke="#fff" strokeOpacity="0.92" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M17 4h3v3" stroke="#fff" strokeOpacity="0.92" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    },
    pillIcon: (c) => (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round">
        <path d="M6 20V14M12 20V9M18 20V4" />
      </svg>
    ),
  },
  {
    href: "/ideas", label: "Ideas", desc: "High probability plays and watchlist.", color: "#fbbf24", gid: "id",
    icon: (c, k) => {
      const dark = shade(c, -0.35);
      return (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <defs>
            <radialGradient id={`${k}-glass`} cx="40%" cy="32%" r="70%">
              <stop offset="0%" stopColor="#fff8e1" /><stop offset="45%" stopColor={shade(c, 0.5)} /><stop offset="100%" stopColor={c} />
            </radialGradient>
            <linearGradient id={`${k}-base`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#cbd5e1" /><stop offset="100%" stopColor="#64748b" />
            </linearGradient>
          </defs>
          <path d="M12 3a6.2 6.2 0 00-3.7 11.2c.7.55 1.2 1.35 1.2 2.3h5c0-.95.5-1.75 1.2-2.3A6.2 6.2 0 0012 3z" fill={`url(#${k}-glass)`} stroke={dark} strokeWidth="0.5" />
          <path d="M10 9.6c0-1.1.9-2 2-2" stroke="#fff" strokeOpacity="0.85" strokeWidth="1" strokeLinecap="round" />
          <rect x="9.3" y="17.1" width="5.4" height="2" rx="0.6" fill={`url(#${k}-base)`} />
          <path d="M9.6 19.5h4.8M10 21h4" stroke="#94a3b8" strokeWidth="1" strokeLinecap="round" />
        </svg>
      );
    },
    pillIcon: (c) => (
      <svg width="16" height="16" viewBox="0 0 24 24" fill={c} stroke="none">
        <path d="M12 2l2.9 6.26L21.5 9l-5 4.87L17.8 21 12 17.77 6.2 21l1.3-7.13-5-4.87 6.6-.74z" />
      </svg>
    ),
  },
  {
    href: "/wheel", label: "Wheel", desc: "Cash secured puts strategy.", color: "#c084fc", gid: "wh",
    icon: (c, k) => {
      const light = shade(c, 0.5), dark = shade(c, -0.45);
      return (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id={`${k}-shield`} x1="0" y1="0" x2="0.3" y2="1">
              <stop offset="0%" stopColor={light} /><stop offset="60%" stopColor={c} /><stop offset="100%" stopColor={dark} />
            </linearGradient>
          </defs>
          <path d="M12 3l7 3v5c0 5-3.2 8.5-7 10-3.8-1.5-7-5-7-10V6l7-3z" fill={`url(#${k}-shield)`} stroke={dark} strokeWidth="0.5" />
          <path d="M12 8v8M14.3 10c0-1.05-1-1.9-2.3-1.9s-2.3.85-2.3 1.9 1 1.5 2.3 1.8 2.3.75 2.3 1.9-1 1.9-2.3 1.9-2.3-.85-2.3-1.9" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    },
    pillIcon: (c) => (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 0115-6.7M21 12a9 9 0 01-15 6.7" />
        <path d="M18 3v4h-4M6 21v-4h4" />
      </svg>
    ),
  },
  {
    href: "/flow", label: "Time & Sales", desc: "Real-time flow and volume.", color: "#60a5fa", gid: "ts",
    icon: (c, k) => {
      const light = shade(c, 0.55), dark = shade(c, -0.4);
      return (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id={`${k}-ring`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={light} /><stop offset="100%" stopColor={dark} />
            </linearGradient>
            <radialGradient id={`${k}-face`} cx="40%" cy="35%" r="70%">
              <stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#e2e8f0" />
            </radialGradient>
          </defs>
          <circle cx="12" cy="12" r="9" fill={`url(#${k}-ring)`} />
          <circle cx="12" cy="12" r="7" fill={`url(#${k}-face)`} />
          <path d="M12 8v4.2l3 1.8" stroke={dark} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="1" fill={dark} />
        </svg>
      );
    },
    pillIcon: (c) => (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    href: "/venta-de-primas", label: "Venta de Primas", desc: "Credit spreads de riesgo definido.", color: "#fb923c", gid: "vp",
    icon: (c, k) => {
      const light = shade(c, 0.55), dark = shade(c, -0.45);
      return (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <defs>
            <radialGradient id={`${k}-coin`} cx="38%" cy="32%" r="72%">
              <stop offset="0%" stopColor={light} /><stop offset="55%" stopColor={c} /><stop offset="100%" stopColor={dark} />
            </radialGradient>
          </defs>
          <circle cx="12" cy="12" r="9" fill={`url(#${k}-coin)`} stroke={dark} strokeWidth="0.6" />
          <circle cx="12" cy="12" r="6.6" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.8" strokeDasharray="1.2 2.2" />
          <path d="M12 7.3v9.4M14.3 9.3c0-1-1-1.8-2.3-1.8s-2.3.8-2.3 1.8 1 1.4 2.3 1.7 2.3.7 2.3 1.8-1 1.8-2.3 1.8-2.3-.8-2.3-1.8" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    },
    pillIcon: (c) => (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6.5" cy="6.5" r="2.2" /><circle cx="17.5" cy="17.5" r="2.2" /><path d="M6 18L18 6" />
      </svg>
    ),
  },
  {
    href: "/unusual-swing", label: "Unusual Swing", desc: "Acumulación institucional real.", color: "#f472b6", gid: "us",
    icon: (c, k) => {
      const light = shade(c, 0.55), dark = shade(c, -0.4);
      return (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id={`${k}-spike`} x1="0" y1="1" x2="0.8" y2="0">
              <stop offset="0%" stopColor={dark} /><stop offset="100%" stopColor={light} />
            </linearGradient>
          </defs>
          <path d="M3 19l4-6 4 2.5 4-7 5.5 3.2" stroke={`url(#${k}-spike)`} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="20.5" cy="12.5" r="2.1" fill={light} stroke={dark} strokeWidth="0.6" />
          <path d="M20.3 8.9a4.5 4.5 0 013 3" stroke={light} strokeOpacity="0.55" strokeWidth="1" strokeLinecap="round" fill="none" />
        </svg>
      );
    },
    pillIcon: (c) => (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" /><path d="M10 21a2 2 0 004 0" />
      </svg>
    ),
  },
  {
    href: "/analisis-mercado", label: "Análisis del mercado", desc: "Risk ON/OFF, VIX, Fed y noticias.", color: "#2dd4bf", gid: "am",
    icon: (c, k) => {
      const dark = shade(c, -0.4);
      return (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <defs>
            <radialGradient id={`${k}-globe`} cx="38%" cy="32%" r="75%">
              <stop offset="0%" stopColor={shade(c, 0.55)} /><stop offset="55%" stopColor={c} /><stop offset="100%" stopColor={dark} />
            </radialGradient>
          </defs>
          <circle cx="12" cy="12" r="9" fill={`url(#${k}-globe)`} stroke={dark} strokeWidth="0.5" />
          <ellipse cx="12" cy="12" rx="9" ry="3.6" fill="none" stroke={dark} strokeOpacity="0.55" strokeWidth="0.8" />
          <path d="M12 3c2.3 2.3 3.4 5.4 3.4 9s-1.1 6.7-3.4 9c-2.3-2.3-3.4-5.4-3.4-9s1.1-6.7 3.4-9z" fill="none" stroke={dark} strokeOpacity="0.55" strokeWidth="0.8" />
          <path d="M3.4 12h17.2" stroke={dark} strokeOpacity="0.55" strokeWidth="0.8" />
        </svg>
      );
    },
    pillIcon: (c) => (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h4l2 6 4-12 2 6h6" />
      </svg>
    ),
  },
  {
    href: "/ajustes", label: "Ajustes", desc: "Cookie de MarketSnack y preferencias.", color: "#94a3b8", gid: "aj",
    icon: (c, k) => {
      const light = shade(c, 0.6), dark = shade(c, -0.4);
      return (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id={`${k}-gear`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={light} /><stop offset="100%" stopColor={dark} />
            </linearGradient>
          </defs>
          <path
            d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
            fill={`url(#${k}-gear)`} stroke={dark} strokeWidth="0.4"
          />
          <circle cx="12" cy="12" r="3.4" fill="#0f172a" opacity="0.65" />
          <circle cx="12" cy="12" r="3.4" fill="none" stroke={light} strokeOpacity="0.6" strokeWidth="0.6" />
        </svg>
      );
    },
    pillIcon: (c) => (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round">
        <path d="M4 6h9M17 6h3M4 12h3M9 12h11M4 18h13M19 18h1" />
        <circle cx="12" cy="6" r="1.6" fill={c} stroke="none" />
        <circle cx="7" cy="12" r="1.6" fill={c} stroke="none" />
        <circle cx="17" cy="18" r="1.6" fill={c} stroke="none" />
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
            <div className="hero-quick-badge">{q.icon(q.color, q.gid)}</div>
            <div className="hero-quick-title">{q.label}</div>
            <div className="hero-quick-desc">{q.desc}</div>
            <div className="hero-quick-pill">{q.pillIcon(q.color)}</div>
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
