import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { executionEnvironmentInputSchema } from "@/lib/experiment-metadata";
import {
  listExecutionEnvironments,
  upsertExecutionEnvironment,
} from "@/lib/experiment-metadata-store";

async function handleGET() {
  return NextResponse.json({ environments: await listExecutionEnvironments() });
}

async function handlePOST(request: Request) {
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

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}

export async function POST(...args: Parameters<typeof handlePOST>) {
 const denied=await requireAdmin("POST"); if(denied)return denied; return handlePOST(...args);
}
