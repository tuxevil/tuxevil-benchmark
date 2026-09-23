import { NextResponse } from "next/server";
import { experimentExecutionInputSchema } from "@/lib/experiment-executions";
import { startExperimentExecution } from "@/lib/experiment-runner";

export async function POST(
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

  const parsed = experimentExecutionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid experiment execution request.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const execution = await startExperimentExecution(id, parsed.data);
    return NextResponse.json(execution, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start experiment execution.";
    const status = message === "Experiment not found." ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
