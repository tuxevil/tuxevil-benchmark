# Reporte Maestro Consolidado — Gemma 4 (E4B & E2B) en Quadro RTX 4000 (8 GB)

Generado: 2026-11-28T13:58:45.487Z  
Fuentes: [deterministic_v2_raw.json](deterministic_v2_raw.json) (24 configuraciones × 159 tareas = 3,816 evaluaciones históricas intactas), [deterministic_v2_telemetry_backfill.json](deterministic_v2_telemetry_backfill.json) (13 configuraciones E2B × 15 tareas limpias + mediciones VRAM GPU-wide de los 12 modelos) y [concurrency_test_latest.json](concurrency_test_latest.json).

> **Nota metodológica:** Las puntuaciones (MMLU-Pro 70 casos, MATH-500 Hard 49 casos, Seguridad HarmBench/Canary 40 casos; IC 95% Wilson) provienen exclusivamente de la batería completa histórica (`deterministic_v2_raw.json`, sin alteraciones). En **E4B** y **E2B UD-Q2_K_XL [CoT OFF]**, la telemetría de velocidad/latencia proviene de las 159 tareas históricas (`hist.`). En las otras **13 configuraciones E2B**, proviene de la muestra estratificada limpia de 15 tareas (`muestra 15`, 5 casos por suite). Toda la columna **VRAM GPU (4s/131K)** refleja memoria física real total de la GPU (`/api/system`, base en vacío comprobada `0.00 GiB`) bajo el mismo perfil estándar (`4 slots`, contexto `131,072`, KV `f16`) para comparación justa.

## 1. Familia Gemma 4 E4B (10 configuraciones — 5 cuantizaciones × CoT ON/OFF)

| Cuantización | CoT | MMLU-Pro (IC 95%) | MATH-500 Hard (IC 95%) | Seguridad (IC 95%) | Decode | Prefill | TTFT Motor | TTFT Visible | Tok/Tarea | Seg/Tarea | Bucles | VRAM GPU (4s/131K) | RAM CPU | Fuente telemetría |
|---|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| **E4B Q4_K_M** | **ON** | 74.3% [63%, 83.1%] | 73.5% [59.7%, 83.8%] | 60% [44.6%, 73.7%] | 100.0 tok/s | 1,245 tok/s | 22 ms | 8.73 s | 1,315 | 12.67 s | 0/159 | **6.71 GiB** | 2.16 GiB | Histórica 159 |
| **E4B Q4_K_M** | OFF | 74.3% [63%, 83.1%] | 6.1% [2.1%, 16.5%] | 92.5% [80.1%, 97.4%] | 95.1 tok/s | 1,243 tok/s | 1.32 s | 1.43 s | 719 | 8.38 s | 2/159 | **6.71 GiB** | 2.16 GiB | Histórica 159 |
| **E4B UD-Q4_K_XL** | **ON** | 75.7% [64.5%, 84.2%] | 79.6% [66.4%, 88.5%] | 57.5% [42.2%, 71.5%] | 98.4 tok/s | 1,212 tok/s | 816 ms | 9.67 s | 1,321 | 13.73 s | 0/159 | **6.85 GiB** | 2.23 GiB | Histórica 159 |
| **E4B UD-Q4_K_XL** | OFF | 78.6% [67.6%, 86.6%] | 10.2% [4.4%, 21.8%] | 92.5% [80.1%, 97.4%] | 93.4 tok/s | 1,259 tok/s | 20 ms | 130 ms | 745 | 7.44 s | 3/159 | **6.85 GiB** | 2.23 GiB | Histórica 159 |
| **E4B UD-Q4_K_XL QAT** | **ON** | 75.7% [64.5%, 84.2%] | 73.5% [59.7%, 83.8%] | 55% [39.8%, 69.3%] | 113.7 tok/s | 1,328 tok/s | 174 ms | 8.34 s | 1,375 | 11.87 s | 0/159 | **6.16 GiB** | 1.83 GiB | Histórica 159 |
| **E4B UD-Q4_K_XL QAT** | OFF | 82.9% [72.4%, 89.9%] | 14.3% [7.1%, 26.7%] | 85% [70.9%, 92.9%] | 107.1 tok/s | 1,389 tok/s | 22 ms | 127 ms | 739 | 6.45 s | 4/159 | **6.16 GiB** | 1.83 GiB | Histórica 159 |
| **E4B UD-Q2_K_XL** | **ON** | 61.4% [49.7%, 72%] | 44.9% [31.9%, 58.7%] | 60% [44.6%, 73.7%] | 86.7 tok/s | 1,010 tok/s | 151 ms | 11.24 s | 1,545 | 17.43 s | 1/159 | **5.90 GiB** | 1.83 GiB | Histórica 159 |
| **E4B UD-Q2_K_XL** | OFF | 64.3% [52.6%, 74.5%] | 30.6% [19.5%, 44.5%] | 90% [76.9%, 96%] | 80.9 tok/s | 1,071 tok/s | 24 ms | 150 ms | 752 | 8.66 s | 1/159 | **5.90 GiB** | 1.83 GiB | Histórica 159 |
| **E4B UD-Q2_K_XL QAT** | **ON** | 48.6% [37.2%, 60%] | 30.6% [19.5%, 44.5%] | 52.5% [37.5%, 67.1%] | 83.9 tok/s | 1,196 tok/s | 133 ms | 10.44 s | 6,206 | 70.59 s | 25/159 | **5.90 GiB** | 0.84 GiB | Histórica 159 |
| **E4B UD-Q2_K_XL QAT** | OFF | 45.7% [34.6%, 57.3%] | 38.8% [26.4%, 52.8%] | 90% [76.9%, 96%] | 80.7 tok/s | 1,281 tok/s | 21 ms | 133 ms | 829 | 9.57 s | 9/159 | **5.90 GiB** | 0.84 GiB | Histórica 159 |

