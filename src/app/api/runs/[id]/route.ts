import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";

async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const run = process.env.REDIS_URL ? await benchmarkStore.refreshRun(id) : benchmarkStore.getRun(id);
  return run ? NextResponse.json({ run }) : NextResponse.json({ error: "Run not found." }, { status: 404 });
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}
