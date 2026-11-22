# Telemetría por prueba

Performance Lab separa las observaciones por ejecución y variante. Registra por resultado
el tiempo de medición, RAM/VRAM pico, potencia media y pico y energía estimada.
La ventana incluye todos los turnos y reintentos de inferencia; excluye al juez.

## MQTT existente

`scripts/mqtt-resource-bridge.py` es un suscriptor MQTT 3.1.1 de solo lectura.
Se ejecuta en el servidor del benchmark y expone `/metrics` en loopback, puerto 9109.
Requiere `RESOURCE_MQTT_HOST`, `RESOURCE_MQTT_USER`, `RESOURCE_MQTT_PASSWORD`
y un `RESOURCE_COLLECTOR_TOKEN` privado. Nunca publica mensajes de control.

Por defecto consume:

- `benchmark/host/gpu/attributes`: `power_watts`, `memory_used_mb`, `actualizado`.
- `benchmark/host/processes/attributes`: `procesos_cpu`, `memoria_rss_mb`, `actualizado`.

Los tópicos se pueden sustituir mediante `RESOURCE_MQTT_GPU_TOPIC` y
`RESOURCE_MQTT_PROCESS_TOPIC`. Solo acepta lecturas con timestamp del publicador,
no futuro ni anterior a 25 segundos (`RESOURCE_MQTT_MAX_AGE_SECONDS`).
RAM significa RSS de los procesos `llama-server` reportados, no RAM total del host.
El publicador actual es un top-N: si omite ese proceso, la RAM es desconocida.
La potencia y VRAM corresponden a toda la GPU; otras cargas pueden influir.
No representan potencia del enchufe ni consumo exclusivo del modelo.

En el worker configura `BENCHMARK_RESOURCE_TARGETS` como JSON privado:

```json
{"http://inference-host:8081":{"url":"http://127.0.0.1:9109/metrics","token":"PRIVATE_TOKEN"}}
```

La clave es el origen exacto del endpoint de inferencia. Sin asociación explícita no
se mide el servidor web como sustituto. Las credenciales no se guardan en resultados.
El colector HTTP alternativo `scripts/resource-collector.py` permite medir directamente
un host Linux cuando no hay MQTT.

## Interpretación

La energía se estima integrando potencia por trapecios. El bridge publica el último
valor fresco del sensor; el muestreo MQTT original puede ser de 10 segundos, de modo
que pruebas breves tienen menor resolución temporal que la consulta HTTP de 1 segundo.
Se conservan los timestamps originales y se deduplican las lecturas del sensor.
GPU y RAM tienen cobertura independiente; consultar un dato repetido no aumenta cobertura.
Solo se integran pares de lecturas dentro de la ventana, sin extrapolar extremos
ni huecos mayores que dos intervalos declarados (máximo 25 segundos).
Se guarda la serie original junto al resultado para auditar el cálculo.
No se suman lecturas de GPU y APU como si fueran potencia del sistema completo.
Se informa cobertura y la energía queda nula si la cobertura válida es menor al 90%.
Las métricas ausentes nunca se sustituyen por cero.

Los respaldos nuevos incluyen `result_resource_measurements`. Los respaldos antiguos
siguen siendo restaurables. Los registros del laboratorio de experimentos se conservan
como módulo separado; los respaldos de resultados no son un respaldo completo del laboratorio.

## Potencia real de enchufe / host (`scope: "wall"`) y muestreo a 1 Hz

Para reflejar el impacto real sobre baterías solares sin mezclar el consumo de GPU con el del equipo completo, el colector soporta un canal paralelo `scope: "wall"`:

- Variables opcionales en `scripts/mqtt-resource-bridge.py` y `scripts/resource-collector.py`:
  - `RESOURCE_HA_URL` + `RESOURCE_HA_TOKEN` + `RESOURCE_HA_WALL_ENTITY` (por defecto `sensor.servidor_potencia_local`) y `RESOURCE_HA_POLL_SECONDS` (por defecto `1`).
  - Alternativamente `RESOURCE_MQTT_WALL_TOPIC` para recibir la potencia del enchufe por MQTT.
  - `RESOURCE_WALL_IDLE_WATTS` (opcional) para calcular `wallIncrementalWattHours` además de `wallWattHours` total.
- En el worker, `BENCHMARK_RESOURCE_POLL_MS` (por defecto `1000`, rango `250..5000`) controla la cadencia de consulta.
- `summarizeResources()` integra GPU y `wall` en canales completamente independientes (nunca se suman). `summarizeBatchResources()` agrega energía a nivel de lote/suite continua para cubrir pruebas rápidas de pocos segundos sin extrapolar huecos.

## Temperatura y thermal throttling

Por prueba se guardan temperatura media/máxima y límite térmico reportado cuando existe.
MQTT aporta `temperature_c`, `temperature_limit_c`, `thermal_throttling_active`,
`thermal_slowdown_hw_seconds` y `thermal_slowdown_sw_seconds`.
Se marca un evento térmico si el flag se activa o si aumenta cualquiera de los
contadores acumulados durante la ventana. Los deltas HW y SW se muestran por separado
porque pueden solaparse. Un reinicio del contador se señala y su duración queda desconocida.
Una temperatura alta sin flag ni contador no se considera evidencia de throttling.
“No reportado” solo significa que los sensores observados no reportaron el evento:
con MQTT cada 10 segundos pueden perderse eventos breves que no acumulen contadores.
Los resultados antiguos sin estos campos muestran “Sin datos”; no se rellenan retrospectivamente.
