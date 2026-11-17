import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { compareExperimentVariants } from "@/lib/experiment-observation-store";

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const variantId = url.searchParams.get("variantId");
  const baselineRepeatVariantId = url.searchParams.get("baselineRepeatVariantId");

  if (!variantId) {
    return NextResponse.json({ error: "variantId is required." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await compareExperimentVariants(id, variantId, baselineRepeatVariantId),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not compare experiment variants.";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}
