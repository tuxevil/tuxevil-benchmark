import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { warmContextsConfigSchema, runWarmContextsSuite } from "@/lib/warm-contexts-suite";
import { listPerformanceSuiteRuns, savePerformanceSuiteRun } from "@/lib/performance-suites-store";
import { acquirePerformanceSuiteSlot, releasePerformanceSuiteSlot, resolveProviderApiKey } from "@/lib/performance-suite-guard";

async function handleGET() {
  const runs = await listPerformanceSuiteRuns("warm-contexts", 25);
  return NextResponse.json({ runs });
}

async function handlePOST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }
  const parsed = warmContextsConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid warm-contexts configuration.", details: parsed.error.flatten() }, { status: 400 });
  }
  const conflict = await acquirePerformanceSuiteSlot("warm-contexts");
  if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });

  try {
    const apiKey = await resolveProviderApiKey(parsed.data.provider);
    const report = await runWarmContextsSuite(parsed.data, request.signal, apiKey);
    const saved = await savePerformanceSuiteRun({
      id: crypto.randomUUID(),
      suiteType: "warm-contexts",
      modelName: parsed.data.model,
      provider: parsed.data.provider,
      createdAt: new Date().toISOString(),
      report,
    });
    return NextResponse.json({ run: saved }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Warm contexts suite failed." },
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
