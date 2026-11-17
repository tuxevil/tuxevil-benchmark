import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { aggregateLeaderboard } from "@/lib/database";

async function handleGET(request: Request) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category")?.trim() || "ALL";
  const paramRange = url.searchParams.get("paramRange")?.trim() || "All";
  const difficultyRaw = url.searchParams.get("difficulty")?.trim() || "ALL";
  const reasoningEffort = url.searchParams.get("reasoningEffort")?.trim() || "ALL";

  const wqRaw = url.searchParams.get("wq");
  const wsRaw = url.searchParams.get("ws");
  const wvRaw = url.searchParams.get("wv");

  const weights = {
    quality: wqRaw != null ? Number(wqRaw) : 40,
    security: wsRaw != null ? Number(wsRaw) : 40,
    speed: wvRaw != null ? Number(wvRaw) : 20,
  };

  const leaderboardData = await aggregateLeaderboard({
    category,
    paramRange,
    difficulty: ["easy", "medium", "hard"].includes(difficultyRaw)
      ? (difficultyRaw as "easy" | "medium" | "hard")
      : "ALL",
    reasoningEffort,
    weights,
  });

  return NextResponse.json(leaderboardData);
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}
