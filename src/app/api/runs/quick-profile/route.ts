import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { enqueueBenchmark } from "@/lib/benchmark-queue";
import { benchmarkStore } from "@/lib/benchmark-store";
import { validateProviderEndpoint } from "@/lib/endpoints";
import {
  IA_SOLAR_QUICK_CASES,
  IA_SOLAR_QUICK_PARAMETERS,
  IA_SOLAR_QUICK_REQUEST_SCHEMA,
  IA_SOLAR_QUICK_SAMPLES,
  quickProfileSummary,
} from "@/lib/ia-solar-quick-profile";

/**
 * Start the complete immutable IA Solar quick suite in one request.
 *
 * Existing queue workers run the individual cases, so the HTTP request returns
 * as soon as runs are queued (not after inferencing/evaluating them).
 * The normal benchmark queue is single-flight by default.
 */
async function handlePOST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON request." }, { status: 400 });
  }

  const parsed = IA_SOLAR_QUICK_REQUEST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid quick-profile configuration.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { modelName, provider, providerUrl, reasoningEffort, inference, samplesPerModel } = parsed.data;
  const endpointError = validateProviderEndpoint(providerUrl, provider);
  if (endpointError) return NextResponse.json({ error: endpointError }, { status: 400 });

  // Quick comparisons rely on queue serialization: simultaneous cases can
  // distort speed measurements and overload an 8GB GPU.
  const concurrency = Number(process.env.BENCHMARK_CONCURRENCY ?? "1");
  const modelConcurrency = Number(process.env.BENCHMARK_MODEL_CONCURRENCY ?? "1");
  if (concurrency !== 1 || modelConcurrency !== 1) {
    return NextResponse.json(
      { error: "El perfil rápido exige BENCHMARK_CONCURRENCY=1 y BENCHMARK_MODEL_CONCURRENCY=1 para medir un caso a la vez." },
      { status: 409 },
    );
  }

  await benchmarkStore.hydrate();
  const queuedRunIds: string[] = [];
  for (const test of IA_SOLAR_QUICK_CASES) {
    const run = benchmarkStore.createRun({
      category: test.category,
      attackType: test.attackType,
      scenarioId: null,
      systemPrompt: test.systemPrompt,
      userMessages: [...test.userMessages],
      models: [modelName],
      samplesPerModel: samplesPerModel ?? IA_SOLAR_QUICK_SAMPLES,
      parameters: { ...IA_SOLAR_QUICK_PARAMETERS, ...inference, reasoningEffort },
      provider,
      providerUrl,
      ollamaUrl: providerUrl,
      evaluator: benchmarkStore.getEvaluatorConfig(),
    });
    try {
      await benchmarkStore.flush(run.id);
      await enqueueBenchmark(run.id);
      queuedRunIds.push(run.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not queue benchmark.";
      benchmarkStore.updateRun(run.id, {
        status: "FAILED",
        finishedAt: new Date().toISOString(),
        errorMessage: message,
      });
      await benchmarkStore.flush(run.id).catch(() => undefined);
      return NextResponse.json({
        error: "No fue posible encolar todo el perfil rápido.",
        detail: message,
        queuedRunIds,
        failedRunId: run.id,
      }, { status: 503 });
    }
  }

  return NextResponse.json(
    { ...quickProfileSummary(), modelName, queuedRunIds },
    { status: 202 },
  );
}

export async function POST(...args: Parameters<typeof handlePOST>) {
 const denied=await requireAdmin("POST"); if(denied)return denied; return handlePOST(...args);
}
