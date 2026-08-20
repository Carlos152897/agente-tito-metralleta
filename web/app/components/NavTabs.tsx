"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n";

// Navegación entre las vistas del agente. Vive en la barra superior de cada
// página para que moverse entre ellas sea un clic, no un enlace perdido.
const TABS = [
  { href: "/", key: "nav.ticker", icon: "📈" },
  { href: "/ideas", key: "nav.ideas", icon: "💡" },
  { href: "/wheel", key: "nav.wheel", icon: "🎡" },
  { href: "/venta-de-primas", key: "nav.ventaDePrimas", icon: "💰" },
  { href: "/flow", key: "nav.timeSales", icon: "⚡" },
  { href: "/prueba-de-fuego", key: "nav.pruebaDeFuego", icon: "🔥" },
  { href: "/unusual-swing", key: "nav.unusualSwing", icon: "🦄" },
  { href: "/analisis-mercado", key: "nav.marketAnalysis", icon: "🌍" },
  { href: "/ajustes", key: "nav.ajustes", icon: "⚙️" },
];

export default function NavTabs({ standalone = false }: { standalone?: boolean }) {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <nav className={`nav-tabs ${standalone ? "standalone" : ""}`} aria-label={t("nav.sections")}>
      {TABS.map((tab) => {
        const on = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`nav-tab ${on ? "on" : ""}`}
            aria-current={on ? "page" : undefined}
          >
            <span className="nav-tab-icon" aria-hidden="true">{tab.icon}</span>
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
