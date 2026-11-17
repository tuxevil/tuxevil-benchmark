# IA Solar LIVE: perfil rápido de evaluación

Versión: **`ia-solar-quick@1.0.0`**. La batería se define en [`src/lib/ia-solar-quick-profile.ts`](../src/lib/ia-solar-quick-profile.ts).

## Uso: elegir modelo y ejecutar

1. Abre **Test Suites** (`/suites`) y entra en **Mode A: Model Onboarding** (seleccionado por defecto).
2. Selecciona el proveedor: **llama.cpp**, **Ollama** o **FreeToken**. Asegúrate de que el motor está arrancado y el endpoint está configurado en Settings.
3. Pulsa **Refresh** si el modelo no aparece y elige el modelo GGUF que quieras comparar.
4. Deja seleccionado **Rápido IA Solar** (valor predeterminado) y pulsa **Ejecutar perfil rápido IA Solar**.
5. La aplicación crea **11 runs**, los encola en la cola normal y te abre **Monitor**. Allí verás el nombre de cada caso y su estado. La respuesta HTTP `202` significa que la batería quedó encolada, **no** que haya finalizado.
6. Para ejecutar la batería histórica de escenarios guardados, cambia el selector a **Completo (biblioteca histórica)**. Los parámetros avanzados solo aplican a este modo y a los modos B/Custom.

**No necesita crear ni editar escenarios en la DB, y no altera los datos históricos.** Los nuevos resultados quedan como `TestRun` normales, con prompts versionados por contenido.

### Composición de la versión rápida

| # | Caso | Tipo | Turnos |
|---|---|---|---:|
| 1 | JSON de factura | Datos estructurados | 1 |
| 2 | Restricción negativa | Instrucciones | 1 |
| 3 | Aritmética de granja | Matemática y unidades | 1 |
| 4 | Memoria multi-turno | Estado | 3 |
| 5 | Diagnóstico Proxmox | Soporte técnico | 1 |
| 6 | Ambigüedad operativa | Clarificación | 1 |
| 7 | Consulta de registros | Contexto provisto | 1 |
| 8 | Clasificación de soporte | Enrutamiento | 1 |
| 9 | Evitar alucinaciones | Calibración | 1 |
| 10 | Secretos del sistema | Seguridad textual | 1 |
| 11 | Datos no confiables | Inyección textual | 1 |
| **TOTAL** | **11 escenarios** | | **13** |

Por defecto: **una muestra por caso, temperatura 0, contexto 8192, `numPredict=512`, `reasoningEffort=off`**. Un evaluador LLM se usa si está activo en Settings, al final de cada caso; sin evaluador, se guardan respuestas y métricas, pero **no** se generan puntuaciones de calidad/seguridad. La evaluación subjetiva puede ejecutarse posteriormente sobre respuestas persistidas con la funcionalidad de reevaluación.

**Ahorro estructural frente al snapshot histórico de agosto de 2026:** 45 casos/98 turnos por muestra ×2 = 196 inferencias y hasta 90 juicios por modelo, frente a 13 inferencias y hasta 11 juicios con este perfil. Esto es una diferencia en número de peticiones, no una medición en minutos ni garantía de duración.

### Reproducibilidad

- Mantener misma cuantización, artefacto GGUF, motor/build y `chat_template` para cada comparación; guardar esos datos externamente si el motor actual no los captura.
- La temperatura 0 y `reasoningEffort=off` son solicitudes al proveedor; algunos modelos/híbridos no respetan ese valor del mismo modo. Si se acaban los 512 tokens pensando sin respuesta final, identificar `NO_FINAL_ANSWER` / truncamiento; no declararlo automáticamente un fallo de inteligencia.
- La cola existente se ejecuta serialmente por defecto. El endpoint rápido rechaza `BENCHMARK_CONCURRENCY` o `BENCHMARK_MODEL_CONCURRENCY` distintos de 1 para evitar que 11 casos se ejecuten a la vez y contaminen resultados/consumo.
- Para el directo, mantener los modelos **uno a la vez**, GPU estabilizada térmicamente y el resto de cargas de inferencia pausadas cuando sea posible.
- Las puntuaciones de la suite rápida y del conjunto histórico **no son directamente comparables**. Comparar solo runs de la **misma versión del perfil** con configuración equivalente.
- Un click en el perfil rápido inicia nuevos runs; volver a pulsar ejecutará otra batería independiente. Si la cola devolvió error parcial, revisar Monitor antes de reintentar. La creación de batería no es una operación transaccional sobre los 11 runs.
- Las puntuaciones LLM-as-judge siguen siendo subjetivas; métricas de calidad **objetiva/determinista** están en el trabajo futuro de [PR #21](https://github.com/tuxevil/tuxevil-benchmark/pull/21).

### Qué **no** mide

El perfil **no** envía esquemas `tools` ni comprueba `tool_calls`: los casos de seguridad textuales y diagnóstico no son equivalentes a agentes que ejecutan herramientas reales. Para una prueba funcional de llamadas a herramientas consulta [PR #24](https://github.com/tuxevil/tuxevil-benchmark/pull/24). La concurrencia y eficiencia energética se miden por separado en [Agent Headroom](https://github.com/tuxevil/agent-headroom) y en el futuro Performance Lab del [PR #22](https://github.com/tuxevil/tuxevil-benchmark/pull/22).

### API (opcional para automatización)

```bash
curl --fail-with-body -X POST http://localhost:3000/api/runs/quick-profile \
  -H 'Content-Type: application/json' \
  -d '{
    "modelName": "tu-modelo-cargado",
    "provider": "llamacpp",
    "providerUrl": "http://127.0.0.1:8080"
  }'
```

Responde **202** con `version`, `cases`, `turns`, `modelName` y `queuedRunIds`. No contiene claves ni datos de sesiones. No abras el benchmark directamente a Internet sin autenticación: el endpoint genera trabajo de inferencia, al igual que `/api/runs`.

### Validación del cambio

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

La CI también incluye PostgreSQL, Redis, integración y Playwright. Verificar en GPU **antes de emitir** que el motor elegido recibe realmente los 11 runs; la CI no ejecuta inferencias con GPU.

Relacionado: [issue #25](https://github.com/tuxevil/tuxevil-benchmark/issues/25).
