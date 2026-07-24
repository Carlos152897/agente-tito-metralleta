# Vista Simple para estudiantes — Diseño

**Fecha:** 2026-07-24
**Objetivo:** La web (`web/`) es hoy demasiado densa para principiantes. Convertir la vista
por defecto en algo que un estudiante novato entienda de un vistazo, sin perder nada: todo
lo actual se reubica en un cajón "Avanzado".

## Problema

`app/page.tsx` pinta ~20 paneles densos (Sentiment, Prediction Pro, Activity, MoneyFlow,
Levels, News, ProWalls, GexHeatmap, TradesFeed + `<details>` con todos los sub-agentes).
Los estudiantes solo quieren: **¿sube o baja?**, **¿a qué precios?**, **¿qué probabilidad?**,
y **verlo moverse**. La jerga (GEX, gamma, notional) los pierde.

## Principio de diseño

**No se toca `lib/` ni la lógica de datos ni los streams.** Todo lo que la vista simple
necesita YA está calculado:

- `ProPrediction` (lib/prediction.ts): `direction` (up/down/flat), `summary` (frase en
  lenguaje llano), `confidence`, `caveat`, y 3 escenarios `bear/base/bull` con `target`,
  `changePct`, `probability`, `driver`.
- `LevelsReport` (lib/levels.ts): `supports[]` / `resistances[]` con `price`, `kind`,
  `strength`, `distancePct`, `why`; más `keySupport` / `keyResistance`.
- `expectedMove.ts`: `conePoints` (cono 1σ/2σ) y `predictionPath` (ruta al nodo imán,
  recortada a 2σ).
- `gex.lowLiquidity` + `prediction.caveat`: salvaguarda de liquidez.

El trabajo es **re-empaquetar** esa data en una vista limpia + **un** componente nuevo de
chart animado.

## Layout de la vista simple (por defecto, con resultados)

```
HeaderBar                     (sin cambios — logo, pills, búsqueda, precio)
│
├─ 1. VeredictoCard           frase grande + flecha ↑/↓/→ + confianza
│      "📈 Probablemente sube hacia ~$305 · confianza media"
│      Si ilíquida → "⚠ Datos no fiables — no operar" (usa prediction.caveat / lowLiquidity)
│
├─ 2. SimpleChart (NUEVO)     velas + niveles + línea de simulación
│
├─ 3. NivelesSimples          tabla mínima: precio · tipo · probabilidad · distancia
│
├─ 4. ContextoLinea           chip de noticias (sesgo + bandera de contradicción)
│
├─ 5. HorizonteSelector       "Esta semana / 2 semanas / 1 mes" → 10 / 20 / 30 días
│                              default = 2 semanas (20 días)
│
├─ disclaimer                 "no es consejo financiero" (se mantiene)
│
└─ ▸ Avanzado (<details> colapsado)
       TODO el contenido actual sin cambios: Sentiment, Prediction Pro, Activity,
       MoneyFlow, ProWalls, GexHeatmap, TradesFeed, y "Detalle de sub-agentes".
```

## Componentes

### `VeredictoCard.tsx` (nuevo)
- Entrada: `prediction: ProPrediction | null`.
- Muestra `summary` en grande, flecha según `direction`, y `confidence` mapeada a
  "alta / media / baja". Target base = `prediction.base.target`.
- Si `prediction.caveat` (o liquidez baja) → muestra el aviso en rojo y **oculta** la
  predicción direccional.

### `SimpleChart.tsx` (nuevo)
- Lightweight Charts (mismo stack que `ChartPanel` / `ProWallsCard`).
- Velas del subyacente (`bars`).
- Price lines horizontales por cada nivel con `strength ≥ 35`: verde soporte, rojo
  resistencia, con etiqueta `precio · prob%`.
- **Línea de simulación:** overlay que dibuja `predictionPath` (recortada a 2σ) desde
  "ahora" al target base. **Se anima una sola vez al cargar** (trazo progresivo, ~1–1.5s)
  y luego **queda fija**. NO hace loop. Ligera ondulación dentro del cono para que se vea
  "viva" pero honesta.
- Ancla del overlay a la geometría real del chart (`timeScale().timeToCoordinate()` para
  la x de la última vela; `priceScale("right").width()` para el borde), como ya hace
  `ProWallsCard`. Divisor vertical "AHORA".
- Etiqueta visible: "Simulación ilustrativa — no es una predicción exacta".

### `NivelesSimples.tsx` (nuevo)
- Entrada: `levels: LevelsReport`, `prediction` (para las probabilidades por nivel).
- Fusiona soportes + resistencias, ordena por cercanía (`distancePct`), muestra:
  `precio · tipo (soporte/resistencia) · probabilidad de llegar · distancia %`.
- La probabilidad por nivel sale de `prediction.levels` (LevelProb) cuando el strike
  coincide; si no, `probTouch` de expectedMove. Máximo ~6 filas.

### `ContextoLinea.tsx` (nuevo o extraído de NewsCard)
- Chip de una línea: sesgo de noticias del ticker + si contradice al flujo
  (`contradictionFlag`). Reusa la data que ya trae `NewsCard`.

### `page.tsx` (modificado)
- Nueva sección "resultados simples" arriba; **todo el bloque actual** de paneles se
  envuelve dentro del `<details>` "Avanzado". Los `useMemo` (gex, heatmap, prediction,
  levels, etc.) **no cambian** — solo se consumen también desde las tarjetas simples.
- El estado `horizonDays` (ya existe) alimenta tanto la vista simple como Avanzado.

## Reglas de dominio respetadas
- **Liquidez:** cadena ilíquida → veredicto = "no fiable / no operar". Regla prioritaria.
- **Sin jerga** en la vista simple (GEX/gamma/notional viven solo en Avanzado).
- **Español**; disclaimer de "no es consejo financiero" se mantiene visible.
- Sin marcas de competidores en nada visible al estudiante.

## Fuera de alcance (YAGNI)
- No se reescriben cálculos ni sub-agentes.
- No se crea ruta nueva; la vista simple ES la principal.
- No loop de animación (se descartó: dibuja una vez y queda fija).
- No se borra ningún panel; solo se reubican bajo "Avanzado".

## Criterios de éxito
1. Con un ticker cargado, un novato ve en <5s: dirección, precios clave, probabilidad y
   una simulación del movimiento — sin abrir nada.
2. Todo el detalle actual sigue accesible bajo "Avanzado".
3. Cadena ilíquida muestra el aviso en vez de una predicción.
4. `npm test` sigue verde (no se tocó `lib/`).
