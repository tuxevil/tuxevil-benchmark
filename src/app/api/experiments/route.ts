import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { experimentInputSchema } from "@/lib/experiment-records";
import { createExperiment, listExperiments } from "@/lib/experiment-store";

async function handleGET() {
  return NextResponse.json({ experiments: await listExperiments() });
}

async function handlePOST(request: Request) {
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

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}

export async function POST(...args: Parameters<typeof handlePOST>) {
 const denied=await requireAdmin("POST"); if(denied)return denied; return handlePOST(...args);
}
