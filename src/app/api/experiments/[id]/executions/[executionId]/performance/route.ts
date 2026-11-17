import { NextResponse } from "next/server";
import { buildExperimentPerformanceReport } from "@/lib/performance-report";

export async function GET(
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
