import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { isPublicBenchmarkSuite } from "@/lib/public-benchmarks";
import { scenarioSchema } from "@/lib/contracts";

async function handleGET(request: Request) {
  await benchmarkStore.hydrate();
  const includePublicBenchmarks = new URL(request.url).searchParams.get("includePublicBenchmarks") === "true";
  return NextResponse.json({ scenarios: benchmarkStore.listScenarios({ includePublicBenchmarks }) });
}

async function handlePOST(request: Request) {
  await benchmarkStore.hydrate();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = scenarioSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid scenario." }, { status: 400 });
  if (parsed.data.suiteKey === "practical-slm" || isPublicBenchmarkSuite(parsed.data.suiteKey)) {
    return NextResponse.json(
      { error: "This suite key is reserved for built-in versioned scenarios." },
      { status: 409 },
    );
  }
  return NextResponse.json({ scenario: await benchmarkStore.createScenario(parsed.data) }, { status: 201 });
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}

export async function POST(...args: Parameters<typeof handlePOST>) {
 const denied=await requireAdmin("POST"); if(denied)return denied; return handlePOST(...args);
}
