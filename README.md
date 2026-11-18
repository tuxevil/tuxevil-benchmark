# tuxevil Benchmark

Un laboratorio local para comparar modelos de lenguaje: qué tan bien responden,
cuánto tardan y qué recursos utilizan. Permite repetir los mismos escenarios,
comparar cuantizaciones y configuraciones sin mezclar variantes, y conservar
los resultados mediante respaldos administrados desde la interfaz.

El servidor de inferencia es independiente de la aplicación. Puedes ejecutar el
benchmark en una máquina y los modelos en otra. Soporta Ollama, llama.cpp,
FreeToken y Strata mediante sus interfaces compatibles.

## Qué puedes hacer

| Sección | Para qué sirve |
| --- | --- |
| **Leaderboard** (`/`) | Consultar resultados agregados, puntuaciones de calidad y seguridad, velocidad y perfiles de modelos. |
| **Test Suites** (`/admin/suites`) | Crear escenarios, elegir modelos y ejecutar una prueba o una matriz de modelos y escenarios. |
| **Churn Lab** (`/admin/churn`) | Registrar artefactos y entornos, definir variantes y comparar sus respuestas caso por caso. |
| **Performance Lab** (`/admin/performance`) | Medir variantes de forma serial, con calentamiento, latencia, eficiencia y telemetría de recursos. |
| **Monitor** (`/admin/monitor`) | Seguir ejecuciones, respuestas en streaming, historial y controles de pausa, reanudación y cancelación. |
| **Respaldos** (`/admin/backups`) | Guardar resultados, explorar un respaldo, restaurar modelos seleccionados y limpiar los resultados actuales. |
| **Settings** (`/admin/settings`) | Configurar proveedores, endpoints, credenciales, jueces y parámetros de inferencia. |

## Inicio rápido

Necesitas Node.js 20 o posterior y un servidor de modelos compatible. Para el
bridge MQTT necesitas Python 3; no requiere paquetes Python externos.

```bash
npm ci
cp -f .env.example .env.local
npm run dev -- --hostname 0.0.0.0 --port 3103
```

Abre `http://localhost:3103` desde esa máquina o usa su dirección de red desde
otro equipo. `0.0.0.0` hace que escuche en todas las interfaces. La aplicación
está pensada para una red de confianza; si la expones fuera de ella, añade
control de acceso y TLS mediante tu infraestructura de publicación.

En **Settings**, selecciona el proveedor y guarda su endpoint. Recarga el catálogo
de modelos y elige uno en **Test Suites**. Las claves de proveedores y jueces se
introducen en Settings y se almacenan cifradas: configura una
`APP_ENCRYPTION_KEY` privada antes de guardarlas y consérvala para poder leerlas.
Puedes generar una clave con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
Guarda el valor generado en tu archivo privado de entorno, nunca en el repositorio.

### Dos modos de ejecución

**Local, con SQLite:** deja `DATABASE_URL` y `REDIS_URL` vacíos. La aplicación
procesa las pruebas dentro del servidor web y usa `SQLITE_PATH`. Los checkouts
antiguos con `compare.db` se detectan si no se fija otra ruta. Para reanudar
trabajo de forma duradera y separar la web del procesamiento, usa el siguiente modo.

**Duradero, con PostgreSQL y Redis:** configura ambas conexiones, inicia la web y
un worker separado. Esto permite cerrar el navegador mientras continúan las pruebas.

1. En `.env.local`, establece `POSTGRES_PASSWORD` y `REDIS_PASSWORD` con valores
   propios y configura `DATABASE_URL`, `REDIS_URL` y `APP_ENCRYPTION_KEY`.
   Las contraseñas no tienen un valor predeterminado publicable.
2. Ejecuta `docker compose --env-file .env.local up -d` si usas los servicios del
   proyecto. PostgreSQL se publica por defecto en el puerto local `55432` y
   Redis en `6379`.
3. Con `DATABASE_URL` exportada en el entorno de tu terminal, ejecuta
   `npm run db:migrate`. Aplica los esquemas de resultados y experimentos.
4. Inicia `npm run dev -- --hostname 0.0.0.0 --port 3103` y, en otra terminal,
   `npm run worker`. La web y el worker cargan `.env.local` y deben compartir
   base de datos, Redis y clave de cifrado.

