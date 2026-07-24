# Sub-agente 4 — Acumulación y Rapidez (Estructura)

> Fuente: `Acumulacion-Rapidez.pdf` · Categoría 4 del [Options Flow Scorecard](Options-Flow-Scorecard.md) (peso 15%)

## Objetivo

Identificar el **posicionamiento** y las **fechas de expiración relevantes**. Se analiza la
actividad por cada **precio de ejercicio (strike)** y **fecha de vencimiento**, recorriendo todas
las expiraciones de la empresa.

Responde la pregunta del scorecard: **¿Strike/DTE de convicción o lotería?**

A diferencia de los sub-agentes 1-3 (que leen el flujo de trades de MarketSnack), éste trabaja
sobre la **cadena de opciones completa** que traemos de Massive.

---

## 1. Valor Nocional

```
Valor Nocional = Strike × Open Interest × 100
```

Se agrupa por **strike** (sumando todas las expiraciones y calls/puts) y se toma el **promedio**
de la cadena.

| Rango de Valor Nocional | Puntos |
|-------------------------|--------|
| Mayor a $1B | **10** |
| $500M a $1B | **10** |
| $100M a $500M | 8 |
| $50M a $100M | 6 |
| $25M a $50M | 4 |
| $25M o menos | 2 |

> **Nota:** si el valor nocional promedio es inferior a **$25M** en todos los strikes, se marca
> la cadena como **"Baja Liquidez"** (aviso visible en el panel).

---

## 2. Dominio de Strikes (Calls vs. Puts)

Se verifican los strikes con **mayor actividad** o que posean el **mayor porcentaje del valor
nocional** (se muestran en una tabla aparte). Luego se mide **en cuántos de esos strikes dominan
más los Calls que los Puts, o viceversa** — y se marca cuál lado domina.

| Nº de strikes donde domina un lado | Puntos |
|------------------------------------|--------|
| 5 Strikes | **10** |
| 3 Strikes | 8 |
| 1 Strike | 5 |
| No hay visibilidad | 0 |

**Definición operativa:** se toman los **5 strikes de mayor nocional** (usando el nocional del
paso 1) y se cuenta en cuántos un lado tiene **≥60% del nocional de ese strike**. Ese conteo
puntúa según la tabla. Más strikes con dominio = posicionamiento direccional más claro.

> Ojo: esto **no** mide concentración de nocional, sino **dominancia direccional** calls vs puts
> dentro de cada strike.

---

## 3. Volumen vs. Open Interest

Verifica actividad reciente comparando **cuántas veces el volumen supera al Open Interest**
(señal de posiciones nuevas, no de cierre).

| Porcentaje (Volumen > Open Interest) | Puntos |
|--------------------------------------|--------|
| 100% de los casos | **10** |
| 80% de los casos | 8 |
| 50% de los casos | 8 |
| Entre 30% y 50% | 5 |
| Menos del 30% | 2 |

Solo se consideran contratos con actividad (volumen > 0 u open interest > 0).

---

## Score final de la categoría

```
Estructura (0-10) = (nocional + strikes dominantes + volumen/OI) / 3
```

---

## Salida visual

- **Top strikes por nocional** — con % del total, lado dominante (calls/puts), OI y volumen.
  Las filas amarillas son los **strikes dominantes**.
- **Vencimientos más relevantes** — nocional por fecha de expiración, % del total y el **sesgo**
  (qué % del nocional está en calls vs puts en ese vencimiento).
- Barra calls vs puts de toda la cadena y aviso de **Baja Liquidez** cuando aplica.

---

## Historial de 45 días

El documento pide considerar **un historial de 45 días**. La cadena de opciones de Massive es una
**foto del momento** (OI y volumen actuales); no expone series históricas de open interest, así que
ese historial **no se puede reconstruir hacia atrás**.

**Implementado:** cada análisis guarda una **foto del día de mercado** en
`web/data/chain/{TICKER}.json` — una por fecha ET (si se corre varias veces el mismo día, se
actualiza en vez de duplicar), conservando las últimas **45**. Cada foto guarda score, nocional
promedio, strikes con dominio, % volumen>OI, reparto calls/puts y los 5 strikes principales.

El panel muestra la tabla del historial con la **variación del score día a día** (▲/▼), para ver
cómo se mueve el posicionamiento. El historial se acumula **hacia adelante** desde la primera
corrida.

---

## Implementación

- Lógica pura en `web/lib/structure.ts`: `notionalScore`, `dominantStrikesScore`,
  `volumeOverOIScore`, `structureScore`.
- Panel y tablas en `web/app/components/StructureCard.tsx`.
- Tests en `web/lib/structure.test.ts`.
- Datos: cadena de opciones de Massive (`/api/chain`) — strike, expiración, tipo, open interest,
  volumen y el nocional que ya calcula `lib/compute.ts`.
