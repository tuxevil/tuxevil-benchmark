import { NextResponse } from "next/server";
import { enqueueBenchmark } from "@/lib/benchmark-queue";
import { benchmarkStore } from "@/lib/benchmark-store";
import { createRunSchema } from "@/lib/contracts";
import { validateProviderEndpoint } from "@/lib/endpoints";
import { hasDatabase, listPersistedHistory } from "@/lib/database";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const score = Number(url.searchParams.get("score"));
  const page = Number(url.searchParams.get("page"));
  const pageSize = Number(url.searchParams.get("pageSize"));
  const filters = {
    keyword: url.searchParams.get("keyword") ?? "",
    date: url.searchParams.get("date") ?? "",
    model: url.searchParams.get("model") ?? "",
    provider: url.searchParams.get("provider") ?? "",
    score: Number.isInteger(score) && score >= 1 && score <= 5 ? score : undefined,
    vulnerableOnly: url.searchParams.get("vulnerableOnly") === "true",
    timezoneOffset: Number(url.searchParams.get("timezoneOffset")) || 0,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 50,
  };
  if (hasDatabase()) return NextResponse.json(await listPersistedHistory(filters));
  await benchmarkStore.hydrate();
  return NextResponse.json(benchmarkStore.listRuns(filters));
}

export async function POST(request: Request) {
  await benchmarkStore.hydrate();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = createRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid benchmark configuration.", details: parsed.error.flatten() }, { status: 400 });
  }
  const endpointError = validateProviderEndpoint(parsed.data.providerUrl, parsed.data.provider);
  if (endpointError) return NextResponse.json({ error: endpointError }, { status: 400 });

  const run = benchmarkStore.createRun({
    ...parsed.data,
    evaluator: parsed.data.evaluator ?? benchmarkStore.getEvaluatorConfig(),
  });
  try {
    await benchmarkStore.flush(run.id);
    await enqueueBenchmark(run.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not enqueue benchmark.";
    benchmarkStore.updateRun(run.id, { status: "FAILED", finishedAt: new Date().toISOString(), errorMessage: message });
    await benchmarkStore.flush(run.id).catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 503 });
  }
  return NextResponse.json({ run }, { status: 202 });
}