Para servir una compilación de producción:

```bash
npm run build
npm run start -- --hostname 0.0.0.0 --port 3103
# En otro proceso, si usas el modo duradero:
npm run worker
```

Los comandos anteriores no instalan servicios de arranque del sistema. Usa tu
supervisor de procesos si necesitas que sobrevivan a un reinicio de la máquina.

## Ejecutar pruebas y evaluar respuestas

En **Test Suites**, un escenario contiene un prompt de sistema y uno o varios
mensajes del usuario. Puedes guardarlo en la biblioteca y repetirlo después.
La matriz permite combinar varios escenarios, modelos y muestras por modelo.

Los escenarios pueden ser de calidad general o de seguridad. Los de seguridad
incluyen ataques sintéticos como extracción del prompt, inyección de instrucciones
y manipulación de delimitadores. Los canarios incluidos son datos ficticios de
prueba, no claves reales. Una puntuación de seguridad no garantiza inmunidad a
otros ataques o configuraciones.

Hay dos formas de puntuar las respuestas:

- **Juez compatible con OpenAI:** configúralo en Settings. Evalúa calidad o
  seguridad según el escenario. Si apuntas a un juez externo, recibirá el prompt,
  la conversación y la respuesta que deba evaluar.
- **Practical SLM:** suite versionada con 15 casos y validadores deterministas
  de texto exacto, JSON, números y contenido requerido. No necesita un juez.
  Sus escenarios oficiales son inmutables; puedes duplicarlos para personalizarlos.

También hay perfiles breves para empezar:

- **Rápido IA Solar:** batería corta de escenarios, con parámetros reproducibles.
  [Guía del perfil rápido](docs/ia-solar-quick-profile.md).
- **Chatbot Plus:** perfil orientado a conversación y seguimiento de instrucciones.
  [Guía de Chatbot Plus](docs/ia-solar-chatbot-plus.md).

Estos perfiles no equivalen a ejecutar herramientas reales. El soporte de un
proveedor para `tool_calls` debe comprobarse con una prueba específica.

## Comparar Q4, Q6 y otras variantes sin mezclar resultados

El leaderboard agrupa las pruebas por modelo, motor y cuantización.
Puedes consultar los parámetros de inferencia de cada ejecución en el inspector
de pruebas. Si el servidor no informa la cuantización, los resultados aparecen
en un grupo de cuantización desconocida.

El nombre del modelo que devuelve un servidor puede ser el mismo aunque cambie
el archivo cargado. Para una comparación controlada, usa **Churn Lab y Performance
Lab**, no solamente el nombre que aparece en el leaderboard general.

1. Registra un **Execution Target**: el proveedor, endpoint y credencial privada
   con los que se ejecutarán las pruebas.
2. Usa **Auto Probe** para consultar metadatos del servidor. Ollama y llama.cpp
   pueden informar más detalles que una API genérica. Los datos que el servidor
   no expone quedan desconocidos; no se deduce una cuantización por intuición.
3. Registra un **Model Artifact** para cada archivo de pesos. Por ejemplo,
   `LFM3 Q4_K_M` y `LFM3 Q6_K` deben ser artefactos distintos. Guarda cuantización,
   tamaño y hash cuando estén disponibles. El artefacto tiene una huella que
   representa su identidad científica.
4. Registra el **Execution Environment**: runtime y versión, hardware, contexto,
   caché KV, offload y parámetros relevantes. Capacidad total de RAM o VRAM es
   descripción del entorno, no memoria usada durante una prueba.
5. Crea un experimento con una **baseline** y una **variant**. Vincula cada una
   con su artefacto, entorno, target y nombre de ejecución. Una **baseline repeat**
   debe repetir la misma configuración para medir el ruido natural de las respuestas.
6. Elige los mismos escenarios y muestras para las variantes y ejecuta el experimento.

Las observaciones automáticas se separan por **ejecución, variante y caso**. Repetir
un experimento no sobrescribe las observaciones de una ejecución anterior.
El runner hace preflight y bloquea contradicciones conocidas con el target.
Si un servidor solo puede cargar una cuantización, prepara sus targets y el ciclo
de carga antes de ejecutar: una API genérica no permite asumir que cambiar el nombre
del modelo cargará automáticamente otro archivo.

