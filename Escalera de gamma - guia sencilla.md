# Escalera de gamma — guía sencilla (referencia)

> Fuente: `Escalera de gamma - guia sencilla.pdf` (guía de la página /escalera de Horizon Trades, 3 págs.).
> Referencia de diseño para la pestaña **VisionFutura** de Prueba de Fuego (`web/app/prueba-de-fuego/VisionFuturaTab.tsx`).
> Los `.md` son la versión editable; el `.pdf` es el original.

## Para qué sirve
Responde: ¿hacia dónde se posiciona el dinero en las opciones que vencen **hoy (0DTE)**, y dónde es probable que el precio **se frene o se acelere**? SPX por defecto; vale para SPY, QQQ, IWM o cualquier ticker.

## 1. GEX general — ¿el día frena o acelera?
- **Positivo (γ+):** los dealers se cubren comprando cuando baja y vendiendo cuando sube → **frena** el precio, día de rango.
- **Negativo (γ−):** los dealers se cubren a favor del movimiento → **acelera** el precio, día de tendencia o sustos.
- **Flip:** precio donde el GEX cambia de signo. Arriba del flip el precio tiende a frenarse; abajo, a acelerarse.

## 2. Los 4 niveles clave

| Nivel | Qué significa | Cómo se calcula |
|---|---|---|
| **Imán +** | Donde más se posicionan para que suba | Strike cercano con más **compra de calls + venta de puts** |
| **Imán −** | Donde más se posicionan para que baje | Strike cercano con más **venta de calls + compra de puts** |
| **Techo** | Resistencia arriba del precio | Mucha gamma de calls y muchas **calls vendidas** (vender call = resistencia) |
| **Piso** | Soporte abajo del precio | Mucha gamma de puts y muchos **puts vendidos** (vender put = soporte) |

Los imanes solo se buscan cerca del precio: **±70 puntos en SPX**.

## 3. Ventana de volumen
Botones **5 min · 15 min · 30 min · Día**. Por defecto **15 min**: imanes y barras usan solo lo operado en los últimos 15 minutos (lo que pasa *ahora*). "Día" suma toda la sesión.

## 4. La gráfica de strikes
Cada fila es un strike (el más alto arriba; la fila resaltada es el precio).

**Izquierda — POSICIONAMIENTO**
- Barra verde → : se posicionan para arriba (compra de calls + venta de puts).
- Barra morada ← : se posicionan para abajo (venta de calls + compra de puts).
- Línea verde azulada: el precio durante el día.
- Líneas gruesas azul/roja: dónde estuvieron los imanes y desde cuándo.
- Punteadas: techo, piso y flip. Etiquetas en una franja a la derecha para no tapar el precio.

**Derecha — el AGRESOR (quién tiene prisa)**
- ← Ventas: lo vendido pegando al bid. Compras → : lo comprado pegando al ask.
- ▲ ▼: si creció o bajó frente a hace 1 minuto.
- GEX $M: gamma de ese strike en millones. Strike repetido al final.

Posicionamiento = hacia dónde apuestan; agresor = quién tiene más urgencia. **Si coinciden en un strike, la señal es más fuerte.**

## 5. VIX al lado
Tarjeta chica con la misma lectura para el VIX (imanes, techo, piso, flip) en el mismo horario. Sirve para ver si el VIX va a sus niveles mientras SPX va a los suyos. Ojo: en el VIX "compras" = apostar a más volatilidad, que normalmente va con SPX abajo.

## 6. Repetir la sesión (backtesting)
Botón **Repetir sesión**: slider 9:30–16:00, saltos −5m/−1m/−1s/+1s/+1m/+5m, reproducción 1x/10x/60x/300x, barras de compras/ventas por minuto encima del slider. La gráfica muestra todo como estaba en ese instante. Solo se graba mientras alguien tiene la página abierta en la sesión (franja verde bajo el slider).

## 7. Avisos de seguridad
- Si pocos contratos traen gamma real → **"GEX no fiable — no operar con esta lectura"** (alineado con la regla de liquidez/GEX de [Instrucciones y Referencias](Intrucciones%20Referencias.md)).
- Es una lectura del flujo, **no** una recomendación de compra o venta.

## Cómo usarla en 30 segundos
1. GEX general: ¿rango (γ+) o aceleración (γ−)?
2. Precio frente al flip, el techo y el piso.
3. Imanes con la ventana de 15 min: ¿hacia dónde se posicionan ahora?
4. Confirmar con el agresor: ¿hay prisa del mismo lado?
5. Revisar el VIX: ¿confirma o contradice?
6. Al cerrar, repetir la sesión para ver si el precio respetó los niveles.

## Estado en VisionFutura (2026-10-22)
Ya cubierto: GEX general (signo + flip), techo/piso (call/put wall + secundarios), lectura de dealers por flujo ask/bid, VIX con rango esperado, conversión SPY//ES.

Diferencias con esta guía — **decisión de Carlos (2026-10-22): se mantienen a propósito**, VisionFutura queda con su propio cálculo. Esta guía es referencia, no una especificación a seguir al pie de la letra:
- **Imán +/−**: VisionFutura hoy usa el strike con mayor GEX neto +/−; la guía los define por **flujo** (compra calls + venta puts vs venta calls + compra puts) dentro de ±70 pts.
- **Techo/Piso**: la guía exige gamma alta **y** contratos vendidos; VisionFutura los separa (GEX en "Niveles clave", calls/puts vendidos en "Dealers").
- **Ventanas 5/15/30 min/Día**: no implementadas (hoy todo es acumulado del día).
- **Agresor con ▲▼ vs hace 1 min**, **VIX con su propia escalera**, **Repetir sesión** y **aviso "GEX no fiable"**: no implementados.
