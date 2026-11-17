import { NextResponse } from "next/server";
import { reconcileExperimentExecution } from "@/lib/experiment-runner";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; executionId: string }> },
) {
  const { id, executionId } = await params;
  try {
    return NextResponse.json(await reconcileExperimentExecution(id, executionId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load experiment execution.";
    return NextResponse.json(
      { error: message },
      { status: message.includes("not found") ? 404 : 400 },
    );
  }
}
