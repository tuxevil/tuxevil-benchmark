import { NextResponse } from "next/server";
import { executionEnvironmentInputSchema } from "@/lib/experiment-metadata";
import {
  listExecutionEnvironments,
  upsertExecutionEnvironment,
} from "@/lib/experiment-metadata-store";

export async function GET() {
  return NextResponse.json({ environments: await listExecutionEnvironments() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = executionEnvironmentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid execution environment.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { environment: await upsertExecutionEnvironment(parsed.data) },
    { status: 201 },
  );
}
