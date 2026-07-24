# GEX Concentration Nodes + Predicción · PRO Chart — Diseño

**Fecha:** 2026-07-23
**Objetivo:** Convertir la gráfica PRO en un **mapa de nodos** que fusiona posicionamiento
gamma (GEX de la cadena de Massive) con los **trades reales** que están ocurriendo, y usar
el nodo de mayor concentración como **predicción** (precio imán). Además, marcar con una
**burbuja 🔁** los trades repetitivos en las tablas.

> Nota de marca: usar SIEMPRE términos neutros en español (Nodo principal, Zona de inversión
> gamma, Nodo imán). **Prohibido** cualquier nombre o terminología de productos de terceros.

## 1. Motor GEX — `lib/gex.ts` (puro, con tests)

Massive da strike, Open Interest y spot de **toda la cadena**, pero **no** gamma ni IV. Por eso:

- **`estimateIV(bars)`** — volatilidad realizada anualizada de los retornos log diarios
  (ventana ~20 sesiones, ×√252). Fallback 0.4 si hay pocas barras.
- **`bsGamma(spot, strike, T, iv)`** — gamma de Black-Scholes: `φ(d1) / (spot·iv·√T)`,
  con `d1 = [ln(spot/strike) + (iv²/2)·T] / (iv·√T)`, `r = 0`. T = DTE/365.
- **GEX por contrato** = `sign · gamma · OI · 100 · spot² · 0.01`, con `sign = +1` para
  calls y `−1` para puts (convención de gamma de dealer).
- **Anclaje**: donde un strike tiene gamma real de MarketSnack, se mezcla la estimada con la
  real (promedio) para no alejarse de la realidad.
- **Concentración de dinero por strike** = `norm(|GEX|)` combinado con `norm(premium de trades
  reales en ese strike)` (60/40). Refleja posicionamiento **y** actividad viva.

Deriva:
- **`flipStrike`** — nivel donde el GEX neto acumulado (ordenado por strike) cambia de signo:
  frontera de régimen (zona de inversión gamma).
- **`kingStrike`** — strike de mayor concentración → **precio objetivo (imán)**.
- **`regime`** — signo del GEX neto total: `+` = gamma positiva (rango, revierte a la media),
  `−` = gamma negativa (tendencia, amplifica).
- **`confidence`** (0-100) — nitidez de la concentración (share del nodo principal) mezclada
  con los **scores de sub-agentes** (Convicción/Estructura).
- **`nodes[]`** — por strike cerca del spot (±20%): `{ strike, netGex, callGex, putGex,
  tradePremium, tradeCount, concentration (0-1), side }`.
- **`lowLiquidity`** — hereda la salvaguarda: si la cadena es ilíquida, marcar la predicción
  como **no fiable** (regla crítica de CLAUDE.md).

Tests en `lib/gex.test.ts`: bsGamma monotonía/pico ATM, signo del GEX por lado, detección de
flip, king node, IV realizada, robustez con cadena vacía.

## 2. Gráfica PRO — `app/components/ProWallsCard.tsx`

- Mantiene las velas.
- **Nodos**: overlay HTML de círculos en el borde derecho, posicionados por precio con
  `series.priceToCoordinate(strike)` (se recolocan en `subscribeVisibleLogicalRangeChange`
  + `ResizeObserver`). **Radio ∝ concentración**, **color verde = γ+ (imán/estabiliza) /
  rojo = γ− (amplifica)**. Etiqueta: strike · GEX neto · split call/put · premium · # trades.
- **Nodo principal (imán)**: aro con brillo + etiqueta "🎯 Objetivo $X".
- **Zona de inversión gamma**: línea punteada en `flipStrike` + banner de régimen
  ("Gamma positiva — rango / revierte" vs "Gamma negativa — tendencia / amplifica").
- **Nota honesta**: "primero la estructura del precio; el GEX confirma" + aviso de baja
  liquidez cuando aplique.

Recibe (nuevas props): `chainRows: Row[]`, `bars`, `flowRows: FlowRow[]`, `scores` (conviction,
structure). El cálculo GEX se hace en `page.tsx` (una vez) y se pasa el `GexAnalysis`.

## 3. Predicción real — `app/components/PredictionCard.tsx`

Wire del `GexAnalysis`: precio objetivo = `kingStrike`, dirección vs spot (↑/↓/→),
confianza = `confidence`. Si `lowLiquidity`, mostrar "no fiable" en vez de un número.

## 4. Burbujas de repetición en las tablas

Componente `RepeatBadge` (`🔁 ×N`) en las filas con `flags.repeated` (misma definición:
mismo strike ≥3× en ventana de 5 min). Se agrega a:
- `TradesFeed.tsx` (feed principal)
- `ConvictionTransactions.tsx`
- `UnusualityCard.tsx`

CSS: `.node`, `.node-king`, `.node-label`, `.repeat-badge` en `globals.css`.

## Fuera de alcance (YAGNI)
- VEX (vega exposure), replay, multi-ticker, decaimiento por toques repetidos (solo se
  menciona en la confianza, no se modela por-toque).
