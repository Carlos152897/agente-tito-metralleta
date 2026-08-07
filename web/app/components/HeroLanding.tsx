"use client";

import { useEffect, useState } from "react";
import { timeGreeting } from "@/lib/greeting";
import { isMarketOpen } from "@/lib/marketHours";
import { loadProfile } from "@/app/components/RiskProfileCard";

const CHIP_COLORS = ["#34d399", "#22d3ee", "#fb923c", "#60a5fa", "#c084fc"];
const CHIPS = ["SPX", "SPY", "TSLA", "NVDA", "AAPL"];

export default function HeroLanding({ onSearch }: { onSearch: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [marketOpen, setMarketOpen] = useState(false);
  const [tolerancePct, setTolerancePct] = useState(4);

  useEffect(() => {
    setMarketOpen(isMarketOpen());
    setTolerancePct(loadProfile().tolerancePct);
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
          <img src="/logo.jpeg" alt="" className="hero-wordmark-icon" />
          <div>
            <div className="hero-wordmark-name">
              VISIONARY <span>TRADES</span>
            </div>
            <div className="hero-wordmark-tag">Built different. Built disciplined.</div>
          </div>
        </div>
        <div className={`hero-status ${marketOpen ? "open" : "closed"}`}>
          <span className="dot" />
          Market Overview — {marketOpen ? "Open" : "Closed"}
        </div>
      </div>

      <div className="hero-greeting">{timeGreeting()}</div>
      <div className="hero-tagline">Discipline today. Freedom tomorrow.</div>

      <div className="hero-logo-wrap">
        <img src="/logo.jpeg" alt="Visionary Trades" className="hero-logo" />
      </div>

      <div className="hero-search-row">
        <input
          className="hero-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="What ticker do you want to analyze?"
          spellCheck={false}
        />
        <button className="hero-search-btn" onClick={submit} aria-label="Buscar">
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
          <img src="/logo.jpeg" alt="" />
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
