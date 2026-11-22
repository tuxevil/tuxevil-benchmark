import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { longContextCacheConfigSchema, runLongContextCacheSuite } from "@/lib/long-context-cache-suite";
import { listPerformanceSuiteRuns, savePerformanceSuiteRun } from "@/lib/performance-suites-store";
import { acquirePerformanceSuiteSlot, releasePerformanceSuiteSlot, resolveProviderApiKey } from "@/lib/performance-suite-guard";

async function handleGET() {
  const runs = await listPerformanceSuiteRuns("long-context-cache", 25);
  return NextResponse.json({ runs });
}

async function handlePOST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }
  const parsed = longContextCacheConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid long-context cache configuration.", details: parsed.error.flatten() }, { status: 400 });
  }
  const conflict = await acquirePerformanceSuiteSlot("long-context-cache");
  if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });

  try {
    const apiKey = await resolveProviderApiKey(parsed.data.provider);
    const report = await runLongContextCacheSuite(parsed.data, request.signal, apiKey);
    const saved = await savePerformanceSuiteRun({
      id: crypto.randomUUID(),
      suiteType: "long-context-cache",
      modelName: parsed.data.model,
      provider: parsed.data.provider,
      createdAt: new Date().toISOString(),
      report,
    });
    return NextResponse.json({ run: saved }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Long-context cache suite failed." },
      { status: 500 },
    );
  } finally {
    releasePerformanceSuiteSlot();
  }
}

export async function GET() {
  const denied = await requireAdmin("GET");
  if (denied) return denied;
  return handleGET();
}

export async function POST(request: Request) {
  const denied = await requireAdmin("POST");
  if (denied) return denied;
  return handlePOST(request);
}