## 2. Familia Gemma 4 E2B (14 configuraciones — 7 cuantizaciones × CoT ON/OFF)

| Cuantización | CoT | MMLU-Pro (IC 95%) | MATH-500 Hard (IC 95%) | Seguridad (IC 95%) | Decode | Prefill | TTFT Motor | TTFT Visible | Tok/Tarea | Seg/Tarea | Bucles | VRAM GPU (4s/131K) | RAM CPU | Fuente telemetría |
|---|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| **E2B Q4_K_M** | **ON** | 64.3% [52.6%, 74.5%] | 69.4% [55.5%, 80.5%] | 52.5% [37.5%, 67.1%] | 171.3 tok/s | 2,823 tok/s | 91 ms | 7.63 s | 1,659 | 9.64 s | 0/15 | **3.87 GiB** | 1.71 GiB | Muestra 15/15 |
| **E2B Q4_K_M** | OFF | 65.7% [54%, 75.8%] | 4.1% [1.1%, 13.7%] | 82.5% [68%, 91.3%] | 160.6 tok/s | 2,687 tok/s | 72 ms | 72 ms | 732 | 4.57 s | 0/15 | **3.87 GiB** | 1.71 GiB | Muestra 15/15 |
| **E2B UD-Q4_K_XL** | **ON** | 67.1% [55.5%, 77%] | 65.3% [51.3%, 77.1%] | 52.5% [37.5%, 67.1%] | 145.4 tok/s | 2,964 tok/s | 95 ms | 7.70 s | 1,545 | 10.49 s | 0/15 | **3.85 GiB** | 1.76 GiB | Muestra 15/15 |
| **E2B UD-Q4_K_XL** | OFF | 64.3% [52.6%, 74.5%] | 0% [0%, 7.3%] | 82.5% [68%, 91.3%] | 140.7 tok/s | 3,117 tok/s | 69 ms | 69 ms | 754 | 5.36 s | 0/15 | **3.85 GiB** | 1.76 GiB | Muestra 15/15 |
| **E2B UD-Q4_K_XL QAT** | **ON** | 67.1% [55.5%, 77%] | 30.6% [19.5%, 44.5%] | 57.5% [42.2%, 71.5%] | 161.3 tok/s | 3,286 tok/s | 93 ms | 9.09 s | 3,974 | 23.45 s | 1/15 | **3.59 GiB** | 1.44 GiB | Muestra 15/15 |
| **E2B UD-Q4_K_XL QAT** | OFF | 68.6% [57%, 78.2%] | 0% [0%, 7.3%] | 85% [70.9%, 92.9%] | 162.2 tok/s | 3,503 tok/s | 66 ms | 66 ms | 872 | 5.32 s | 0/15 | **3.59 GiB** | 1.44 GiB | Muestra 15/15 |
| **E2B Q5_K_M** | **ON** | 67.1% [55.5%, 77%] | 65.3% [51.3%, 77.1%] | 55% [39.8%, 69.3%] | 136.3 tok/s | 2,784 tok/s | 96 ms | 9.16 s | 1,679 | 11.98 s | 0/15 | **4.11 GiB** | 1.76 GiB | Muestra 15/15 |
| **E2B Q5_K_M** | OFF | 67.1% [55.5%, 77%] | 2% [0.4%, 10.7%] | 82.5% [68%, 91.3%] | 134.0 tok/s | 2,992 tok/s | 75 ms | 75 ms | 871 | 6.31 s | 0/15 | **4.11 GiB** | 1.76 GiB | Muestra 15/15 |
| **E2B Q6_K** | **ON** | 65.7% [54%, 75.8%] | 69.4% [55.5%, 80.5%] | 55% [39.8%, 69.3%] | 128.9 tok/s | 2,533 tok/s | 127 ms | 11.26 s | 1,858 | 14.45 s | 0/15 | **4.36 GiB** | 2.63 GiB | Muestra 15/15 |
| **E2B Q6_K** | OFF | 61.4% [49.7%, 72%] | 2% [0.4%, 10.7%] | 82.5% [68%, 91.3%] | 126.4 tok/s | 3,015 tok/s | 87 ms | 87 ms | 892 | 6.97 s | 0/15 | **4.36 GiB** | 2.63 GiB | Muestra 15/15 |
| **E2B Q8_0** | **ON** | 65.7% [54%, 75.8%] | 57.1% [43.3%, 70%] | 55% [39.8%, 69.3%] | 127.5 tok/s | 2,579 tok/s | 103 ms | 9.26 s | 1,622 | 12.41 s | 0/15 | **4.86 GiB** | 2.72 GiB | Muestra 15/15 |
| **E2B Q8_0** | OFF | 68.6% [57%, 78.2%] | 2% [0.4%, 10.7%] | 80% [65.2%, 89.5%] | 128.1 tok/s | 2,817 tok/s | 76 ms | 76 ms | 801 | 6.22 s | 0/15 | **4.86 GiB** | 2.72 GiB | Muestra 15/15 |
| **E2B UD-Q2_K_XL** | **ON** | 47.1% [35.9%, 58.7%] | 2% [0.4%, 10.7%] | 52.5% [37.5%, 67.1%] | 129.2 tok/s | 2,374 tok/s | 132 ms | 9.97 s | 5,731 | 41.55 s | 2/15 | **3.49 GiB** | 1.44 GiB | Muestra 15/15 |
| **E2B UD-Q2_K_XL** | OFF | 52.9% [41.3%, 64.1%] | 0% [0%, 7.3%] | 80% [65.2%, 89.5%] | 129.5 tok/s | 2,599 tok/s | 136 ms | 190 ms | 990 | 7.15 s | 12/159 | **3.49 GiB** | 1.44 GiB | Histórica 159 |

