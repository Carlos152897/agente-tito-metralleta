# Options Flow Scorecard (rúbrica)

> Fuente: `../REFERENCIAS/Screenshot 2026-07-22 at 9.13.48 PM.png`
> "Cómo nuestro agente IA puntúa a una oportunidad de opciones."

Cada categoría recibe un **AI Score de 0 a 10**, se multiplica por su **peso**, y la suma da el
**Puntaje Total /100**.

| # | Categoría | Pregunta | Peso | Sub-agente / fuente |
|---|-----------|----------|------|---------------------|
| 1 | **Agresividad** | ¿Compran al ask con fuerza? | 20% | Time & Sales (trades + bid/ask) |
| 2 | **Convicción** | ¿Cuánto dinero real entró? | 20% | $ notional / premium de las transacciones |
| 3 | **Inusualidad** | ¿Es flujo anormal? (Vol/OI + Unusual Score) | 20% | Volumen, Open Interest |
| 4 | **Estructura** | ¿Strike/DTE de convicción o lotería? | 15% | Strike vs precio, días a expirar |
| 5 | **Contexto IV** | ¿IV limpia o inflada? | 10% | Implied volatility |
| 6 | **Confirmación de Precio** | ¿El precio valida o absorbe? | 15% | Precio del subyacente vs flujo |

**Puntaje ponderado por categoría** = (AI Score / 10) × (peso × 100).
Ejemplo de la referencia: 16/20 + 14/20 + 18/20 + 12/15 + 6/10 + 10.5/15 = **76.5 / 100**.

## Bandas (guía rápida)

| Rango | Veredicto | Interpretación |
|-------|-----------|----------------|
| 0 – 49 | **Oportunidad Débil** | Alto riesgo / baja convicción |
| 50 – 74 | **Oportunidad Moderada** | Convicción media / revisar filtros |
| 75 – 100 | **Oportunidad Fuerte** | Alta convicción / mejor potencial |

> "Entre más alto el puntaje, mejor la oportunidad."
> "No es consejo financiero. Solo análisis inteligente."

## Cobertura de datos por categoría (plan Massive actual)

| Categoría | Datos requeridos | ¿Disponible? |
|-----------|------------------|--------------|
| Agresividad | trades + **bid/ask** | Trades ✅ · **bid/ask ❌ (no autorizado)** |
| Convicción | premium/$ de trades | ✅ (precio × tamaño de trades) |
| Inusualidad | Vol/OI | ✅ |
| Estructura | strike, DTE | ✅ |
| Contexto IV | IV | ✅ (por contrato) |
| Confirmación de Precio | precio subyacente | ✅ |

**Bloqueador principal:** la categoría *Agresividad* depende de clasificar trades vs bid/ask, y las
quotes NBBO no están autorizadas en el plan actual de Massive. Decisión pendiente con el usuario.
