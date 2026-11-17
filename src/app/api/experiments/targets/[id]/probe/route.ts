import { NextResponse } from "next/server";
import { z } from "zod";
import { getExecutionTargetConnection } from "@/lib/execution-target-store";
import { probeProviderSnapshot } from "@/lib/providers/provider-probe";
import {
  upsertExecutionEnvironment,
  upsertModelArtifact,
} from "@/lib/experiment-metadata-store";

const probeInputSchema = z.object({
  model: z.string().trim().max(512).nullish(),
  register: z.boolean().default(true),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = probeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid probe request.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const target = await getExecutionTargetConnection(id);
    if (!target) {
      return NextResponse.json({ error: "Execution target not found." }, { status: 404 });
    }

    const snapshot = await probeProviderSnapshot({
      provider: target.provider,
      endpoint: target.endpoint,
      apiKey: target.apiKey,
      model: parsed.data.model ?? null,
      label: target.label,
    });

    if (!parsed.data.register) {
      return NextResponse.json({ snapshot });
    }

    const artifactInput = {
      ...snapshot.artifact,
      metadata: { ...snapshot.artifact.metadata, executionTargetId: id },
    };
    const environmentInput = {
      ...snapshot.environment,
      metadata: { ...snapshot.environment.metadata, executionTargetId: id },
    };
    const [artifact, environment] = await Promise.all([
      upsertModelArtifact(artifactInput),
      upsertExecutionEnvironment(environmentInput),
    ]);

    return NextResponse.json({
      snapshot,
      registered: { artifact, environment },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider probe failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
