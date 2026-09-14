import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { reevaluateSchema } from "@/lib/contracts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = reevaluateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const run = await benchmarkStore.reevaluateResult(id, parsed.data.evaluatorId);
    return NextResponse.json({ run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Re-evaluation failed.";
    console.error("[tuxevil-benchmark] [Re-evaluate Failed]", { resultId: id, error: message });
    const status = /not found/i.test(message) ? 404 : /evaluator/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
