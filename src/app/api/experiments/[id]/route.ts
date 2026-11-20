import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { getExperiment } from "@/lib/experiment-store";

async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const experiment = await getExperiment(id);
  return experiment
    ? NextResponse.json(experiment)
    : NextResponse.json({ error: "Experiment not found." }, { status: 404 });
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}
