# Spec — Lector web "Visionary Trades" (v1)

Fecha: 2026-07-22 · Estado: aprobado, en implementación

## Objetivo

Primer incremento de la web interactiva que lee los datos del **Agente Principal (de Opciones)**.
Un input recibe un **ticker**; la app descarga la option chain desde **Massive**, muestra los
**pasos del proceso en vivo** durante la carga, y presenta una **tabla de detalle** con los
cálculos base del agente (Open Premium y Notional Value).

Cubre las Tareas 1, 2 y 5 del [Proceso Principal](../Agente%20Principal/Proceso%20Principal.md).

## Stack

- **Next.js** (App Router, TypeScript), en `web/`.
- API key en `.env.local` como `MASSIVE_API_KEY` — **solo servidor**, nunca `NEXT_PUBLIC`. En `.gitignore`.
- Progreso en vivo vía **SSE** (Server-Sent Events) desde un route handler.

## Proveedor de datos: Massive

- Base URL: `https://api.massive.com` · Auth: header `Authorization: Bearer <MASSIVE_API_KEY>`.
- Endpoint: `GET /v3/snapshot/options/{ticker}?limit=250`, paginado por `next_url` (cursor).
- Campos usados por contrato: `open_interest`, `day.volume`, `details.strike_price`,
  `details.expiration_date`, `details.contract_type`, `last_trade.price`, `day.close`,
  `underlying_asset.price`.

### Limitación conocida del plan actual
La respuesta **no incluye `last_quote` (bid/ask)** ni greeks (datos DELAYED). La fórmula del
agente pide **Bid** para Open Premium. Como fallback usamos el **precio del contrato**:
`last_trade.price ?? day.close ?? day.vwap`. La UI etiqueta la columna como "Open Premium (px)"
y muestra la fuente del precio. Al contratar un plan con quotes, se sustituye en `lib/compute.ts`
(función `contractPrice`) sin tocar el resto.

## Flujo de datos

1. Usuario escribe ticker → submit.
2. Frontend abre `EventSource` a `GET /api/chain?ticker=XXX`.
3. Servidor emite eventos `step` / `company` mientras:
   1. `Buscando información de {TICKER}…` → fetch de detalles + snapshot → emite evento `company`
      (logo, nombre, exchange, sector, Stock Price, % cambio, market cap, volumen, rango, cierre previo, empleados, descripción).
   2. `Conectando con Massive…`
   3. `Descargando option chain de {TICKER} — página N…` (avanza con `next_url`)
   4. `Consolidando C contratos en E vencimientos…`
   5. `Calculando Open Premium por strike…`
   6. `Calculando Valor Nocional…`
   7. `Ordenando por Open Interest (mayor → menor)…`
4. Servidor emite `done` con `{ rows, meta }`.
5. Frontend: el panel de empresa (logo + info + stats) se pinta en cuanto llega `company`
   (antes que la tabla); la tabla se pinta con `done`. La tabla incluye una fila TOTAL
   con la sumatoria de Open Interest, Volumen, Open Premium y **Notional Value**.

### Endpoints Massive usados
- Option chain: `GET /v3/snapshot/options/{ticker}` (paginado).
- Detalles empresa: `GET /v3/reference/tickers/{ticker}` (nombre, market_cap, exchange, branding/logo, etc.).
- Snapshot acción: `GET /v2/snapshot/locale/us/markets/stocks/tickers/{ticker}` (precio, % cambio, día).
- Logo: se sirve por proxy propio `GET /api/logo?ticker=XXX` para no exponer la API key en el cliente.

## Gráfica Top 5 por Notional (TradingView Lightweight Charts)

- Tras `done`, el frontend pide `GET /api/history?ticker=XXX` (barras diarias del subyacente, ~1 año)
  y calcula el **top 5 contratos por Notional Value**.
- Se renderiza un candlestick del precio con **TradingView Lightweight Charts** (`lightweight-charts`, open source)
  y una **línea horizontal (price line) por cada uno de los top 5 strikes**, con color y etiqueta
  (`#N · tipo strike · notional`). Debajo, una leyenda con contrato, vencimiento, OI, Open Premium y Notional.
- El logo/gráfica se muestran **antes** de la tabla. Endpoint de barras: `GET /v2/aggs/ticker/{ticker}/range/1/day/...`.

## Componentes

| Archivo | Responsabilidad | Depende de |
|---------|-----------------|------------|
| `lib/types.ts` | Tipos `RawContract`, `Row`, eventos SSE | — |
| `lib/compute.ts` | Funciones **puras**: `contractPrice`, `openPremium`, `notionalValue`, `toRow`, `sortByOpenInterestDesc` | — |
| `lib/massive.ts` | Cliente Massive: descarga paginada con callback de progreso | env key, `fetch` |
| `app/api/chain/route.ts` | Orquesta y transmite pasos por SSE | massive, compute |
| `app/page.tsx` | UI: input, lista de pasos en vivo, tabla | — |

## Modelo `Row`

```
{
  ticker, contractType ('call'|'put'), expiration, strike,
  openInterest, volume, price (contractPrice), priceSource,
  openPremium (OI × price), notionalValue (OI × 100 × strike)
}
```

## Tabla de resultados

Columnas: `Vencimiento · Tipo · Strike · Open Interest · Volumen · Precio · Open Premium · Notional Value`.
Orden por Open Interest de mayor a menor. Encabezados ordenables.

## Fórmulas

```
price          = last_trade.price ?? day.close ?? day.vwap
openPremium    = openInterest × price
notionalValue  = openInterest × 100 × strike
```

## Errores

- Ticker vacío/inválido o sin datos → evento `error` + mensaje en UI.
- 401/403 (auth) → "Revisa la API key".
- 429 (rate limit) → "Límite de tasa de Massive, reintenta en unos segundos".
- Contrato sin precio → `openPremium = null`, se muestra `n/a`.
- Tope de seguridad de paginación: `MAX_PAGES` (default 40 ≈ 10k contratos); si se alcanza, la meta lo indica.

## Pruebas

- Unit (vitest) sobre `lib/compute.ts` (funciones puras): cálculos, fallbacks de precio, orden.

## Fuera de alcance (incrementos siguientes)

Tarea 3 (comparación sectorial), Tarea 4 (interpretación muros Buy/Sell), Tarea 6 (liquidez vs "7 Magníficas"),
Tarea 7 (noticias RSS), histórico de 5 días, filtros por vencimiento/strike, greeks/GEX.
