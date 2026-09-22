import { NextResponse } from "next/server";
import { experimentInputSchema } from "@/lib/experiment-records";
import { createExperiment, listExperiments } from "@/lib/experiment-store";

export async function GET() {
  return NextResponse.json({ experiments: await listExperiments() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = experimentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid experiment.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return NextResponse.json({ experiment: await createExperiment(parsed.data) }, { status: 201 });
}
