import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { executionTargetUpdateSchema } from "@/lib/execution-targets";
import {
  deleteExecutionTarget,
  getExecutionTarget,
  updateExecutionTarget,
} from "@/lib/execution-target-store";

async function handleGET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = await getExecutionTarget(id);
  return target
    ? NextResponse.json({ target })
    : NextResponse.json({ error: "Execution target not found." }, { status: 404 });
}

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = executionTargetUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid execution target update.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const target = await updateExecutionTarget(id, parsed.data);
    return target
      ? NextResponse.json({ target })
      : NextResponse.json({ error: "Execution target not found." }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update execution target.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function handleDELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deleted = await deleteExecutionTarget(id);
  return deleted
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "Execution target not found." }, { status: 404 });
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}

export async function PATCH(...args: Parameters<typeof handlePATCH>) {
 const denied=await requireAdmin("PATCH"); if(denied)return denied; return handlePATCH(...args);
}

export async function DELETE(...args: Parameters<typeof handleDELETE>) {
 const denied=await requireAdmin("DELETE"); if(denied)return denied; return handleDELETE(...args);
}
