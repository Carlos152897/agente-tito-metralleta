# Sub Agente — Validación de Flows / Confirmación de Precio (categoría 6)

> Fuente: `Sub Agente - De validacion de flows.pdf` · **peso en el scorecard: 15%**
> Pregunta que responde: **¿El precio valida o absorbe el flujo?**

## Objetivo (texto del documento)

Entender **cuánto tiempo ha pasado después de los flows** que hemos analizado dentro de cada tabla y compararlo con el documento **Guía GEx y Predicción de Tito Metralleta**.

Lo que se verifica: cada vez que los diferentes agentes ven un flow, **cuánto tiempo ha tardado en desarrollarse ese movimiento, tanto al alza del contrato como a la baja**.

Esta funcionalidad usa el **backtesting de al menos 60 días** de datos para tener una mejor predicción.

## ⚠️ Este documento no trae tabla de puntos

A diferencia de las otras cinco categorías, el PDF **no define bandas de puntuación**. Las tablas de abajo son una **propuesta** construida con el mismo estilo que las demás, y están aisladas en `validationPoints()` / `speedPoints()` (`web/lib/validation.ts`) para cambiarlas en un solo sitio cuando el documento las defina.

### Parámetro 1 (propuesto) — Tasa de validación
| Flows confirmados por el precio | Puntos |
|---|---|
| ≥70% | 10 |
| 60-69% | 8 |
| 50-59% | 6 |
| 40-49% | 4 |
| 30-39% | 2 |
| <30% | 0 |

### Parámetro 2 (propuesto) — Velocidad del movimiento
| Mediana de sesiones hasta el movimiento | Puntos |
|---|---|
| ≤2 | 10 |
| 3-5 | 8 |
| 6-10 | 6 |
| 11-15 | 4 |
| >15 | 2 |

**Puntaje de la categoría = promedio de los dos parámetros.**

## Cómo funciona el backtest

Para cada flow guardado se mira hacia adelante en las barras diarias del subyacente:

- **Dirección de la apuesta** — según la tabla del Proceso Principal: comprar call o vender put = alcista; comprar put o vender call = bajista. Las ejecuciones en el medio (`mid`) quedan fuera.
- **MFE / MAE** — excursión máxima **a favor** y **en contra** del contrato, con las sesiones que tardó cada una. Esto es literalmente el "tanto al alza como a la baja" del documento.
- **Validado** = el precio cruzó el umbral a favor **antes** de cruzarlo en contra.
- **Pendiente** = el flow es demasiado reciente para juzgarlo.
- El día del propio flow **no cuenta** (está contaminado por el trade) y no se mira más allá del vencimiento del contrato ni del horizonte de 20 sesiones.

### Umbral adaptativo (decisión de implementación)
Un umbral fijo de 2% **no sirve igual para todos los tickers**: TSLA recorre 4-5% en un día normal, así que casi cualquier flow "se validaría" en la primera sesión y la medición no diría nada — de hecho la primera versión daba mediana = 1 sesión para todos.

El umbral usa el **rango diario típico** (mediana de high-low en %) × 1.5, con piso en 2%. Valores reales medidos: TSLA 5.3% · PLTR 5.9% · NVDA 4.7% · IREN 13.0% · GLD 2.0%.

## Cobertura de datos — limitación real

El documento pide **60 días**. Hoy no se pueden pedir 60 días de flujo a MarketSnack: la paginación camina hacia atrás sobre el tape, y en un día grande (TSLA post-earnings) 2.000 trades de ≥$2M son todos del mismo día.

La solución es el mismo patrón que `chainStore` e `ivStore`: el backtest corre sobre **`data/trades/{TICKER}.json`**, que se acumula hacia adelante en cada búsqueda. El panel avisa cuando la cobertura está por debajo de 60 días.

Cobertura medida al implementar (24-jul-2026): TSLA 27d · NVDA 30d · GLD 36d · PLTR 47d · IREN 50d.

## Implementación

`web/lib/validation.ts` (puro, tests en `validation.test.ts`) + ruta `web/app/api/validation/route.ts` + panel `web/app/components/ValidationCard.tsx`.
