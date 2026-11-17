import { NextResponse } from "next/server";
import { experimentVariantBindingSchema } from "@/lib/experiment-records";
import { getExperiment, updateExperimentVariantBinding } from "@/lib/experiment-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; variantId: string }> },
) {
  const { id, variantId } = await params;
  const experiment = await getExperiment(id);
  if (!experiment) return NextResponse.json({ error: "Experiment not found." }, { status: 404 });
  const variant = experiment.variants.find((item) => item.id === variantId);
  return variant
    ? NextResponse.json({ variant })
    : NextResponse.json({ error: "Variant not found in experiment." }, { status: 404 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; variantId: string }> },
) {
  const { id, variantId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = experimentVariantBindingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid experiment variant binding.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      variant: await updateExperimentVariantBinding(id, variantId, parsed.data),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update variant.";
    return NextResponse.json(
      { error: message },
      { status: message.includes("not found") ? 404 : 400 },
    );
  }
}
