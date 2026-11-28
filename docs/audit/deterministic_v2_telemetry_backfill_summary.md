# Backfill de telemetría Gemma 4 — muestra estratificada

Generado: 2026-11-28T13:32:39.531Z

**Estado:** completado (todas las configuraciones E2B pendientes y sondeos VRAM E4B finalizados; pausas previas preservadas en JSON).

> Telemetría de una repetición muestral; no modifica ni sustituye los scores históricos. Cinco casos por suite y modo (15 tareas/configuración). TTFT y decode se miden desde el stream propio; prefill solo se incluye cuando se enlaza inequívocamente con la entrada del monitor. VRAM es uso total GPU (incluye otras cargas), no memoria aislada del proceso.

| Modelo / cuantización | CoT | Muestras comparables | Tokens entrada (media) | Tokens salida (media) | Decode tok/s | Prefill tok/s | TTFT motor | TTFT visible | Duración/tarea | VRAM total idle | VRAM total pico | No comparables |
|---|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| E4B Q4_K_M [CoT ON] (PILOTO PARCIAL; EXCLUIDO) | ON | 0/15 (8 registros; 7 diagnósticas excluidas) | — | — | — | — | — | — | — | 6.71 GiB | 6.71 GiB | 1 |
| E2B Q4_K_M [CoT ON] (MUESTRA COMPLETA) | ON | 15/15 (18 intentos) | 151.27 | 1658.8 | 171.26 tok/s | 2823.18 tok/s | 90.73 ms | 7632.2 ms | 9640.67 ms | 3.87 GiB | 3.87 GiB | 1 |
| E2B Q4_K_M [CoT OFF] (MUESTRA COMPLETA) | OFF | 15/15 (16 intentos) | 149.27 | 732.13 | 160.59 tok/s | 2687.07 tok/s | 72.07 ms | 72.07 ms | 4565.2 ms | 3.87 GiB | 3.87 GiB | 1 |
| E2B UD-Q4_K_XL [CoT ON] (MUESTRA COMPLETA) | ON | 15/15 (16 intentos) | 151.27 | 1544.67 | 145.4 tok/s | 2963.51 tok/s | 94.73 ms | 7699.53 ms | 10490.93 ms | 4.99 GiB | 4.99 GiB | 1 |
| E2B UD-Q4_K_XL [CoT OFF] (MUESTRA COMPLETA) | OFF | 15/15 (15 intentos) | 149.27 | 753.8 | 140.71 tok/s | 3116.77 tok/s | 68.87 ms | 68.87 ms | 5357.13 ms | 4.99 GiB | 4.99 GiB | 0 |
| E2B UD-Q4_K_XL QAT [CoT ON] (MUESTRA COMPLETA) | ON | 15/15 (16 intentos) | 151.27 | 3973.8 | 161.33 tok/s | 3285.86 tok/s | 93.2 ms | 9085.36 ms | 23445.47 ms | 3.59 GiB | 3.59 GiB | 1 |
| E2B UD-Q4_K_XL QAT [CoT OFF] (MUESTRA COMPLETA) | OFF | 15/15 (15 intentos) | 149.27 | 872.07 | 162.23 tok/s | 3503.11 tok/s | 65.93 ms | 65.93 ms | 5318.53 ms | 3.59 GiB | 3.59 GiB | 0 |
| E2B Q5_K_M [CoT ON] (MUESTRA COMPLETA) | ON | 15/15 (16 intentos) | 151.27 | 1678.8 | 136.29 tok/s | 2783.85 tok/s | 95.6 ms | 9159 ms | 11978.27 ms | 4.11 GiB | 4.11 GiB | 1 |
| E2B Q5_K_M [CoT OFF] (MUESTRA COMPLETA) | OFF | 15/15 (15 intentos) | 149.27 | 870.6 | 134.05 tok/s | 2992.13 tok/s | 75.13 ms | 75.13 ms | 6312.13 ms | 4.11 GiB | 4.11 GiB | 0 |
| E2B Q6_K [CoT ON] (MUESTRA COMPLETA) | ON | 15/15 (18 intentos) | 151.27 | 1858.13 | 128.85 tok/s | 2533 tok/s | 126.8 ms | 11256.53 ms | 14449.13 ms | 4.36 GiB | 4.36 GiB | 3 |
| E2B Q6_K [CoT OFF] (MUESTRA COMPLETA) | OFF | 15/15 (15 intentos) | 149.27 | 892.4 | 126.42 tok/s | 3015.24 tok/s | 86.87 ms | 86.87 ms | 6967.87 ms | 4.36 GiB | 4.36 GiB | 0 |
| E2B Q8_0 [CoT ON] (MUESTRA COMPLETA) | ON | 15/15 (16 intentos) | 151.27 | 1621.8 | 127.5 tok/s | 2578.93 tok/s | 102.73 ms | 9264.13 ms | 12414.87 ms | 4.86 GiB | 4.86 GiB | 1 |
| E2B Q8_0 [CoT OFF] (MUESTRA COMPLETA) | OFF | 15/15 (15 intentos) | 149.27 | 801.47 | 128.08 tok/s | 2816.52 tok/s | 75.8 ms | 75.8 ms | 6218.47 ms | 4.86 GiB | 4.86 GiB | 0 |
| E2B UD-Q2_K_XL [CoT ON] (MUESTRA COMPLETA) | ON | 15/15 (17 intentos) | 151.27 | 5730.93 | 129.25 tok/s | 2373.6 tok/s | 131.67 ms | 9975 ms | 41547.8 ms | 3.49 GiB | 3.49 GiB | 2 |

## Memoria GPU por variante

