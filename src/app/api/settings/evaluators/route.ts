import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { evaluatorUpsertSchema } from "@/lib/contracts";

async function handlePOST(request: Request) {
  await benchmarkStore.hydrate();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = evaluatorUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid evaluator.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const evaluator = await benchmarkStore.addEvaluator(parsed.data);
    return NextResponse.json({ settings: benchmarkStore.getSettings(), evaluator });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not persist evaluator." },
      { status: 503 },
    );
  }
}

export async function POST(...args: Parameters<typeof handlePOST>) {
 const denied=await requireAdmin("POST"); if(denied)return denied; return handlePOST(...args);
}
