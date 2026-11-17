import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { loadResultResourceMeasurement } from "@/lib/resource-measurement-store";
import { loadResultDiagnosticEvents } from "@/lib/result-diagnostic-store";
import { resourceSummary } from "@/lib/resource-telemetry";

async function handleGET(request: Request, { params }: { params: Promise<{ id: string; resultId: string }> }) {
  await benchmarkStore.hydrate();
  const { id, resultId } = await params;
  const run = benchmarkStore.getStoredRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const result = run.results.find((item) => item.id === resultId);
  if (!result) return NextResponse.json({ error: "Result not found." }, { status: 404 });

  const includeHistory = new URL(request.url).searchParams.get("includeHistory") === "true";
  const includeDiagnostics = new URL(request.url).searchParams.get("includeDiagnostics") === "true";
  const evaluationHistory = includeHistory ? await benchmarkStore.getEvaluationHistory(resultId) : undefined;
  const diagnostics = includeDiagnostics ? await Promise.all([
    loadResultDiagnosticEvents(resultId),
    loadResultResourceMeasurement(resultId),
  ]).then(([events, measurement]) => {
    const eventManifest = [...events].reverse().find((event) => event.event === "metadata_captured")?.payload.manifest;
    return {
    events,
    manifest: measurement?.manifest ?? result.manifest ?? eventManifest ?? null,
    measurement: measurement ? resourceSummary(measurement) : null,
  }}) : undefined;
  return NextResponse.json({ runId: run.id, result, evaluationHistory, diagnostics });
}

async function handleDELETE(_request: Request, { params }: { params: Promise<{ id: string; resultId: string }> }) {
  await benchmarkStore.hydrate();
  const { id, resultId } = await params;
  const run = benchmarkStore.getStoredRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const removed = await benchmarkStore.deleteResult(id, resultId);
  if (!removed) return NextResponse.json({ error: "Result not found." }, { status: 404 });
  await benchmarkStore.flush(id);
  return new NextResponse(null, { status: 204 });
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}

export async function DELETE(...args: Parameters<typeof handleDELETE>) {
 const denied=await requireAdmin("DELETE"); if(denied)return denied; return handleDELETE(...args);
}
