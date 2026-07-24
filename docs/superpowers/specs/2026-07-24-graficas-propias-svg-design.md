# Gráficas propias (SVG) para las vistas de predicción

**Fecha:** 2026-07-24
**Alcance:** `SimpleChart` (Estudiante) y `ProWallsCard` (Pro)

## Problema

Las gráficas de predicción usan TradingView Lightweight Charts, que dibuja en canvas
y no expone el layout. Todo lo nuestro —cono 1σ/2σ, ruta esperada, targets, bandas de
muros, divisor "AHORA"— es un overlay HTML posicionado cazando píxeles de la librería
(`priceToCoordinate`, `timeScale().timeToCoordinate()`, `priceScale("right").width()`).

Eso produce tres síntomas concretos:

1. **El futuro va comprimido.** El único aire a la derecha es `rightOffset: 22-26`
   barras. Todo el cono, la ruta y los targets caben en una franja delgada del borde.
2. **Los targets se pisan.** Los chips se posicionan por precio, sin control de
   colisiones, y encima se dibujan sobre el eje de precio de la librería.
3. **Los niveles fuera del rango de las velas se cortan.** El eje lo fija TradingView
   con `fitContent()` sobre las velas, así que un target lejano o el borde del 2σ
   desaparece.

De fondo hay **dos sistemas de coordenadas peleándose**: el canvas de la librería y
nuestro overlay en DOM.

## Solución

Colapsar todo a **un solo sistema**: un `<svg>` propio donde velas, cono, ruta, S/R,
chips y ejes viven en las mismas coordenadas.

### Decisiones tomadas

| Decisión | Elección |
|---|---|
| Alcance | Solo las 2 gráficas de predicción. `FlowPriceChart` y `ChartPanel` siguen con TradingView. |
| Reparto de ancho | **60% histórico / 40% futuro** |
| Targets | **Etiquetas apiladas con anti-colisión** + guía punteada al precio real |
| Interacción | **Crosshair + tooltip**, sin zoom ni paneo |
| Eje de precio | **Encuadre inteligente** (velas + 1σ + targets con peso; el 2σ se recorta) |

### Piezas

| Pieza | Qué hace | Depende de |
|---|---|---|
| `lib/chartGeometry.ts` | Toda la matemática: dominio de precio, escalas x/y, geometría de velas, anti-colisión de etiquetas. Puro, sin React ni DOM. | nada |
| `app/components/chart/PriceChart.tsx` | Todo el dibujo: un SVG responsivo. Presentacional — recibe datos ya calculados, no hace fetch ni análisis. | `chartGeometry` |
| `app/components/chart/ChartCrosshair.tsx` | Capa de interacción: crosshair + tooltip. | `chartGeometry` |

`SimpleChart.tsx` y `ProWallsCard.tsx` conservan su rol (fetch de barras + llamar a
`conePoints` / `predictionPath` / `levelProbabilities`) y pasan el resultado a
`<PriceChart>`. Les desaparece el `useEffect` de lightweight-charts y todo el `geom`.

**Nada de `lib/` cambia.** Ni `expectedMove`, ni `gex`, ni `levels`, ni `prediction`.
Esto es puramente la capa de dibujo.

## `lib/chartGeometry.ts` — API

### `smartDomain(input): PriceDomain`

Encuadre inteligente. Reglas, en orden:

1. Arranca con el rango de las velas (`min(low)` … `max(high)`).
2. Extiende para incluir el spot, las bandas de **1σ** y todo **target con peso real**
   (`weight >= MIN_TARGET_WEIGHT`) y todo nivel S/R que se vaya a dibujar.
3. Intenta extender al **2σ**, pero solo mientras las velas conserven al menos
   `MIN_CANDLE_SHARE` (0.45) de la altura. Si no cabe, el 2σ se recorta y el
   componente lo dibuja con degradado hacia el borde para que se lea "sigue".
4. Añade un padding del 3% arriba y abajo.

Devuelve `{ min, max, clampedTo2Sigma: boolean }`.

### `buildScales(input): Scales`

Reparte el ancho con `futureRatio = 0.4`.

```
plotLeft = padding.left
plotRight = width - gutterRight        // gutterRight reserva chips + eje de precio
xNow = plotLeft + (plotRight - plotLeft) * 0.6
```

Devuelve:

