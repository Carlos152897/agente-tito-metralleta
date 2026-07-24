# Proceso Principal — Agente de Opciones

> Fuente: `Proceso Principal.pdf`

## Objetivo

El objetivo principal del **agente de Opciones** es identificar operaciones de mercado actuales o históricas para proporcionar contexto sobre la **actividad inusual** en el mismo.

## Tareas fundamentales

### 1. Open Interest por vencimiento
Consultar el Open Interest de cada fecha de vencimiento y filtrar los resultados de **mayor a menor**.

### 2. Volumen y datos históricos
Identificar el **volumen más alto** por fecha de expiración.

Además, el agente deberá **almacenar al menos 5 días de datos históricos** de todas las fechas de vencimiento para detectar **patrones de volumen recurrentes**.

### 3. Comparación sectorial vs. individual
Al buscar una empresa en una categoría específica, el agente debe:
- Identificar las **5 empresas líderes** de dicho sector.
- Comparar flujos similares para determinar si la actividad es **sectorial o individual**.
- Utilizar una **etiqueta adicional** para resaltar este hallazgo.

### 4. Interpretación de compra/venta de Call y Put
El agente debe distinguir con precisión entre la compra y venta tanto de opciones Call como Put:

| Operación | Interpretación |
|-----------|----------------|
| **Buy Call** (Compra) | Postura usualmente **direccional** (alcista). |
| **Sell Call** (Venta) | Funciona como **resistencia**; órdenes de gran magnitud pueden indicar la formación de un **"muro"**. |
| **Buy Put** (Compra) | Puede ser **cobertura (hedge)** o **direccional** → requiere **validación de contexto con otros agentes**. |
| **Sell Put** (Venta) | Actúa como **nivel de soporte** para el activo subyacente. |

### 5. Segmentación de la información (fórmulas)
Para facilitar la comprensión del contexto, la información debe segmentarse así:

**A. Premium abierto por strike**
```
Open Interest × Precio del Contrato (usar Bid) = Open Premium
```

**B. Valor Nocional**
Crucial para identificar **zonas de relevancia** cuando un contrato expira **ITM** (In The Money).
```
Open Interest × 100 × Precio de Ejercicio (Strike) = Notional Value
```

### 6. Evaluación de liquidez del Option Chain
Comparar el **valor nocional promedio de los últimos 5 días** de las **"7 Magníficas"** con la cadena consultada.

**Reglas de alerta** — el sistema emitirá una alerta indicando que los datos podrían **no ser fiables** si:
- Existe una **disparidad de liquidez del 20% al 40%** respecto a los líderes, **o**
- La liquidez es **inferior al 60%** del promedio.

### 7. Monitoreo de noticias (RSS)
Monitorear constantemente el **feed RSS referenciado** (ver [RSS Feed](../RSS%20Feed.md)) para detectar eventos que afecten al activo y proporcionar **noticias relevantes** de la empresa en el panel de resultados.
