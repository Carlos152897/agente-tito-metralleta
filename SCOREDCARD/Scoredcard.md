# Scorecard y Sub-Agentes

> Fuente: `Scoredcard.pdf`

## Propósito

Detallar el funcionamiento del **scorecard** y la función de los **sub-agentes** encargados de
buscar la información pertinente. En esta sección se definen los agentes, sus funciones específicas
y las categorías correspondientes.

## Sub-agente 1 — Time & Sales (categoría: Agresividad)

**Time & Sales** representa la **agresividad** dentro del scorecard.

El sub-agente debe:
- Revisar **cada contrato** junto con las **compras y ventas** que están ocurriendo en los
  **últimos 5 días** y el **día de la búsqueda**, y devolver las **transacciones** de esa opción.
- Permitir que el usuario busque el **contrato individual** o escriba la **empresa**.
- Encontrar las **transacciones más altas** de ese option chain durante el día de búsqueda y los
  últimos 5 días.
- **Almacenar** esta información en algún lugar para que el agente la vaya ajustando.
- Determinar si la transacción ocurrió en el **ask** o en el **bid**.
- En una **tabla aparte (pequeña)**, listar las transacciones y **marcar** las que se deben investigar
  o parecen interesantes, para pasarlas al **próximo agente**.

### Criterios de selección (transacciones de interés)

- Transacciones **repetidas** en un intervalo de **5 minutos**.
- Volumen monetario **superior a $1M**.
- Volumen **superior a $100,000 con Delta > 0.60**.
- Transacciones ejecutadas **Above Ask** o **Below Bid**.
- **Prioriza LEAPs** (320, 120 y 90 días) frente a opciones de 30 días.
- **Nota:** descarta transacciones en el **Mid**.
- Etiqueta simultáneas como **Multileg**, y volúmenes que superen el Open Interest como
  **Exceeded Open Interest**.

### Sistema de Puntuación (Scoring System)

Genera una tabla con el análisis de cada trade. **Resalta en amarillo** los trades con puntajes
inusuales. Cada trade recibe 3 sub-scores (0-10) que suman un **total /30**:

**A. Puntuación por Volumen (nº de contratos)**

| Contratos | Puntos |
|-----------|--------|
| 150+ | 10 |
| 100 | 8 |
| 50 | 6 |
| 20 | 4 |
| < 20 (pero > $500k) | 1 |

**B. Puntuación por Momento (horario ET)**

| Horario | Puntos |
|---------|--------|
| Mediodía (11:00 AM – 1:00 PM) | 10 |
| Apertura (9:30 – 10:30 AM) | 7 |
| Cierre (3:00 – 4:00 PM) | 6 |
| Otros horarios | 3 |

**C. Puntuación por Repetición (mismo strike)**

| Frecuencia | Puntos |
|------------|--------|
| 3+ repeticiones | 10 |
| 2 repeticiones | 7 |
| 1 sola orden | 4 |
| Sin patrón claro | 1 |

**Volumen relativo** (para futura implementación):
`Volumen relativo = Volumen observado / Volumen promedio durante esa hora o esos días.`

### Salida

Con esa información, extraer los datos para **pasarlos al próximo agente**.

Implementado en `web/lib/flow.ts` (`volumeScore`, `timingScore`, `repetitionScore`, `scoreRows`,
flag `exceededOI`) y mostrado en la tabla del dashboard (columnas Vol/Hora/Rep/Score, filas
inusuales en amarillo). Tests en `web/lib/flow.test.ts`.

---

## Fuente de datos: MarketSnack (resuelto — 2026-07-22)

El bid/ask que Massive no autoriza **lo provee MarketSnack** (producto propio), que ya ingiere el
flujo de opciones con clasificación de agresividad. Es la fuente del sub-agente Time & Sales.

**Endpoint interno:** `GET https://app.marketsnack.com/api/flow_feed`
- Params: `filter[scope]=all` (requerido) · `filter[symbol][]=<TICKER>` · `period=5d` (1d/5d/1m) ·
  `next_page_token=<token>` (paginación; el token viene en `meta.next_page_token`).
- **Auth:** cookie de sesión (`MARKETSNACK_COOKIE` en `web/.env.local`). Caduca → refrescar.
- Respuesta: `{ list: [...trades], meta: { next_page_token } }`.

**Campos por trade:** `price`, `size`, `side` (`ABOVE_ASK`/`ASKSIDE`/`AT_ASK` / `MIDMKT` /
`AT_BID`/`BIDSIDE`/`BELOW_BID`), `bid_price`/`ask_price` (+ sizes), `premium`, `delta` + greeks,
`implied_volatility`, `open_interest`, `volume`, `score`, `sentiment`, `timestamp`, `symbol` (OCC).

Cubre TODO el scorecard: agresividad (side), convicción (premium), inusualidad (vol/OI/score),
estructura (parseo OCC → strike/DTE), IV, y los flags de "interesante" (≥$1M, ≥$100K & |Δ|>.60,
above ask/below bid, repetidas 5min, multileg). Implementado en `web/lib/{marketsnack,flow,occ}.ts`
y la vista `web/app/flow/`.