### Qué muestra Churn Lab

Compara respuestas exactas o estructurales, casos que mejoraron o empeoraron,
cambios neutros y ruido de la baseline repetida. Incluye intervalos de confianza
y pruebas estadísticas cuando corresponden. Puedes importar observaciones
manualmente como alternativa a la ejecución automática.

[Detalles del modelo de experimentos](docs/experiment-foundation.md).

## Medir rendimiento y recursos

En **Performance Lab**, selecciona un experimento con variantes ya vinculadas.
Configura muestras medidas y muestras de calentamiento descartadas. El modo
Performance ejecuta una prueba a la vez y adquiere leases exclusivos sobre los
targets registrados para evitar solapamientos coordinados por esta aplicación.
Eso no impide que otro programa use la GPU ni detecta targets duplicados que
apunten al mismo hardware.

El informe separa fases frías y calientes y muestra:

- Porcentaje de éxito y cobertura de las métricas.
- Tiempo hasta el primer token (TTFT) y duración, con percentiles p50, p90 y p95.
- Velocidad de generación, tokens de entrada/salida y su distribución.
- Segundos y tokens por tarea exitosa, contando también el coste de los intentos fallidos.

El reinicio frío verificado solo está disponible para Ollama: se descarga el
modelo y se comprueba que ya no esté cargado. Los servidores fijos llama.cpp y
las APIs genéricas se tratan como calientes, sin etiquetarlos como fríos.

### RAM, watts, energía y temperatura

Las nuevas pruebas pueden guardar métricas del **equipo de inferencia** mediante
un colector HTTP o el bridge MQTT de solo lectura. No se usa la RAM de la web
como sustituto del consumo del modelo remoto.

| Métrica | Interpretación |
| --- | --- |
| RAM pico | Memoria reportada por la fuente. En el bridge MQTT es RSS de los procesos de inferencia incluidos por el publicador. |
| VRAM pico | Memoria usada de GPU reportada por el sensor; puede incluir otras cargas. |
| Watts medios y pico | Potencia del ámbito de la fuente, por ejemplo toda la GPU. No es necesariamente consumo del enchufe. |
| Joules estimados | Integración de potencia durante la ventana medida; queda desconocida con cobertura insuficiente. |
| Temperatura media y máxima | Lecturas de GPU observadas durante la prueba. |
| Throttling térmico | Flag explícito o aumento de contadores HW/SW. Una temperatura alta por sí sola no lo demuestra. |

La ventana de recursos incluye turnos y reintentos de inferencia y excluye al
juez. Se muestra la fuente y, cuando existe, su intervalo de publicación. Consultar
cada segundo un sensor que publica cada diez segundos no mejora la resolución
original. Pueden perderse eventos breves. Los contadores térmicos ayudan a detectar
eventos que ocurrieron entre lecturas; un reinicio de contador se señala.

**Sin datos no significa cero.** La RAM queda desconocida si un publicador top-N
omite el proceso. Los resultados antiguos no reciben métricas retrospectivas.
La RAM continua del host mediante otras fuentes, como Home Assistant, requiere
una integración específica y no se obtiene automáticamente.

[Configuración, formato y límites de la telemetría](docs/resource-telemetry.md).
Las credenciales MQTT se guardan en un archivo privado de entorno; no se envían al
navegador ni se guardan en los resultados.

## Respaldar, restaurar y empezar de cero

Abre **Respaldos** y sigue este flujo:

1. Termina o cancela las ejecuciones pendientes.
2. Escribe un nombre y pulsa **Crear respaldo de resultados**.
3. El respaldo aparece en la tabla. **Explorar y restaurar** permite leer sus
   respuestas, turnos, evaluaciones e historial y filtrar por modelo.
4. Para restaurar todo, selecciona todos los modelos. Para recuperar solo una
   parte, marca los modelos necesarios. La restauración conserva resultados
   existentes y omite los que ya existen con la misma identidad.
5. Para empezar de cero, usa el panel **Limpiar resultados**, selecciona un
   respaldo que coincida con los datos actuales y escribe `LIMPIAR RESULTADOS`.
   Después confirma la eliminación.

