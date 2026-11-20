import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { modelProviderSchema } from "@/lib/contracts";
import { loadPersistedSettings } from "@/lib/database";
import { importExecutionTarget } from "@/lib/execution-target-store";

export async function POST(request: Request) {
  const denied = await requireAdmin("POST");
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const provider = modelProviderSchema.safeParse(body?.provider);
  if (!provider.success) {
    return NextResponse.json({ error: "Select a valid provider." }, { status: 400 });
  }

  try {
    const settings = await loadPersistedSettings();
    if (!settings) {
      return NextResponse.json({ error: "Save the provider connection in Settings first." }, { status: 409 });
    }
    const connections = {
      ollama: { label: "Ollama (Settings)", endpoint: settings.ollamaUrl },
      llamacpp: { label: "llama.cpp (Settings)", endpoint: settings.llamacppUrl, apiKey: settings.llamacppApiKey, apiKeyConfigured: settings.llamacppApiKeyConfigured },
      freetoken: { label: "FreeToken (Settings)", endpoint: settings.freetokenUrl, apiKey: settings.freetokenApiKey, apiKeyConfigured: settings.freetokenApiKeyConfigured },
      strata: { label: "Strata (Settings)", endpoint: settings.strataUrl, apiKey: settings.strataApiKey, apiKeyConfigured: settings.strataApiKeyConfigured },
    };
    const connection = connections[provider.data];
    if (!connection.endpoint) {
      return NextResponse.json({ error: "Save the provider connection in Settings first." }, { status: 409 });
    }
    if ("apiKeyConfigured" in connection && connection.apiKeyConfigured && !connection.apiKey) {
      return NextResponse.json({ error: "The saved API key could not be read." }, { status: 409 });
    }
    const target = await importExecutionTarget({
      provider: provider.data,
      label: connection.label,
      endpoint: connection.endpoint,
      apiKey: "apiKey" in connection ? connection.apiKey ?? undefined : undefined,
    });
    return NextResponse.json({ target });
  } catch {
    return NextResponse.json({ error: "Could not read the connection from Settings." }, { status: 400 });
  }
}
