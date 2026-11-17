import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { listAnomalies } from "@/lib/database";

async function handleGET() {
  try {
    return NextResponse.json(await listAnomalies());
  } catch (error) {
    console.error("[tuxevil-benchmark] [Anomalies Failed]", error);
    return NextResponse.json({ error: "Failed to load anomalies." }, { status: 500 });
  }
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}