Si los resultados cambiaron desde el respaldo, la limpieza se rechaza: crea uno
nuevo. También se bloquean estas operaciones con ejecuciones pendientes o activas.
La limpieza conserva los respaldos, escenarios y ajustes.

Los respaldos se guardan en `.backups/results` o `RESULT_BACKUP_DIR`. Incluyen
resultados, turnos, evaluaciones, historial y, en las versiones nuevas, telemetría
de recursos. **No son una copia completa de la instalación:** no incluyen el
catálogo de escenarios, configuración global ni el módulo de experimentos.
Para recuperar una instalación completa, respalda también su base de datos,
configuración y clave de cifrado mediante tu sistema de operaciones.

El archivo de respaldo contiene datos privados de las ejecuciones. Protege su
acceso y conserva una copia externa del directorio si necesitas recuperación
ante pérdida del servidor. La interfaz administra los respaldos locales; no es
un servicio de sincronización externa ni de subida de archivos arbitrarios.

## Monitor, historial y perfiles

El **Monitor** muestra el avance de las ejecuciones y las respuestas en streaming.
La pausa y reanudación conservan el progreso; la cancelación detiene el trabajo
según el estado de cada solicitud. En modo duradero, el worker recupera ejecuciones
huérfanas con límites de reintento. En Performance respeta las ejecuciones seriales
planificadas para no encolarlas accidentalmente en paralelo.

El historial permite consultar resultados y revisiones humanas. Los perfiles de
modelo agrupan su calidad, seguridad y telemetría. Si vuelves a evaluar una respuesta
almacenada con otro juez, no es necesario repetir la inferencia del modelo.

## Integración con agentes y API

La web usa rutas bajo `/api` para escenarios, modelos, settings, ejecuciones,
experimentos y respaldos. Las rutas de control realizan validaciones de entradas;
no reemplazan un sistema de autenticación de despliegue.

`npm run mcp` inicia el servidor MCP con las herramientas de consulta y control
implementadas en `src/lib/mcp/`. Usa `APP_URL` para apuntar a la instancia web
correcta y configura `MCP_HOST` / `MCP_PORT` según tu despliegue. Las herramientas
pueden iniciar pruebas o cambiar estados: limita el acceso a clientes autorizados.

## Variables de entorno

`.env.example` contiene opciones vacías o ejemplos genéricos. Nunca copies a un
commit la configuración real de tu red.

| Variable | Función |
| --- | --- |
| `APP_ENCRYPTION_KEY` | Cifrar credenciales persistidas; la web y worker deben usar la misma. |
| `SQLITE_PATH` | Archivo de SQLite en modo local. |
| `DATABASE_URL` | Conexión PostgreSQL; habilita persistencia duradera. |
| `REDIS_URL` | Cola BullMQ y coordinación del worker; requiere PostgreSQL. |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `POSTGRES_PORT` | Configurar los contenedores locales de Compose. |
| `OLLAMA_URL`, `STRATA_URL` | Defaults de endpoints; normalmente se configuran desde Settings. |
| `ALLOWED_OLLAMA_HOSTS` | Lista explícita de hosts permitidos para endpoints. |
| `EVALUATOR_BASE_URL`, `EVALUATOR_MODEL`, `EVALUATOR_API_KEY` | Defaults del juez. |
| `BENCHMARK_CONCURRENCY`, `BENCHMARK_MODEL_CONCURRENCY` | Concurrencia ordinaria; Performance fuerza ejecución serial. |
| `BENCHMARK_INFERENCE_TIMEOUT_MS` | Límite por solicitud compatible con OpenAI; por defecto 120000 ms. En modo duradero se configura en el worker. |
| `RESULT_BACKUP_DIR` | Directorio privado de respaldos de resultados. |
| `BENCHMARK_RESOURCE_TARGETS` | JSON privado que asocia cada origen de inferencia a su colector HTTP y token. |
| `RESOURCE_MQTT_*`, `RESOURCE_COLLECTOR_*` | Configuración privada del bridge; ver la guía de telemetría. |
| `APP_URL`, `MCP_HOST`, `MCP_PORT` | Conexión y escucha del servidor MCP. |

## Publicación y privacidad

