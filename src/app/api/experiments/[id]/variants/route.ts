import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { experimentVariantInputSchema } from "@/lib/experiment-records";
import { createExperimentVariant, getExperiment } from "@/lib/experiment-store";

async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const experiment = await getExperiment(id);
  return experiment
    ? NextResponse.json({ variants: experiment.variants })
    : NextResponse.json({ error: "Experiment not found." }, { status: 404 });
}

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = experimentVariantInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid experiment variant.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      { variant: await createExperimentVariant(id, parsed.data) },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create variant.";
    const status = message === "Experiment not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}

export async function POST(...args: Parameters<typeof handlePOST>) {
 const denied=await requireAdmin("POST"); if(denied)return denied; return handlePOST(...args);
}
