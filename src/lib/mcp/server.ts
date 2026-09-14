import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getArenaLeaderboard, leaderboardInputSchema } from "./leaderboard";
import { getModelProfile, modelProfileInputSchema } from "./profile";
import { createTestScenario, createScenarioInputSchema, deleteScenarioInputSchema, deleteTestScenario, getScenarioInputSchema, getTestScenario, listTestScenarios, listTestInputSchema, updateScenarioInputSchema, updateTestScenario } from "./scenarios";
import { checkJobStatus, getTestRunDetails, jobStatusInputSchema, launchMatrixTest, launchMatrixInputSchema, listRuns, listRunsInputSchema, pauseRun, pauseAllPendingRuns, resumeAllPendingRuns, resumeRun, cancelRun, resultDetailsInputSchema, getRunResultDetails, reevaluateInputSchema, reevaluateResult, runControlInputSchema, runDetailsInputSchema } from "./runs";
import { listOllamaModels } from "./ollama";
import { getSettings, updateSettings, updateSettingsInputSchema, addEvaluator, addEvaluatorInputSchema, updateEvaluator, updateEvaluatorInputSchema, deleteEvaluator, deleteEvaluatorInputSchema } from "./settings";
import { getScenarioAnalysis, analysisInputSchema, reviewResult, reviewResultInputSchema } from "./analysis";
import { PROJECT_BRAND } from "@/lib/brand";
import { LEGACY_MCP_RESOURCE_URIS } from "@/lib/legacy-identifiers";
import { benchmarkResourceUris, readLeaderboardResource, readScenariosResource } from "./resources";