El repositorio contiene código y pruebas sintéticas. Bases de datos, archivos de
entorno privados, respaldos, logs, resultados JSONL, diagnósticos e historiales
operativos no deben versionarse. `.gitignore` excluye estos archivos comunes,
pero un archivo ya rastreado no queda protegido solo por añadir una regla.

La landing de `landing/` es una web estática independiente. Lee un snapshot
público generado, que no se incluye como dataset personal en el repositorio.
`npm run landing:export` genera datos desde tu base local y
`npm run landing:build` genera y compila la landing. **Revisa el snapshot antes de
publicarlo:** puede contener resultados y escenarios que no quieras compartir.
El exportador filtra campos y bloquea marcadores de fuga, pero eso no garantiza
que un prompt o texto libre no contenga información sensible.

Los identificadores históricos `compare.db`, nombres de cola y URIs MCP se
mantienen por compatibilidad; no es necesario renombrar una instalación existente.

## Desarrollo y verificación

```bash
npm run typecheck
npm run lint
npm test
npm run build
python3 -m unittest discover -s scripts -p 'test_mqtt_resource_bridge.py'
```

Las pruebas de integración requieren servicios **aislados de los datos reales**;
consulta `integration/services.test.ts` y `vitest.integration.config.ts` antes de
usar `npm run test:integration`. Para comprobar la interfaz con Playwright usa
`npm run test:e2e` o `npm run test:e2e:dev` según la configuración local.

El proyecto usa Beads (`bd`) para seguimiento local de tareas. Consulta
[CONTRIBUTING.md](CONTRIBUTING.md) para contribuir y [SECURITY.md](SECURITY.md)
para reportar problemas de seguridad.

## Licencia

[MIT](LICENSE).

## Reglas de comparación y recuperación

**Security absoluta** usa la media de resistencia de los escenarios evaluados,
con el mismo peso por escenario y sin depender de los otros modelos del dashboard.
La tabla muestra casos evaluados y el índice relativo en la ayuda del indicador.
Sin evaluación válida se muestra **Sin evaluar**; esa ausencia no puede otorgar
puntos de seguridad ni habilitar un ranking completo cuando seguridad tiene peso.
Arena Index sigue siendo un índice combinado comparativo, con velocidad normalizada
respecto al conjunto visible y calidad relativa; no es una tasa de acierto absoluta.

Las nuevas ejecuciones capturan un manifiesto con huellas del artefacto, entorno,
parámetros y escenario. Las variantes verificadas por el proveedor se agrupan por esa
identidad; si no hay metadatos suficientes, se mantienen separadas por ejecución y se
identifican como no verificadas. Los datos históricos no permiten reconstruir una
cuantización que nunca se registró. El historial de escenarios conserva los textos y
su identidad de agregación cambia al editar el contenido.

Todos los trabajos pasan por admisión común antes de usar un recurso. Por defecto,
los endpoints del mismo hostname comparten reserva. Si hay GPUs independientes en
un mismo servidor, define `BENCHMARK_RESOURCE_GROUPS` en configuración privada.
Las tareas bloqueadas se posponen sin consumir reintentos de inferencia; el reset
frío ocurre con el recurso adquirido. Esta reserva coordina trabajos del benchmark,
no procesos externos que usen la misma GPU.

Los intentos de inferencia quedan registrados por separado. La duración acumulada
incluye los intentos fallidos y excluye la evaluación del juez; si se desconocen los
tokens consumidos por un intento fallido, el coste normalizado en tokens queda
sin determinar. La telemetría conserva timestamps del publicador y solo integra
muestras independientes dentro de la ventana de inferencia. Consultas repetidas
no aumentan la cobertura. En pruebas más cortas que la cadencia del sensor es
normal no poder calcular energía con suficiente cobertura.

**Protección de experimentos:** el respaldo de resultados todavía no es un archivo
completo del laboratorio. La limpieza se bloquea si hay vínculos de experimentos,
para impedir que un borrado en cascada destruya relaciones que ese respaldo no
puede restaurar. No elimines esas relaciones manualmente para saltar la protección.

Las plantillas de `deploy/systemd/` permiten un despliegue persistente. Ajusta usuario,
rutas y archivos privados de entorno a tu instalación; compila la versión elegida,
aplica migraciones y habilita las unidades con el administrador del sistema.

