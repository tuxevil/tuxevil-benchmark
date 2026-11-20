import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { isPublicBenchmarkSuite } from "@/lib/public-benchmarks";
import { scenarioSchema } from "@/lib/contracts";

async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const scenario = benchmarkStore.getScenario(id);
  return scenario
    ? NextResponse.json({ scenario })
    : NextResponse.json({ error: "Scenario not found." }, { status: 404 });
}

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const existing = benchmarkStore.getScenario(id);
  if (existing?.suiteKey === "practical-slm" || isPublicBenchmarkSuite(existing?.suiteKey)) {
    return NextResponse.json(
      { error: "Built-in versioned scenarios are immutable. Duplicate the scenario to customize it." },
      { status: 409 },
    );
  }
  const body = await readJson(request);
  const parsed = scenarioSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid scenario." }, { status: 400 });
  if (parsed.data.suiteKey === "practical-slm" || isPublicBenchmarkSuite(parsed.data.suiteKey)) {
    return NextResponse.json(
      { error: "This suite key is reserved for built-in versioned scenarios." },
      { status: 409 },
    );
  }
  const scenario = await benchmarkStore.updateScenario(id, parsed.data);
  return scenario
    ? NextResponse.json({ scenario })
    : NextResponse.json({ error: "Scenario not found." }, { status: 404 });
}

async function handleDELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const existing = benchmarkStore.getScenario(id);
  if (existing?.suiteKey === "practical-slm" || isPublicBenchmarkSuite(existing?.suiteKey)) {
    return NextResponse.json(
      { error: "Built-in versioned scenarios are immutable." },
      { status: 409 },
    );
  }
  return (await benchmarkStore.deleteScenario(id))
    ? new Response(null, { status: 204 })
    : NextResponse.json({ error: "Scenario not found." }, { status: 404 });
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}

export async function PATCH(...args: Parameters<typeof handlePATCH>) {
 const denied=await requireAdmin("PATCH"); if(denied)return denied; return handlePATCH(...args);
}

export async function DELETE(...args: Parameters<typeof handleDELETE>) {
 const denied=await requireAdmin("DELETE"); if(denied)return denied; return handleDELETE(...args);
}