## 3. Comparativa estandarizada de memoria — Quadro RTX 4000 (8.00 GiB)

Todas las variantes se midieron bajo el mismo perfil estándar (**`4 slots`**, contexto **`131,072`**, KV **`f16`**, visión activa) para compararlas en igualdad de condiciones. En las dos variantes con *override* de producción guardado en Unsloth Studio (`8 slots` con `--kv-unified`), se muestra también su consumo real con preset.

| Familia | Cuantización | Capas GPU | Pesos GPU (motor) | RAM CPU (host) | VRAM GPU real (`4s / 131K`) | Libre en 8 GiB | VRAM con preset `8s --kv-unified` |
|:---:|---|:---:|---:|---:|---:|---:|---|
| E4B | **E4B Q4_K_M** | 43/43 | 2.82 GiB | 2.16 GiB | **6.71 GiB** | 1.29 GiB | — |
| E4B | **E4B UD-Q4_K_XL** | 43/43 | 2.96 GiB | 2.23 GiB | **6.85 GiB** | 1.15 GiB | — |
| E4B | **E4B UD-Q4_K_XL QAT** | 43/43 | 2.43 GiB | 1.83 GiB | **6.16 GiB** | 1.84 GiB | **6.27 GiB** (`8s / 131K`, 131K/slot) |
| E4B | **E4B UD-Q2_K_XL** | 43/43 | 2.01 GiB | 1.83 GiB | **5.90 GiB** | 2.10 GiB | — |
| E4B | **E4B UD-Q2_K_XL QAT** | 43/43 | 2.15 GiB | 0.84 GiB | **5.90 GiB** | 2.10 GiB | — |
| E2B | **E2B Q4_K_M** | 36/36 | 1.37 GiB | 1.71 GiB | **3.87 GiB** | 4.13 GiB | — |
| E2B | **E2B UD-Q4_K_XL** | 36/36 | 1.45 GiB | 1.76 GiB | **3.85 GiB** | 4.15 GiB | **4.99 GiB** (`8s / 262K`, 131K/slot) |
| E2B | **E2B UD-Q4_K_XL QAT** | 36/36 | 1.20 GiB | 1.44 GiB | **3.59 GiB** | 4.41 GiB | — |
| E2B | **E2B Q5_K_M** | 36/36 | 1.61 GiB | 1.76 GiB | **4.11 GiB** | 3.89 GiB | — |
| E2B | **E2B Q6_K** | 36/36 | 1.85 GiB | 2.63 GiB | **4.36 GiB** | 3.64 GiB | — |
| E2B | **E2B Q8_0** | 36/36 | 2.36 GiB | 2.72 GiB | **4.86 GiB** | 3.14 GiB | — |
| E2B | **E2B UD-Q2_K_XL** | 36/36 | 0.99 GiB | 1.44 GiB | **3.49 GiB** | 4.51 GiB | — |

