import { NextResponse } from "next/server";
import { executionTargetInputSchema } from "@/lib/execution-targets";
import { createExecutionTarget, listExecutionTargets } from "@/lib/execution-target-store";

export async function GET() {
  return NextResponse.json({ targets: await listExecutionTargets() });
}

export async function POST(request: Request) {
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
