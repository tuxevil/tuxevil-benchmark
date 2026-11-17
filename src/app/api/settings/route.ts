import { NextResponse } from "next/server";
import { benchmarkStore } from "@/lib/benchmark-store";
import { settingsUpdateSchema } from "@/lib/contracts";
import { validateProviderEndpoint } from "@/lib/endpoints";

export async function GET() {
  await benchmarkStore.hydrate();
  return NextResponse.json({ settings: benchmarkStore.getSettings() });
}

export async function PATCH(request: Request) {
  await benchmarkStore.hydrate();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = settingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings.", details: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.ollamaUrl) {
    const endpointError = validateProviderEndpoint(parsed.data.ollamaUrl, "Ollama");
    if (endpointError) return NextResponse.json({ error: endpointError }, { status: 400 });
  }
  if (parsed.data.freetokenUrl) {
    const endpointError = validateProviderEndpoint(parsed.data.freetokenUrl, "FreeToken");
    if (endpointError) return NextResponse.json({ error: endpointError }, { status: 400 });
  }
  if (parsed.data.llamacppUrl) {
    const endpointError = validateProviderEndpoint(parsed.data.llamacppUrl, "llama.cpp");
    if (endpointError) return NextResponse.json({ error: endpointError }, { status: 400 });
  }
  if (parsed.data.strataUrl) {
    const endpointError = validateProviderEndpoint(parsed.data.strataUrl, "Strata");
    if (endpointError) return NextResponse.json({ error: endpointError }, { status: 400 });
  }

  try {
    return NextResponse.json({ settings: await benchmarkStore.updateSettings(parsed.data) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not persist settings." }, { status: 503 });
  }
}
