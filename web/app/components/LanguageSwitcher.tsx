"use client";

import { useLocale, type Locale } from "@/lib/i18n";

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  return (
    <select
      className="lang-switch"
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label="Language / Idioma"
    >
      <option value="es">ES Español</option>
      <option value="en">EN English</option>
    </select>
  );
}
