import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { executionTargetInputSchema } from "@/lib/execution-targets";
import { createExecutionTarget, listExecutionTargets } from "@/lib/execution-target-store";

async function handleGET() {
  return NextResponse.json({ targets: await listExecutionTargets() });
}

async function handlePOST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = executionTargetInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid execution target.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ target: await createExecutionTarget(parsed.data) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create execution target.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}

export async function POST(...args: Parameters<typeof handlePOST>) {
 const denied=await requireAdmin("POST"); if(denied)return denied; return handlePOST(...args);
}
