import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { experimentVariantBindingSchema } from "@/lib/experiment-records";
import { getExperiment, updateExperimentVariantBinding } from "@/lib/experiment-store";

async function handleGET(
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

async function handlePATCH(
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

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}

export async function PATCH(...args: Parameters<typeof handlePATCH>) {
 const denied=await requireAdmin("PATCH"); if(denied)return denied; return handlePATCH(...args);
}
