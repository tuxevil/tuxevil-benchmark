import { NextRequest, NextResponse } from "next/server";
import { httpUrlSchema, modelProviderSchema, type ModelProvider } from "@/lib/contracts";
import { validateProviderEndpoint } from "@/lib/endpoints";
import { discoverProviderModels } from "@/lib/providers/model-discovery";
import { benchmarkStore } from "@/lib/benchmark-store";

export async function GET(request: NextRequest) {
  await benchmarkStore.hydrate();
  const settings = benchmarkStore.getSettings();

  const providerParam = request.nextUrl.searchParams.get("provider")?.toLowerCase() || settings.activeProvider || "ollama";
  const parsedProvider = modelProviderSchema.safeParse(providerParam);
  const provider: ModelProvider = parsedProvider.success ? parsedProvider.data : "ollama";

  let defaultUrl = settings.ollamaUrl;
  if (provider === "freetoken") defaultUrl = settings.freetokenUrl;
  else if (provider === "strata") defaultUrl = settings.strataUrl;
  else if (provider === "llamacpp") defaultUrl = settings.llamacppUrl;

  const endpointParam = request.nextUrl.searchParams.get("url")?.trim() || defaultUrl;
  const parsedEndpoint = httpUrlSchema.safeParse(endpointParam);
  if (!parsedEndpoint.success) {
    return NextResponse.json({ error: `A valid URL is required for ${provider}.` }, { status: 400 });
  }

  const endpointError = validateProviderEndpoint(parsedEndpoint.data, provider);
  if (endpointError) return NextResponse.json({ error: endpointError }, { status: 400 });

  let apiKey: string | null = null;
  if (provider === "freetoken") {
    apiKey = await benchmarkStore.getFreetokenApiKey();
  } else if (provider === "strata") {
    apiKey = await benchmarkStore.getStrataApiKey();
  } else if (provider === "llamacpp") {
    apiKey = await benchmarkStore.getLlamacppApiKey();
  }

  try {
    const result = await discoverProviderModels({
      provider,
      endpoint: parsedEndpoint.data,
      apiKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown connection error.";
    return NextResponse.json({ error: `Could not reach ${provider}: ${message}` }, { status: 502 });
  }
}
