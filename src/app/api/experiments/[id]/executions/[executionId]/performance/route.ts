import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { buildExperimentPerformanceReport } from "@/lib/performance-report";

async function handleGET(
  _request: Request,
  { params }: { params: Promise<{ id: string; executionId: string }> },
) {
  const { id, executionId } = await params;
  try {
    return NextResponse.json(await buildExperimentPerformanceReport(id, executionId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build performance report.";
    return NextResponse.json(
      { error: message },
      { status: message.includes("not found") ? 404 : 400 },
    );
  }
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}
