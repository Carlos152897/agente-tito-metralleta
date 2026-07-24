# Instrucciones y Referencias

> Fuente: `Intrucciones Referencias.pages`

## Advertencia sobre liquidez y GEX

> **Mucho cuidado con Option Chains no líquidos.** Incluso para la interpretación del **GEX** (Gamma Exposure), el agente **debe avisar** cuando haya problemas de liquidez en la opción **para no operarla**.

### Implicaciones para el agente
- Antes de interpretar flujo o GEX, validar la **liquidez** de la cadena de opciones.
- Si la opción es ilíquida, **marcarla explícitamente** y **no recomendar operarla**.
- Esta regla se enlaza con la **Tarea 6** del [Proceso Principal](Agente%20Principal/Proceso%20Principal.md) (evaluación de liquidez y alertas del 20–40% / <60%).
