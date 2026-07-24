# Sub Agente — Contexto IV (categoría 5)

> Fuente: `Sub Agente de Contexto.pdf` · **peso en el scorecard: 10%**
> Pregunta que responde: **¿IV limpia o inflada?**

## Objetivo

Este agente debe **verificar el contexto de movimiento** que pudiese tener la acción. Tiene que recopilar:

1. Cuál es el **promedio de la volatilidad implícita (IV) para las diferentes fechas de expiración**.
2. Cuáles son los **contratos que mayor IV tienen**.

Esto ayuda a identificar que **un movimiento posible está a punto de pasar**, o que la acción **tiene rangos altos de movimiento**.

## Parámetro 1 — Implied Volatility

| IV actual | Puntos |
|-----------|--------|
| +100% | 6 *(categoría especial — por encima del objetivo)* |
| 90%-99% | 5 |
| 61%-89% | 8 |
| **40%-60%** | **10** |
| 30%-39% | 5 |
| Menos de 30% | 2 |

> **La curva tiene su pico en la IV moderada (40-60%), no en la alta.** Ahí hay movimiento esperado y la prima todavía es razonable. Por encima se castiga porque comprar volatilidad cara pierde aunque el precio acompañe (IV crush); por debajo se castiga porque no se espera movimiento ninguno.

## Parámetro 2 — IV Rank

Necesitamos entender la **procedencia** de la acción: si el movimiento se está **comprimiendo o aumentando**. El IV Rank permite visualizar el IV histórico para determinar si existe movimiento. **Se compara contra el Current IV.**

| IV Rank | Puntos |
|---------|--------|
| 0%-15% | 2 |
| **16%-30%** | **10** |
| 31%-50% | 8 |
| 51%-70% | 5 |
| 71%-99% | 1 |
| 100% | 0 |

> Pico en 16-30%: IV comprimida pero despertando. Por debajo de 15 la acción está **dormida**; de 71 en adelante la volatilidad ya está **estirada** y queda poco recorrido.

**Puntaje de la categoría = promedio de los dos parámetros** (igual que las demás).

## Implementación

`web/lib/ivcontext.ts` (puro, tests en `ivcontext.test.ts`) + `web/lib/ivStore.ts` + panel `web/app/components/IvContextCard.tsx`.

### De dónde sale la IV
**MarketSnack**, campo `implied_volatility` por trade — en **decimal** (`0.477` = 47.7%); el módulo trabaja siempre en porcentaje. Massive no entrega IV en este plan.

### IV representativa
Promedio **ponderado por premium** de los trades de la ventana de 30 días. Un promedio simple lo dominarían los cientos de tickets pequeños de 0DTE; ponderando, la IV que se puntúa es aquella a la que **entró el dinero de verdad**. El promedio simple se muestra al lado para comparar.

### IV Rank — dos fuentes
El IV Rank real necesita 52 semanas de IV histórica y **ninguna fuente nos la vende**. Por eso:

1. **Proxy (hoy):** rank de la **volatilidad realizada** de 30 días del subyacente dentro de su rango de 1 año (`realizedVolSeries`). Es calculable con las barras diarias que ya bajamos.
2. **Real (se acumula):** `ivStore.ts` guarda una foto diaria de la IV en `data/iv/{TICKER}.json` (una por fecha de mercado ET, ventana 365 días). Al llegar a **60 días** (`MIN_IV_HISTORY_DAYS`) el rank real **reemplaza automáticamente** al proxy.

El panel dice siempre cuál de las dos está usando.

### Extras derivados
- **Skew del frente:** IV del vencimiento más cercano menos el promedio del resto. Si es > +10 puntos, el mercado está pagando por un **evento inminente**.
- **Régimen:** cruza el nivel de IV con su posición histórica → `dormida` (rank <16) · `compresion` (16-30) · `normal` (31-70) · `expansion` (≥71) · `inflada` (IV ≥100%).

### Detalles de las tablas
El documento deja huecos entre bandas (89→90 en IV, 99→100 en rank). Se resuelven por umbral inferior: `≥90` cae en "90-99", `89.5` cae en "61-89"; `≥100` es la categoría especial.