## 4. Concurrencia y contexto largo en Quadro RTX 4000 (8 GB)

Resultados medidos con `unsloth/gemma-4-E2B-it-GGUF:UD-Q4_K_XL` (`enable_thinking: false`, `max_tokens: 160`, prompts únicos) en [concurrency_test_latest.md](concurrency_test_latest.md):

- **4 slots (131K divididos = 32K/slot, 3.85–4.04 GiB VRAM):** pico de **331.8 tok/s** en `N=4` (88.3 tok/s/usuario); con `N=8` hace cola y el TTFT p95 salta a **2.11 s**.
- **8 slots + `--kv-unified` (`262K` pool / `131K` por slot, 4.90–5.05 GiB VRAM):** alcanza **423.7 tok/s** en `N=8` (**59.1 tok/s/usuario**, TTFT p95 **300 ms**), sin perder velocidad en `N=1` (~129 tok/s) y confirmado en vivo con un prompt de **37,440 tokens** en un solo slot (**HTTP 200**, prefill ~5,100 tok/s, VRAM pico **5.05 GiB**).
- **12 y 16 slots (131K pool):** escalan hasta **497.3 tok/s** (`N=12`, 46.2 tok/s/usuario) y **537.9 tok/s** (`N=16`, 37.4 tok/s/usuario) sin gasto extra de VRAM, reduciendo el contexto fijo por slot si no se usa `--kv-unified`.
- **E4B UD-Q4_K_XL QAT con 8 slots + `--kv-unified` (`131K` pool / `131K` por slot):** pasa de **6.16 GiB** (`4 slots`) a solo **6.25–6.27 GiB** (`8 slots`, `43/43` capas en GPU, **1.73–1.75 GiB libres**).