## Vista pública y administración

`/` sirve la landing pública original con actualización cada tres segundos.
`/live` redirige a `/`; todo el panel privado vive bajo `/admin`.
Solo publica los modelos enumerados en `BENCHMARK_PUBLIC_MODELS`; la lista vacía
no publica resultados. `BENCHMARK_PUBLIC_MODEL_ALIASES` permite reemplazar nombres
internos por nombres de presentación. No publica prompts, respuestas ni endpoints.

El resto de páginas y APIs exige `BENCHMARK_ADMIN_USER` y
`BENCHMARK_ADMIN_PASSWORD` mediante HTTP Basic. Si faltan, el acceso privado
se rechaza. Usa HTTPS, una contraseña larga y un proxy con limitación de intentos;
no expongas directamente el puerto de aplicación en Internet. Los controles de
escritura también rechazan orígenes cruzados. Para el live, captura únicamente
la ventana pública `/`; el panel privado conserva los datos necesarios para operar.
La instalación remota, DNS, TLS y conectividad privada con inferencia deben
configurarse antes de abrir el servidor de producción al público.

### Producción mediante Coolify

Los despliegues de producción se gestionan desde Coolify, usando el repositorio
y `deploy/Dockerfile`; no iniciar una segunda instalación manual en el servidor.
Proporciona las variables privadas en tiempo de ejecución, nunca en la imagen.
Web y worker necesitan la misma base de datos, Redis y clave de cifrado para
leer la configuración migrada. Publica únicamente HTTPS a través del proxy;
PostgreSQL, Redis y el colector deben quedar en redes privadas o loopback.
El proceso worker se inicia con `node node_modules/tsx/dist/cli.mjs src/worker.ts`.
La raíz es pública tanto para visitantes como para administradores; las rutas `/admin`
solicitan autenticación. Conserva el despliegue anterior hasta validar el nuevo
para disponer de una reversión del enrutamiento.

Las definiciones de escenarios públicos se cargan exclusivamente desde un archivo
aprobado mediante `BENCHMARK_PUBLIC_SCENARIOS_FILE`; los prompts privados de la
base de datos no se publican automáticamente. Sus estadísticas quedan sin evaluar
si no se dispone de un cálculo público correspondiente.

La instalación existente en Coolify usa `deploy/coolify-compose.yaml` en modo
Raw Compose: web, worker, MQTT, PostgreSQL y Redis forman una sola aplicación.
El archivo referencia configuración privada del host y volúmenes externos ya
existentes; no es una receta para una instalación vacía. No ejecutes dos instancias
de PostgreSQL contra el mismo volumen. El dominio y sus reglas HTTPS pertenecen
al servicio web definido en Compose, sin un override de enrutamiento externo.

Las especificaciones del rig son públicas: CPU, RAM y GPU conservan las etiquetas
de la landing original. Se pueden ajustar con `SNAPSHOT_CPU`, `SNAPSHOT_RAM`,
`SNAPSHOT_GPU` y `SNAPSHOT_PROVIDER`. No se publican direcciones internas,
usuarios, cuentas ni credenciales junto a esos componentes.

## Chat de resultados

Abre **Preguntar al benchmark** desde el sitio público o cualquier pantalla
privada. Puedes consultar el ranking, velocidad, calidad, seguridad y tiempo al
primer token. El chat público usa las variantes y los alias publicados en el
leaderboard. El chat privado requiere la misma autenticación que el panel.

El modo integrado responde consultas de métricas sin configurar un proveedor.
Para habilitar preguntas abiertas y seguimientos, configura en el entorno del
servicio web `BENCHMARK_CHAT_BASE_URL` (base de una API compatible con OpenAI,
incluido `/v1` si corresponde), `BENCHMARK_CHAT_MODEL` y, si el proveedor la
requiere, `BENCHMARK_CHAT_API_KEY`. En este modo se envían al proveedor la pregunta,
el contexto reciente de la conversación y los resúmenes del leaderboard de esa
vista. El chat no carga respuestas originales de las pruebas ni archivos de
diagnóstico. Cada vista tiene un límite de solicitudes por minuto por proceso.
