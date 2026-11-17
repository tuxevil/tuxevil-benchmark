import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";

async function handlePOST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const run = benchmarkStore.getStoredRun(id);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  if (!["PENDING", "RUNNING"].includes(run.status)) {
    return NextResponse.json({ error: `Run is already ${run.status.toLowerCase()}.` }, { status: 409 });
  }
  return NextResponse.json({ run: benchmarkStore.pauseRun(id) });
}

export async function POST(...args: Parameters<typeof handlePOST>) {
 const denied=await requireAdmin("POST"); if(denied)return denied; return handlePOST(...args);
}
