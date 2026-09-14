import { NextResponse } from "next/server";
import { listAnomalies } from "@/lib/database";

export async function GET() {
  try {
    return NextResponse.json(await listAnomalies());
  } catch (error) {
    console.error("[tuxevil-benchmark] [Anomalies Failed]", error);
    return NextResponse.json({ error: "Failed to load anomalies." }, { status: 500 });
  }
}
