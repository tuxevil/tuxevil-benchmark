import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { evaluatorUpdateSchema } from "@/lib/contracts";

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = evaluatorUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid evaluator.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const evaluator = await benchmarkStore.updateEvaluator(id, parsed.data);
    if (!evaluator) {
      return NextResponse.json({ error: `Evaluator ${id} was not found.` }, { status: 404 });
    }
    return NextResponse.json({ settings: benchmarkStore.getSettings(), evaluator });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not persist evaluator." },
      { status: 503 },
    );
  }
}

async function handleDELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const deleted = await benchmarkStore.deleteEvaluator(id);
  if (!deleted) {
    return NextResponse.json({ error: `Evaluator ${id} was not found.` }, { status: 404 });
  }
  return NextResponse.json({ settings: benchmarkStore.getSettings(), deleted: true });
}

export async function PATCH(...args: Parameters<typeof handlePATCH>) {
 const denied=await requireAdmin("PATCH"); if(denied)return denied; return handlePATCH(...args);
}

export async function DELETE(...args: Parameters<typeof handleDELETE>) {
 const denied=await requireAdmin("DELETE"); if(denied)return denied; return handleDELETE(...args);
}