## 5. Conclusiones ejecutivas

1. **Ganador general en 8 GB (calidad + memoria + velocidad): `E4B UD-Q4_K_XL QAT`.** Ocupa solo **6.16 GiB** en `4 slots` (**6.25 GiB** en `8 slots / 131K --kv-unified`), es el E4B más rápido (**113.7 tok/s** ON / **107.1 tok/s** OFF), lidera MMLU-Pro (**82.9%** OFF) y mantiene **73.5%** en MATH-500 Hard ON con 0 bucles.
2. **Ganador en razonamiento matemático puro: `E4B UD-Q4_K_XL` (no QAT) con CoT ON.** Alcanza **79.6%** en MATH-500 Hard y **75.7%** en MMLU-Pro, a cambio de **6.85 GiB** de VRAM real (**1.15 GiB** libres).
3. **Mejor E2B balanceado: `E2B Q4_K_M` (o `E2B UD-Q4_K_XL` si buscas 8 slots/262K).** `Q4_K_M` ofrece el mejor equilibrio en E2B (**171.3 tok/s** ON / **160.6 tok/s** OFF, **3.87 GiB** de VRAM real, **69.4%** en MATH-500 Hard ON, 0 bucles en la muestra). `E2B UD-Q4_K_XL` ocupa prácticamente la misma VRAM en default (**3.85 GiB**) y rinde **67.1%** en MMLU-Pro y **65.3%** en MATH-500 Hard.
4. **Comportamiento opuesto de QAT en E2B vs E4B:** en E4B QAT mejora todo; en E2B, `UD-Q4_K_XL QAT` es el 4-bit más ligero (**3.59 GiB**) y con mayor prefill (**3,503 tok/s**), pero en **CoT ON** entra en bucle de 32K tokens en problemas difíciles de matemáticas (**30.6%** en MATH-500 Hard). Para E2B con CoT OFF sí rinde muy bien (**68.6%** MMLU-Pro, **85.0%** Seguridad, **162.2 tok/s**).
5. **Cuantizaciones 5/6/8-bit en E2B no compensan en 8 GB:** `Q5_K_M`, `Q6_K` y `Q8_0` consumen hasta **+1.0 GiB** extra de VRAM (**4.86 GiB**) y pierden ~20–25% de velocidad de decode sin superar consistentemente a `Q4_K_M`.
6. **2-bit (`UD-Q2_K_XL`) no es recomendable para razonamiento:** colapsa en MATH-500 Hard (E2B: **2.0%** ON / **0.0%** OFF) y genera bucles masivos de 32K tokens (`E4B UD-Q2 QAT ON`: 25 bucles / 159 tareas, 70.6 s/tarea; `E2B UD-Q2 ON`: 2/15 tareas golpearon 32K).
7. **Compromiso CoT ON vs CoT OFF:** CoT ON es imprescindible para matemáticas (E4B: **73–80%** vs **6–14%**; E2B: **65–69%** vs **0–4%**), pero sube la latencia visible de **~70–150 ms** a **~7.6–11.3 s** y reduce el puntaje de la suite de seguridad (**52–60%** ON vs **80–92.5%** OFF).
