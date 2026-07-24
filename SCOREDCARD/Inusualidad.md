# Sub-agente 3 — Inusualidad (Unusual Trades)

> Fuente: `Inusualidad.pdf` · Categoría 3 del [Options Flow Scorecard](Options-Flow-Scorecard.md) (peso 20%)

## Objetivo

Identificar **transacciones inusuales durante los últimos 30 días**.

**¿Qué es una transacción inusual?** Son transacciones que ocurren con parámetros de **"griegos"
importantes**, los cuales suelen ser utilizados por **grandes instituciones**.

Responde la pregunta del scorecard: **¿Es flujo anormal?**

---

## Tabla de Puntuación (Scoreboard)

Cada trade se puntúa en **6 parámetros** (0-10 cada uno); el **promedio** da su puntaje de
inusualidad.

### Tamaño de Órdenes

| Premium | Puntos |
|---------|--------|
| $100k | 3 |
| $200k – $500k | 5 |
| $500k – $1M | 7 |
| $1M – $5M | 8 |
| Más de $5M | **10** |

### Delta

Se usa el **valor absoluto**: un put de −0.85 es tan direccional como un call de +0.85.

| Delta | Puntos |
|-------|--------|
| 0.80 – 1.00 | **10** |
| 0.70 – 0.79 | 8 |
| 0.60 – 0.69 | 7 |
| 0.50 – 0.59 | 5 |
| Menos de 0.49 | 0 |

### Theta (porcentaje de decaimiento diario)

```
theta % diario = |theta| / precio del contrato × 100
```

| Decaimiento diario | Puntos |
|--------------------|--------|
| Menor a 1% | **10** |
| 1% – 3% | 8 |
| 3% – 5% | 5 |
| Más de 5% | 0 |

Un decaimiento bajo indica posiciones pensadas para sostenerse (institucionales), no lotería.

### Gamma

| Gamma | Puntos |
|-------|--------|
| 0.01 – 0.03 | **10** |
| 0.03 – 0.08 | **10** |
| 0.08 – 0.15 | 8 |
| Mayor de 0.15 | 4 |
| Menor de 0.01 | 2 |

### Condición de Transacción

| Condición | Puntos |
|-----------|--------|
| Single leg | **10** |
| Multi leg | 5 |

Single vs multi leg **no se adivina**: sale del **código de condición OPRA** que trae cada trade
(`trade_condition_id`, catálogo en `/api/trade_conditions`).

**Multi leg:** `MLET` · `MLAT` · `MLCT` · `MLFT` · `CBMO` · `MCTP`
**Single leg:** todo lo demás — incluidos `MESL`/`MFSL`/`MASL`, que se ejecutan *"against single
leg(s)"* y MarketSnack lista en su filtro Single-Leg.

**Transacciones canceladas** (`CANC`, `CNCL`, `CNCO`, `CNOL`) se **descartan por completo** del
flujo: la orden se anuló, así que no cuenta en ningún puntaje ni tabla.

> Nota: existe además una señal separada `simultáneo` (varios contratos del mismo subyacente
> ejecutados en el mismo timestamp). Es informativa y **no** determina multileg.

### Vencimiento

| Días para expirar | Puntos |
|-------------------|--------|
| 320 días | **10** |
| 120 días | **10** |
| 90 días | 8 |
| 60 días | 7 |
| 30 días | 5 |
| Menor de 30 días | 2 |

---

## Score final de la categoría

```
Puntaje del trade (0-10) = promedio de los 6 parámetros
Inusualidad (0-10)       = promedio ponderado por premium de todos los trades
```

Se pondera por premium para que los tickets grandes pesen más que los chicos.
Un trade se **etiqueta como inusual** cuando su puntaje llega a **≥ 7/10** (perfil institucional).

---

## Nota — validación cruzada

> Comparar las transacciones que reportan los otros agentes para verificar la etiqueta (tag)
> de "inusual". Esta validación es **un proceso aparte y no forma parte del scoreboard**.

Implementación: la tabla incluye una columna **Validación** que marca `✓ también en Agresividad`
cuando el mismo trade aparece en el reporte del sub-agente 1. Es solo una verificación visual —
**no altera el puntaje** de la categoría, tal como pide el documento.

---

## Implementación

- Lógica pura en `web/lib/flow.ts`: `orderSizeScore`, `deltaScore`, `thetaScore`, `gammaScore`,
  `legScore`, `expiryScore`, `unusualTradeScore`, `unusualityScore`.
- Panel y tabla en `web/app/components/UnusualityCard.tsx`.
- Tests en `web/lib/flow.test.ts`.
- Datos: `delta`, `gamma`, `theta`, `premium`, `price` y el vencimiento (del símbolo OCC) del
  flujo de MarketSnack, sobre la misma ventana de 30 días que usa Convicción.