La serie se toma de `/api/system` a aproximadamente 1 Hz. `idle` es la mediana de lecturas con el modelo cargado y sin solicitudes activas detectadas; `pico` es el máximo durante la muestra ON/OFF. Ambos valores son GPU-wide y pueden incluir procesos ajenos.

| Modelo | Variante activa confirmada | VRAM total GPU | GPU antes de cargar | VRAM usada idle | VRAM del modelo (idle − base) | VRAM usada pico | Muestras GPU | Estado |
|---|---|---:|---:|---:|---:|---:|---:|---|
| E2B Q4_K_M | unsloth/gemma-4-E2B-it-GGUF:Q4_K_M | 8.00 GiB | 0.00 GiB | 3.87 GiB | ~3.87 GiB | 3.87 GiB | 243 | gpu_wide_observed |
| E2B UD-Q4_K_XL | unsloth/gemma-4-E2B-it-GGUF:UD-Q4_K_XL | 8.00 GiB | 0.00 GiB | 4.99 GiB | ~4.99 GiB | 4.99 GiB | 251 | gpu_wide_observed |
| E2B UD-Q4_K_XL QAT | unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL | 8.00 GiB | 0.00 GiB | 3.59 GiB | ~3.59 GiB | 3.59 GiB | 443 | gpu_wide_observed |
| E2B Q5_K_M | unsloth/gemma-4-E2B-it-GGUF:Q5_K_M | 8.00 GiB | 0.00 GiB | 4.11 GiB | ~4.11 GiB | 4.11 GiB | 288 | gpu_wide_observed |
| E2B Q6_K | unsloth/gemma-4-E2B-it-GGUF:Q6_K | 8.00 GiB | 4.11 GiB (caché) | 4.36 GiB | — (base en caché) | 4.36 GiB | 342 | gpu_wide_observed |
| E2B Q8_0 | unsloth/gemma-4-E2B-it-GGUF:Q8_0 | 8.00 GiB | 4.36 GiB (caché) | 4.86 GiB | — (base en caché) | 4.86 GiB | 296 | gpu_wide_observed |
| E2B UD-Q2_K_XL | unsloth/gemma-4-E2B-it-GGUF:UD-Q2_K_XL | 8.00 GiB | 4.86 GiB (caché) | 3.49 GiB | — (base en caché) | 3.49 GiB | 869 | gpu_wide_observed |
| E4B Q4_K_M | unsloth/gemma-4-E4B-it-GGUF:Q4_K_M | 8.00 GiB | 3.49 GiB (caché) | 6.71 GiB | — (base en caché) | 6.71 GiB | 21 | gpu_wide_observed |
| E4B UD-Q4_K_XL | unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL | 8.00 GiB | 6.71 GiB (caché) | 6.85 GiB | — (base en caché) | 6.85 GiB | 20 | gpu_wide_observed |
| E4B UD-Q4_K_XL QAT | unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q4_K_XL | 8.00 GiB | 0.00 GiB | 6.27 GiB | ~6.27 GiB | 6.27 GiB | 16 | gpu_wide_observed |
| E4B UD-Q2_K_XL | unsloth/gemma-4-E4B-it-GGUF:UD-Q2_K_XL | 8.00 GiB | 6.27 GiB (caché) | 5.90 GiB | — (base en caché) | 5.90 GiB | 23 | gpu_wide_observed |
| E4B UD-Q2_K_XL QAT | unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q2_K_XL | 8.00 GiB | 5.90 GiB (caché) | 5.90 GiB | — (base en caché) | 5.90 GiB | 24 | gpu_wide_observed |

## Diseño y límites

- Diseño: 13 configuraciones E2B × 15 casos, hasta 3 intentos por caso (máximo 585 solicitudes E2B) + 5 solicitudes acotadas de medición de memoria E4B. Se omite el E2B UD-Q2 CoT OFF que ya cuenta con telemetría histórica completa.
- No se recalculan ni reemplazan puntuaciones, intervalos o respuestas históricos.
- E2B UD-Q2_K_XL [CoT OFF] se omite del muestreo nuevo: ya tiene telemetría histórica por tarea; consultar `deterministic_v2_raw.json`.
- El primer caso que dispara una carga queda marcado `coldStart` y se excluye de los promedios de velocidad. Solo filas con coincidencia monitor unívoca y sin concurrencia cuentan para la media; los conflictos se conservan en el JSON. El piloto E4B parcial no es una muestra completa ni una medida de rendimiento comparable.
- El campo `resident_mib` del endpoint de estado no se interpreta como VRAM física total. La columna GPU-wide procede de `/api/system`. En esta GPU headless, las 5 lecturas base sin caché tras descarga confirmaron `0.00 GiB` en vacío; en las variantes donde `/api/system` devolvió la lectura anterior en caché justo tras el unload, el delta `idle − base` se marca como `— (base en caché)` en lugar de mostrar un delta artificial.
- Nota de overrides activos en Unsloth Studio durante el backfill: `E2B UD-Q4_K_XL` se cargó con su override de producción (`8 slots`, `262,144` tokens `--kv-unified`, por eso mide `4.99 GiB` frente a `4.04 GiB` con el default de `4 slots / 131K`) y `E4B UD-Q4_K_XL QAT` con su override (`8 slots`, `131,072` tokens `--kv-unified`, `6.27 GiB`). El resto de variantes corrieron con el default (`4 slots / 131K`).
- Energy gate: continúa si el sensor del generador está en on, la lectura de potencia observada es >50 W y el contador acumulado de generación tuvo una actualización en los últimos 900s; o con batería mínima 50% y entrada solar >= salida de batería. Así se toleran sensores de potencia que solo actualizan cuando cambia el valor, sin aceptar solo un estado on indefinidamente.
