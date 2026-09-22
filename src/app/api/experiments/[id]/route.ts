import { NextResponse } from "next/server";
import { getExperiment } from "@/lib/experiment-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const experiment = await getExperiment(id);
  return experiment
    ? NextResponse.json(experiment)
    : NextResponse.json({ error: "Experiment not found." }, { status: 404 });
}
