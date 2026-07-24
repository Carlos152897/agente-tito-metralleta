# RSS Feed — Fuentes de noticias

> Fuente: `RSS Feed.pages`

Feeds RSS que el agente debe **monitorear constantemente** (Tarea 7 del [Proceso Principal](Agente%20Principal/Proceso%20Principal.md)) para detectar eventos que afecten al activo y proporcionar noticias relevantes.

## Feeds

| Fuente | Contenido real | URL | Estado |
|--------|----------------|-----|--------|
| CNBC — Top News | Titulares generales (tarifas, tecnología, mercado) | `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114` | ✅ 30 items |
| CNBC — Economía | Fed, inflación, comercio | `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258` | ✅ 30 items |
| CNBC (módulo metadata) | — | `http://search.cnbc.com/rss/2.0/modules/siteContentMetadata` | ❌ **0 items** |
| Investing.com — Earnings | Resultados trimestrales | `https://www.investing.com/rss/news_1062.rss` | ✅ 10 items |
| Investing.com — Macro | Macro/forex internacional | `https://www.investing.com/rss/news_14.rss` | ✅ 10 items |

> **Verificado el 23-jul-2026.** `siteContentMetadata` responde HTTP 200 pero devuelve **cero artículos**: es un módulo/espacio de nombres del estándar RSS de CNBC, no un feed. Se deja documentado como referencia histórica pero **está excluido** de `MACRO_FEEDS` en `web/lib/news.ts`.

## Cómo se usan (dos capas)

Los 5 feeds de arriba son **generales de mercado, no por empresa**: buscando TSLA, lo normal es que ninguno la mencione. Por eso el agente trabaja en dos capas:

1. **Macro** — estos feeds RSS. Contexto que afecta a todos los tickers por igual (Fed, tarifas, inflación). Se cachean 15 min porque el resultado es idéntico para cada búsqueda.
2. **Empresa** — `GET api.massive.com/v2/reference/news?ticker=X`, que además devuelve **sentimiento por ticker con su razonamiento** (`insights[].sentiment` / `sentiment_reasoning`). Cache de 5 min.

**Puente entre ambas:** si un titular de los feeds macro menciona a la empresa (por nombre limpio o por ticker en mayúsculas), se promueve a la capa de empresa y se marca con la etiqueta `RSS · <término>`.

## Bandera de contradicción

Las noticias **no alteran los 100 pts del scorecard** (las 6 categorías ya suman 100%). Entran como una bandera que confronta la dirección del flujo contra el sesgo de las noticias:

| Flujo | Noticias | Bandera |
|-------|----------|---------|
| Alcista | Negativas | ⚠️ **Conflicto** — "alguien compra contra el pánico" |
| Bajista | Positivas | ⚠️ **Conflicto** — "alguien vende contra la euforia" |
| Igual dirección | — | ✓ **Confirmación** — el dinero reacciona, no anticipa |
| Cualquiera neutro/mixto | — | Sin bandera |

El sesgo de noticias se pondera por frescura (≤24h ×1, ≤72h ×0.6, ≤7d ×0.3, más viejo ×0.1) y solo sale de la capa de empresa, que es la única con sentimiento por ticker. Umbral: `|score| ≥ 0.25`.
