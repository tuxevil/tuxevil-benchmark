import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { benchmarkStore } from "@/lib/benchmark-store";
import { assistedBenchmarkPlanSchema, parseAssistedBenchmarkPlan } from "@/lib/assisted-benchmark-plan";
import { loadPersistedSettings } from "@/lib/database";
import { validateProviderEndpoint } from "@/lib/endpoints";
import { importExecutionTarget } from "@/lib/execution-target-store";
import { createExperiment, createExperimentVariant } from "@/lib/experiment-store";
import { upsertExecutionEnvironment, upsertModelArtifact } from "@/lib/experiment-metadata-store";
import { startExperimentExecution } from "@/lib/experiment-runner";
import { probeProviderSnapshot } from "@/lib/providers/provider-probe";
import { PUBLIC_BENCHMARK_SCENARIOS } from "@/lib/public-benchmarks";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan"), prompt: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("run"), plan: assistedBenchmarkPlanSchema, model: z.string().trim().min(1).max(255) }),
]);
const suiteKey = "gsm8k-tuxevil-lite";

export async function POST(request: Request) {
  const denied = await requireAdmin("POST");
  if (denied) return denied;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 400 });
  const command = parsed.data;

  try {
    const settings = await loadPersistedSettings();
    if (!settings?.llamacppUrl || (settings.llamacppApiKeyConfigured && !settings.llamacppApiKey)) {
      return NextResponse.json({ error: "Revisa la conexión de llama.cpp en Settings." }, { status: 409 });
    }
    const connection = { provider: "llamacpp" as const, endpoint: settings.llamacppUrl, apiKey: settings.llamacppApiKey, label: "llama.cpp (Settings)" };
    if (validateProviderEndpoint(connection.endpoint, "llama.cpp")) {
      return NextResponse.json({ error: "El endpoint de llama.cpp no está permitido." }, { status: 400 });
    }

    if (command.action === "plan") {
      await benchmarkStore.hydrate();
      const evaluator = benchmarkStore.getEvaluatorConfig();
      if (!evaluator) return NextResponse.json({ error: "Configura un evaluador activo en Settings." }, { status: 409 });

      const url = evaluator.baseUrl.replace(/\/$/, "");
      const res = await fetch(url.endsWith("/chat/completions") ? url : url + "/chat/completions", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${evaluator.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: evaluator.model,
          max_completion_tokens: 512,
          messages: [
            { role: "system", content: 'Plan a small GSM8K benchmark for the active llama.cpp model only. Reply with JSON {"cases":2,"thinking":"off"}. Use cases 1 to 3 (default 2), thinking off, on or compare (compare only if requested). For requests outside this scope return {"unsupported":true}. No markdown or extra keys.' },
            { role: "user", content: command.prompt },
          ],
        }),
      });
      if (!res.ok) return NextResponse.json({ error: "El evaluador no pudo preparar la prueba." }, { status: 502 });

      const data = await res.json();
      let plan;
      try {
        plan = parseAssistedBenchmarkPlan(data.choices?.[0]?.message?.content ?? "");
      } catch {
        return NextResponse.json({ error: "Prueba con «Evalúa el modelo activo con dos casos de GSM8K»." }, { status: 422 });
      }
      const snapshot = await probeProviderSnapshot(connection);
      if (!snapshot.evidence.active) return NextResponse.json({ error: "No se pudo verificar un modelo activo en llama.cpp." }, { status: 409 });

      return NextResponse.json({ plan, model: snapshot.selectedModel });
    }

    const snapshot = await probeProviderSnapshot(connection);
    if (!snapshot.evidence.active || snapshot.selectedModel !== command.model) {
      return NextResponse.json({ error: "El modelo activo cambió. Prepara la prueba de nuevo." }, { status: 409 });
    }
    const target = await importExecutionTarget({ ...connection, apiKey: connection.apiKey ?? undefined }, { requireSettingsCredentials: true });
    const [artifact, environment] = await Promise.all([
      upsertModelArtifact(snapshot.artifact),
      upsertExecutionEnvironment(snapshot.environment),
    ]);
    const experiment = await createExperiment({
      name: `GSM8K · ${snapshot.selectedModel}`.slice(0, 255),
      suiteKey,
      factorUnderTest: command.plan.thinking === "compare" ? "REASONING_MODE" : "OTHER",
      samplingSnapshot: { temperature: 0, seed: 42, numPredict: 384 },
    });
    const modes = command.plan.thinking === "compare" ? ["off", "on"] : [command.plan.thinking];
    const variants: Record<string, string> = {};
    for (const [index, mode] of modes.entries()) {
      const variant = await createExperimentVariant(experiment.id, {
        name: `Thinking ${mode.toUpperCase()}`,
        role: index === 0 ? "BASELINE" : "VARIANT",
        modelArtifactId: artifact.id,
        executionEnvironmentId: environment.id,
        executionTargetId: target.id,
        executionModelName: snapshot.selectedModel,
        reasoningMode: mode,
        inferenceParameters: { temperature: 0, seed: 42, numPredict: 384 },
      });
      variants[variant.id] = mode.toUpperCase();
    }
    const scenarioIds = PUBLIC_BENCHMARK_SCENARIOS.filter((scenario) => scenario.suiteKey === suiteKey)
      .slice(0, command.plan.cases).map(({ id }) => id);
    const { execution } = await startExperimentExecution(experiment.id, {
      scenarioIds, samplesPerModel: 1, successPolicy: "DETERMINISTIC",
    }, { allowBaselineOnly: true });
    return NextResponse.json({ experimentId: experiment.id, executionId: execution.id, variants }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "No se pudo preparar o iniciar la prueba. Comprueba que llama.cpp esté disponible y sin otra prueba activa." }, { status: 502 });
  }
}
