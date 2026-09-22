import { NextResponse } from "next/server";
import { modelArtifactInputSchema } from "@/lib/experiment-metadata";
import { listModelArtifacts, upsertModelArtifact } from "@/lib/experiment-metadata-store";

export async function GET() {
  return NextResponse.json({ artifacts: await listModelArtifacts() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = modelArtifactInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid model artifact.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return NextResponse.json({ artifact: await upsertModelArtifact(parsed.data) }, { status: 201 });
}
