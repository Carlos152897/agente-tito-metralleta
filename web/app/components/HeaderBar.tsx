"use client";

import { useState } from "react";
import type { CompanyInfo } from "@/lib/types";
import { useLocale } from "@/lib/i18n";
import { pct, px } from "../format";
import BrandMark from "./BrandMark";
import NavTabs from "./NavTabs";
import LanguageSwitcher from "./LanguageSwitcher";

export default function HeaderBar({
  company,
  busy,
  showSearch,
  onSearch,
}: {
  company: CompanyInfo | null;
  busy: boolean;
  showSearch: boolean;
  onSearch: (t: string) => void;
}) {
  const [q, setQ] = useState("");
  const { t } = useLocale();

  const submit = () => {
    const query = q.trim().toUpperCase();
    if (!query || busy) return;
    setQ("");
    onSearch(query);
  };

  return (
    <div className="hb">
      <BrandMark subtitle="AI Options Agent" />
      <NavTabs />
      {showSearch && (
        <input
          className="hb-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={t("header.searchPlaceholder")}
          spellCheck={false}
        />
      )}
      <div className="hb-right">
        {company && (
          <>
            <div className="hb-ticker-name">{company.name ?? company.ticker}</div>
            {company.price != null && <div className="hb-price">${px.format(company.price)}</div>}
            {company.changePercent != null && (
              <div className="hb-chg" style={{ color: company.changePercent >= 0 ? "#12b76a" : "#f04438" }}>
                {pct.format(company.changePercent)}%
              </div>
            )}
          </>
        )}
        <LanguageSwitcher />
      </div>
    </div>
  );
}