function jsonContent(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: `${PROJECT_BRAND.slug}-mcp`,
    version: "1.0.0",
  });

  // ---- Read tools ----

  server.registerTool(
    "get_arena_leaderboard",
    {
      title: "Obtener ranking de modelos",
      description:
        "Retorna el ranking actual de modelos de tuxevil Benchmark, ordenable por calidad, velocidad, seguridad o Arena Index, con filtros de velocidad mínima y categoría.",
      inputSchema: leaderboardInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await getArenaLeaderboard(args ?? {}));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_model_profile",
    {
      title: "Obtener perfil de modelo",
      description:
        "Extrae el expediente de un modelo específico: promedios históricos del leaderboard y, opcionalmente, su rendimiento agregado en un escenario concreto.",
      inputSchema: modelProfileInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await getModelProfile(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_ollama_models",
    {
      title: "Listar modelos de Ollama",
      description:
        "Consulta el servidor Ollama conectado a tuxevil Benchmark: modelos instalados con su tamaño, modelos cargados en VRAM y el modelo activo actual.",
    },
    async () => {
      try {
        return jsonContent(await listOllamaModels());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_test_scenarios",
    {
      title: "Listar escenarios de prueba",
      description: "Lista los escenarios y plantillas de prueba guardados en tuxevil Benchmark, generales o de seguridad.",
      inputSchema: listTestInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await listTestScenarios(args ?? {}));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_test_scenario",
    {
      title: "Obtener escenario de prueba",
      description: "Devuelve el detalle completo de un escenario guardado por su ID: System Prompt, mensajes de usuario, categoría y tipo de ataque.",
      inputSchema: getScenarioInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await getTestScenario(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "update_test_scenario",
    {
      title: "Editar escenario de prueba",
      description:
        "Sobrescribe un escenario existente: reemplaza nombre, categoría, tipo de ataque, System Prompt y mensajes de usuario del escenario indicado por scenario_id.",
      inputSchema: updateScenarioInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await updateTestScenario(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "delete_test_scenario",
    {
      title: "Eliminar escenario de prueba",
      description: "Elimina permanentemente un escenario guardado por su ID.",
      inputSchema: deleteScenarioInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await deleteTestScenario(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_runs",
    {
      title: "Listar ejecuciones",
      description:
        "Consulta el historial de ejecuciones con filtros opcionales: búsqueda libre, fecha, modelo, puntuación mínima, runs vulnerables y paginación. Sin filtros devuelve las ejecuciones recientes.",
      inputSchema: listRunsInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await listRuns(args ?? {}));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "pause_run",
    {
      title: "Pausar ejecución",
      description: "Pausa una ejecución en estado PENDING o RUNNING para detener el consumo de GPU.",
      inputSchema: runControlInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await pauseRun(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "pause_all_pending_runs",
    {
      title: "Pausar todas las ejecuciones pendientes",
      description:
        "Recorre todo el historial (paginando) y pausa todas las ejecuciones en estado PENDING o RUNNING. Devuelve el resumen de las pausadas, las que ya estaban pausadas y las omitidas.",
    },
    async () => {
      try {
        return jsonContent(await pauseAllPendingRuns());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "resume_all_pending_runs",
    {
      title: "Reanudar todas las ejecuciones pendientes",
      description:
        "Recorre todo el historial (paginando) y reanuda todas las ejecuciones pausadas en estado PENDING o RUNNING. Devuelve el resumen de las reanudadas, las que ya estaban en curso y las omitidas.",
    },
    async () => {
      try {
        return jsonContent(await resumeAllPendingRuns());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "resume_run",
    {
      title: "Reanudar ejecución",
      description: "Reanuda una ejecución pausada.",
      inputSchema: runControlInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await resumeRun(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "cancel_run",
    {
      title: "Cancelar ejecución",
      description: "Cancela una ejecución en estado PENDING o RUNNING.",
      inputSchema: runControlInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await cancelRun(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_settings",
    {
      title: "Obtener configuración",
      description:
        "Devuelve la configuración actual de tuxevil Benchmark: URL de Ollama, catálogo de modelos evaluadores con el activo seleccionado (sin exponer API keys), e hiperparámetros por defecto.",
    },
    async () => {
      try {
        return jsonContent(await getSettings());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "update_settings",
    {
      title: "Actualizar configuración",
      description:
        "Actualiza la configuración de tuxevil Benchmark: URL de Ollama, credenciales del evaluador activo, evaluador activo del catálogo o hiperparámetros por defecto. Solo se modifican los campos indicados.",
      inputSchema: updateSettingsInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await updateSettings(args ?? {}));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "add_evaluator",
    {
      title: "Agregar modelo evaluador",
      description:
        "Registra un nuevo modelo evaluador (URL base, modelo y API key opcional) en el catálogo de evaluadores de tuxevil Benchmark. Si make_active es true (o no hay ningún evaluador), pasa a ser el usado en las evaluaciones.",
      inputSchema: addEvaluatorInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await addEvaluator(args as Parameters<typeof addEvaluator>[0]));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "update_evaluator",
    {
      title: "Actualizar modelo evaluador",
      description:
        "Modifica los datos de un evaluador del catálogo (label, URL base, modelo, API key) o lo marca como activo con make_active.",
      inputSchema: updateEvaluatorInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await updateEvaluator(args as Parameters<typeof updateEvaluator>[0]));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "delete_evaluator",
    {
      title: "Eliminar modelo evaluador",
      description:
        "Elimina un evaluador del catálogo. Si era el activo, el indicador de evaluador activo queda sin valor.",
      inputSchema: deleteEvaluatorInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await deleteEvaluator(args as Parameters<typeof deleteEvaluator>[0]));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_analysis",
    {
      title: "Obtener análisis agregado",
      description:
        "Agrega el rendimiento de un escenario a través de todos los modelos evaluados: muestras, estrellas promedio, ASR, por modelo.",
      inputSchema: analysisInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await getScenarioAnalysis(args ?? {}));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "review_result",
    {
      title: "Revisar resultado",
      description:
        "Sobrescribe la evaluación automática del juez con una revisión humana (APPROVED/REJECTED/REVIEWED/UNREVIEWED) y notas del revisor.",
      inputSchema: reviewResultInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await reviewResult(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_run_result_details",
    {
      title: "Obtener detalle de resultado individual",
      description:
        "Devuelve el detalle completo de un resultado individual de una ejecución: respuesta del modelo, turns, telemetría y evaluación del juez.",
      inputSchema: resultDetailsInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await getRunResultDetails(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "re_evaluate_result",
    {
      title: "Re-evaluar resultado con otro juez",
      description:
        "Re-evalúa la respuesta ya inferida y almacenada de un resultado individual usando un evaluador del catálogo (sin volver a inferir). Reemplaza el veredicto vigente y registra el anterior en el historial de evaluaciones. Si evaluator_id se omite, usa el evaluador activo.",
      inputSchema: reevaluateInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await reevaluateResult(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_test_run_details",
    {
      title: "Obtener detalles de ejecución",
      description:
        "Devuelve el desglose completo de una ejecución: telemetría por modelo, turns, evaluación del juez, respuestas originales del modelo y estado.",
      inputSchema: runDetailsInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await getTestRunDetails(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ---- Write / execute tools ----

  server.registerTool(
    "create_test_scenario",
    {
      title: "Crear escenario de prueba",
      description:
        "Redacta y guarda un nuevo escenario (System Prompt + secuencia de mensajes de usuario) en la base de datos de tuxevil Benchmark para futuras pruebas.",
      inputSchema: createScenarioInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await createTestScenario(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "launch_matrix_test",
    {
      title: "Lanzar test matricial",
      description:
        "Dispara una ejecución matricial: lanza cada escenario dado (o ALL_SECURITY) contra los modelos objetivo (o ALL) en la cola asíncrona de tuxevil Benchmark. Retorna los run_id de seguimiento.",
      inputSchema: launchMatrixInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await launchMatrixTest(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "check_job_status",
    {
      title: "Consultar estado de ejecución",
      description:
        "Consulta el progreso de una ejecución asíncrona: estado (PENDING/RUNNING/COMPLETED/FAILED/CANCELLED), porcentaje de progreso y métricas parciales.",
      inputSchema: jobStatusInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await checkJobStatus(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ---- Resources ----

  server.registerResource(benchmarkResourceUris.leaderboard, benchmarkResourceUris.leaderboard, { mimeType: "application/json", title: `Leaderboard ${PROJECT_BRAND.displayName}` }, async () => {
    try {
      return { contents: [await readLeaderboardResource()] };
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  });

  server.registerResource(benchmarkResourceUris.scenarios, benchmarkResourceUris.scenarios, { mimeType: "application/json", title: `Escenarios de ${PROJECT_BRAND.displayName}` }, async () => {
    try {
      return { contents: [await readScenariosResource()] };
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  });

  // Keep the pre-rebrand URIs readable so existing MCP clients do not break.
  server.registerResource(LEGACY_MCP_RESOURCE_URIS.leaderboard, LEGACY_MCP_RESOURCE_URIS.leaderboard, { mimeType: "application/json", title: "Legacy leaderboard resource" }, async () => {
    try {
      return { contents: [await readLeaderboardResource(LEGACY_MCP_RESOURCE_URIS.leaderboard)] };
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  });

  server.registerResource(LEGACY_MCP_RESOURCE_URIS.scenarios, LEGACY_MCP_RESOURCE_URIS.scenarios, { mimeType: "application/json", title: "Legacy scenarios resource" }, async () => {
    try {
      return { contents: [await readScenariosResource(LEGACY_MCP_RESOURCE_URIS.scenarios)] };
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  });

  return server;
}