- `xOfIndex(i)` — x del centro de la vela `i` (histórico)
- `xOfFuture(t)` — x de `t` días en el futuro (`t` de 0 a `horizonDays`)
- `yOfPrice(p)` — y del precio, ya recortada al área de dibujo
- `candles: Candle[]` — `{ x, w, yOpen, yClose, yHigh, yLow, up }`
- `xNow`, `plotLeft`, `plotRight`, `plotTop`, `plotBottom`

El histórico se recorta a las velas que caben en el 60% con ancho mínimo legible
(`MIN_CANDLE_W = 3px`): si sobran, se quedan las más recientes.

### `packLabels(items, opts): PackedLabel[]`

Anti-colisión de chips. Cada item entra con su `y` ideal (el precio real).

1. Ordena por `y`.
2. Barrida hacia abajo: si un chip solapa al anterior, se empuja `labelH + gap`.
3. Barrida hacia arriba desde el fondo: si el último se sale del alto, se empujan
   todos hacia arriba en cascada.
4. Recorta al área de dibujo.

Devuelve `{ ...item, y, yAnchor }` donde `y` es la posición del chip y `yAnchor` el
precio real — la guía punteada va de uno a otro.

## `PriceChart.tsx` — contrato

```ts
interface PriceChartProps {
  bars: TfBar[];
  spot: number;
  horizonDays: number;
  cone?: ConePoint[];
  path?: PredictionPath | null;
  targets?: ChartTarget[];      // { price, label, sublabel, side, weight }
  srLevels?: ChartLevel[];      // { price, kind, strength }
  theme: "light" | "dark";
  height: number;
  animatePath?: boolean;        // trazo progresivo (Estudiante)
  showCone1?: boolean;          // 1σ además del 2σ (Pro)
  showBands?: boolean;          // bandas de heatmap por target (Pro)
}
```

Capas del SVG, en orden de pintado:

1. Grid horizontal + eje de precio (en el gutter derecho)
2. Tinte del área futura + divisor "AHORA"
3. Bandas de heatmap por target (solo Pro)
4. Cono 2σ, cono 1σ
5. Líneas S/R punteadas
6. Velas
7. Ruta esperada
8. Guías punteadas chip → precio
9. Chips de target
10. Crosshair (capa de interacción)

Responsivo por `ResizeObserver` sobre el contenedor → un único `useState({ w, h })`.

## Dimensiones

- Alturas responsivas en vez de `380`/`460` fijos:
  - Estudiante: `clamp(300px, 40vh, 420px)`
  - Pro: `clamp(340px, 46vh, 520px)`
- Padding interno: `top 16 / bottom 28 / left 8`, y `gutterRight = 132px` reservado
  para chips + eje de precio. **Este gutter es lo que hoy no existe** y causa la mitad
  del amontonamiento.
- El divisor "AHORA" pasa a ser elemento de primera clase: línea + etiqueta, con el
  área futura levemente tintada para leerse como zona distinta.

## Skins

Un componente, dos temas por prop.

**Estudiante (claro):** velas verde `#12b76a` / rojo `#f04438`, cono 2σ tenue en azul
`--accent`, ruta azul con trazo progresivo (`stroke-dashoffset`, se dibuja una vez),
solo el target principal + S/R con `strength >= 20`. Menos capas a propósito.

**Pro (oscuro):** velas frías (`#e3ecfb` / `#7f8db0`), bandas dorado `rgba(212,160,23)`
para muros de calls y morado `rgba(124,110,228)` para muros de puts, cono 1σ + 2σ en
ámbar `#f5c542`, hasta 8 targets con su probabilidad, S/R punteados con
`strength >= 35`.

## Tests

`lib/chartGeometry.test.ts`:

- `buildScales` reparte 60/40 y `xNow` cae donde debe.
- El histórico se recorta cuando no caben todas las velas, conservando las recientes.
- `smartDomain` incluye un target lejano con peso, e ignora uno sin peso.
- `smartDomain` recorta el 2σ cuando aplastaría las velas por debajo del 45%.
- `packLabels`: dos targets al mismo precio salen separados al menos `gap`.
- `packLabels`: ningún chip se sale del área de dibujo, ni con 10 targets apiñados.
- `packLabels` conserva `yAnchor` en el precio real.

Verificación visual en el dev server. Bonus: al ser SVG y no canvas, desaparece la
limitación anotada en CLAUDE.md de que las gráficas salen negras en los screenshots.

## Fuera de alcance

- `FlowPriceChart` y `ChartPanel` siguen con lightweight-charts, así que la dependencia
  se queda en `package.json`. Conviven dos lenguajes visuales hasta que se migren.
- La densidad general de la página (espaciado entre cards) es un trabajo aparte.
