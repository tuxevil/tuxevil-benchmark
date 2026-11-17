# IA Solar LIVE — perfil «µTuxbot Plus»

**Versionado:** `ia-solar-chatbot-plus@1.0.0` (20 escenarios, 26 turnos, una muestra). Es un **perfil independiente** que incorpora por referencia los 11 escenarios de `ia-solar-quick@1.0.0` sin modificarlos. No cambia resultados existentes ni migra datos.

## Instrucciones

1. Configura llama.cpp, Ollama o FreeToken en Settings y carga un modelo.
2. Abre **Test Suites → Mode A**.
3. Selecciona **µTuxbot Plus · Chatbots (20 casos)**, que es el perfil recomendado en esta versión.
4. Selecciona el modelo y pulsa **«Ejecutar µTuxbot Plus»**. La aplicación encola 20 ejecuciones y abre Monitor.
5. Espera a que los 20 casos terminen y revisa sus respuestas y métricas. El servidor devuelve 202 al **encolar**, no al finalizar.
6. Para reproducir la batería anterior de 11 casos y sus puntuaciones, selecciona **«Rápido IA Solar v1 · Comparación histórica»**.

## Qué evalúa

Los once escenarios v1 continúan sin cambios (extracción JSON, cálculo, restricciones, memoria, Proxmox, ambigüedad, clasificación, alucinaciones y dos pruebas de seguridad textual).

Nueve casos adicionales de **chatbot web** se centran en:
- Conocimiento del sitio con datos fijos de referencia y corrección de supuestos (2 turnos).
- Preferencias del visitante que cambian durante la conversación (3 turnos).
- No inventar planes/precios/checkout de IA Solar que no consten en la fuente (1 turno).
- Notas de proyecto con actualizaciones contradictorias y cronología (1 turno).
- Comprensión de portugués y respuesta en español (1 turno).
- Soporte al visitante: diagnóstico y límites de acceso del chatbot (2 turnos).
- JSON de tokens y cálculo de costo **ficticio** (1 turno).
- Resumen de contenido técnico con límites de extensión (1 turno).
- Inyección de instrucciones dentro de una página no confiable, con canary **ficticio** (1 turno).

Estos escenarios usan un **fixture documentado**, no la base de conocimiento privada ni el prompt de producción de µTuxbot. No requieren acceso a tuxevil.com, correo o Home Assistant.

## Parámetros y tiempo

- 20 escenarios / 26 turnos, `samplesPerModel=1`.
- `temperature=0`, `numCtx=8192`, `numPredict=768`, `reasoningEffort=off`.
- Las peticiones se ejecutan serialmente (`BENCHMARK_CONCURRENCY=1` y `BENCHMARK_MODEL_CONCURRENCY=1`).
- Comparado con v1: **13 → 26 inferencias** y **hasta 11 → 20 juicios LLM por modelo**, si el evaluador está configurado.
- En el servidor del usuario v1 tardó alrededor de **5 minutos/modelo**. Al duplicar los turnos y aumentar el límite de salida, **10 minutos es una hipótesis, no un tiempo asegurado**; una primera ejecución real determina la duración.
- Algunos modelos de razonamiento pueden ignorar `reasoningEffort=off` o truncarse incluso con 768 tokens. Identificar `NO_FINAL_ANSWER`/timeout y problemas de template/contexto, en lugar de penalizar directamente su inteligencia.

## ⚠️ Cómo interpretar el leaderboard

**El leaderboard global del benchmark no filtra automáticamente por versión de suite.** Si ejecutas v1 y Chatbot Plus en la misma base de datos, los promedios/índices globales agregarán ambos grupos y no constituyen una comparación aislada de una sola suite. No borres resultados previos: identifica grupos de ejecuciones en Monitor y compara solo cohortes equivalentes. La incorporación de un filtro por versión de suite será una mejora separada.

Los dos casos de seguridad de v1 más un caso adicional de inyección textual tampoco constituyen una auditoría de seguridad completa. El Arena Score predeterminado pondera calidad 40 %, seguridad 40 %, velocidad 20 %. Para chatbots web, conviene analizar por separado exactitud factual, seguimiento, respuestas falsas, seguridad y velocidad; diferencias grandes de Arena basadas en muy pocos casos de seguridad deben revisarse manualmente.

**No incluye:** llamadas reales a herramientas, Home Assistant, multimodalidad, agentes de programación, concurrencia de usuarios ni STT/TTS; esas modalidades corresponden al episodio 2.

## API y tests

```bash
curl --fail-with-body -X POST http://localhost:3000/api/runs/chatbot-plus \
  -H 'Content-Type: application/json' \
  -d '{"modelName":"nombre-del-modelo","provider":"llamacpp","providerUrl":"http://127.0.0.1:8080"}'
```

Respuesta 202: `version`, `cases`, `turns`, `queuedRunIds`. No exponer la instancia del benchmark a Internet sin autenticación, porque la ruta genera trabajos de inferencia.

Para validar localmente:
```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

GitHub CI valida con mocks/fixtures y no ejecuta modelos GGUF sobre una GPU real. Antes del domingo, hacer una pasada completa de un modelo y comprobar 20/20 estados en Monitor.

Relacionado: [issue #28](https://github.com/tuxevil/tuxevil-benchmark/issues/28), [episodio 1 de IA Solar LIVE](https://github.com/tuxevil/chatGPT/blob/main/proyectos/youtube/ia-solar-live-episodio-01-chat-2026-11-22.md).
