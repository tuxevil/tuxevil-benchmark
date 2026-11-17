import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { aggregateScenarioAnalysis } from "@/lib/database";

async function handleGET(request: Request) {
  const url = new URL(request.url);
  const scenarioId = url.searchParams.get("scenarioId")?.trim() || null;
  const systemPrompt = url.searchParams.get("systemPrompt") ?? "";
  let userMessages: string[] = [];
  const raw = url.searchParams.get("userMessages");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) userMessages = parsed.map(String);
    } catch {
      return NextResponse.json({ error: "Invalid userMessages parameter." }, { status: 400 });
    }
  }
  if (!scenarioId && !systemPrompt.trim()) {
    return NextResponse.json({ error: "Provide scenarioId or systemPrompt to identify the scenario." }, { status: 400 });
  }
  try {
    return NextResponse.json(await aggregateScenarioAnalysis({ scenarioId, systemPrompt, userMessages }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}
