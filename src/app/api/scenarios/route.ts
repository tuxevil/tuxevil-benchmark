import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { isPublicBenchmarkSuite } from "@/lib/public-benchmarks";
import { scenarioSchema } from "@/lib/contracts";

export async function GET(request: Request) {
  await benchmarkStore.hydrate();
  const includePublicBenchmarks = new URL(request.url).searchParams.get("includePublicBenchmarks") === "true";
  return NextResponse.json({ scenarios: benchmarkStore.listScenarios({ includePublicBenchmarks }) });
}

export async function POST(request: Request) {
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
