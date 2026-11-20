import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { experimentObservationBatchSchema } from "@/lib/experiment-observations";
import {
  listExperimentObservations,
  upsertExperimentObservations,
} from "@/lib/experiment-observation-store";

async function handleGET(
  _request: Request,
  { params }: { params: Promise<{ id: string; variantId: string }> },
) {
  const { id, variantId } = await params;
  try {
    return NextResponse.json({
      observations: await listExperimentObservations(id, variantId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load observations.";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

async function handlePOST(
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

  const parsed = experimentObservationBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid observation batch.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      observations: await upsertExperimentObservations(id, variantId, parsed.data.observations),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not persist observations.";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}

export async function POST(...args: Parameters<typeof handlePOST>) {
 const denied=await requireAdmin("POST"); if(denied)return denied; return handlePOST(...args);
}
