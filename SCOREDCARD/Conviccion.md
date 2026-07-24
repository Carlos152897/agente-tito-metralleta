# Sub-agente 2 — Convicción (Time & Sales)

> Fuente: `Conviccion.pdf` · Categoría 2 del [Options Flow Scorecard](Options-Flow-Scorecard.md) (peso 20%)

## Objetivo

Leer el Time & Sales de la empresa para medir **qué tan decidido y de calidad es el flujo**:
dónde se mueve el *Smart Money*, hacia qué lado se ejecuta y con cuánta agresividad.

Responde la pregunta del scorecard: **¿Cuánto dinero real entró?**

---

## 1. Spread

**Definición:** la diferencia entre el Bid y el Ask, expresada en **porcentaje** sobre el mid.

```
spread % = (ask − bid) / ((ask + bid) / 2) × 100
```

**Clasificación:**

| Spread | Puntos |
|--------|--------|
| Menor de 2% | **10** |
| 2% a 5% | **7** |
| 5% a 10% | **4** |
| Más de 10% | **Separar aparte** |

> Los spreads > 10% **no entran al promedio**: se apartan. Si además la transacción
> **excede $1M**, se genera una **alerta en la interfaz** para analizarla con mayor profundidad.

Un spread estrecho indica una opción líquida y un precio confiable; uno ancho significa que
el precio de ejecución es poco fiable (se paga mucho de más solo por entrar).

---

## 2. Dominancia ASK vs BID

Mide **hacia qué lado se ejecuta la mayoría de las transacciones** (ponderado por dinero).

**Ejemplo:** si el 80% del volumen se ejecuta en el Ask y el 20% en el Bid, hay una clara
dominancia hacia el lado comprador.

| % en un solo lado | Puntos |
|-------------------|--------|
| 80%+ | **10** |
| 70–79% | **8** |
| 60–69% | **6** |
| 55–59% | **4** |
| 50–54% | **2** |
| Menos de eso | **0** |

**Interpretación direccional:**
- ↑ 80% en Ask = **presión compradora**
- ↓ 80% en Bid = **presión vendedora**

---

## 3. Fuerza de ejecución

Mide **qué tan agresiva fue la orden**, según dónde se ejecutó respecto al spread Ask/Bid.

| Nivel de ejecución | Puntos |
|--------------------|--------|
| **Above Ask / Below Bid** | **10** |
| **At Ask / At Bid** | **8** |
| **Cerca del Ask o del Bid** | **6** |
| **Mid** | **3** |
| **Sin claridad** | **0** |

> **Nota importante:** aquí el score mide la **fuerza** de la ejecución; la **dirección** se
> etiqueta por separado: Ask = *bullish* / Bid = *bearish*.

"Cerca del borde" = el precio cayó dentro del 20% del ancho del spread desde el ask o el bid.

---

## Nota — ventana, guardado y estado del contrato

> Revisar **todas las transacciones de los últimos 30 días** y **guardarlas**, junto con las que
> se vayan categorizando. Además, identificar si el contrato **ya expiró o no**, comparando su
> vencimiento con **el día de hoy**.

Implementación:
- **Ventana de 30 días:** el agente pagina el flujo hacia atrás hasta cubrir 30 días
  (piso de $1M para que sea rápido; ~713 trades en TSLA).
- **Guardado:** cada corrida fusiona lo analizado en `web/data/trades/{TICKER}.json`
  (dedupe por id de trade, se conserva el análisis completo: scores, flags y estado).
  Así el agente acumula historial y puede ir ajustando.
- **Estado del contrato:** se compara el vencimiento con **la fecha del mercado (ET)**, no la UTC
  — después de las ~8 PM ET el día UTC ya cambió y los vencimientos se reportarían mal.
  Estados: `Vigente` · `Expira hoy` · `Expirado` (fila atenuada) · `—` si el símbolo no es OCC válido.
- La tabla permite **filtrar** por Todas / Vigentes / Expirados.

## Score final de la categoría

```
Convicción (0-10) = promedio de los 3 sub-scores
                  = (spread + dominancia + fuerza de ejecución) / 3
```

Spread y fuerza de ejecución se **ponderan por premium** (los trades grandes pesan más);
la dominancia se calcula sobre el premium total de cada lado.

---

## Implementación

- Lógica pura en `web/lib/flow.ts`: `spreadPct`, `spreadScore`, `dominanceScore`,
  `executionLevel`, `executionScore`, `convictionScore`.
- Panel visual en `web/app/components/ConvictionCard.tsx` (3 métricas + barra de niveles
  de ejecución + alerta de spreads anchos).
- Tests en `web/lib/flow.test.ts`.
- Datos: `bid_price`, `ask_price`, `price`, `side` y `premium` del flujo de MarketSnack.
