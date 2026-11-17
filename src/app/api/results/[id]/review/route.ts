import { requireAdmin } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { humanReviewSchema } from "@/lib/contracts";

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const match = benchmarkStore.findResult(id);
  if (!match) return NextResponse.json({ error: "Result not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = humanReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid human review.", details: parsed.error.flatten() }, { status: 400 });
  }

  const run = await benchmarkStore.updateHumanReview(match.id, id, parsed.data.status, parsed.data.notes);
  return NextResponse.json({ run });
}

export async function PATCH(...args: Parameters<typeof handlePATCH>) {
 const denied=await requireAdmin("PATCH"); if(denied)return denied; return handlePATCH(...args);
}
