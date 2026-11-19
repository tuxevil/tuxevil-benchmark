import { formatBytes } from "@/lib/format-bytes";
import { reasoningEffortSchema, type ReasoningEffort, type ModelProvider } from "@/lib/contracts";

export type DiscoveredModel = {
  name: string;
  size: string;
  reasoningEfforts?: ReasoningEffort[];
};

export type DiscoveredRunningModel = {
  name: string;
  vramFormatted: string;
};

export type DiscoveryResult = {
  models: DiscoveredModel[];
  runningModels: DiscoveredRunningModel[];
  activeModel: string | null;
  activeVram: string | null;
  provider: ModelProvider;
};

type OllamaTagsResponse = {
  models?: Array<{ name: string; size?: number }>;
};

type OllamaPsResponse = {
  models?: Array<{ name: string; size_vram?: number }>;
};

type OpenAIModelsResponse = {
  data?: Array<{ id?: string; name?: string; size?: number; object?: string; reasoning_effort_levels?: unknown }>;
  models?: Array<{ id?: string; name?: string; size?: number; reasoning_effort_levels?: unknown }>;
};

type LlamaCppPropsResponse = {
  chat_template_caps?: { reasoning_effort_levels?: unknown };
  default_generation_settings?: {
    model?: string;
  };
};

function reportedReasoningEfforts(value: unknown): ReasoningEffort[] {
  const levels: ReasoningEffort[] = [];
  if (!Array.isArray(value)) return levels;
  for (const entry of value) {
    const parsed = reasoningEffortSchema.safeParse(entry === "none" ? "off" : entry);
    if (parsed.success && !levels.includes(parsed.data)) levels.push(parsed.data);
  }
  return levels;
}

export async function discoverProviderModels({
  provider,
  endpoint,
  apiKey,
}: {
  provider: ModelProvider;
  endpoint: string;
  apiKey?: string | null;
}): Promise<DiscoveryResult> {
  const baseUrl = endpoint.trim().replace(/\/$/, "");

  if (provider === "ollama") {
    const [tagsRes, psRes] = await Promise.all([
      fetch(`${baseUrl}/api/tags`, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      }),
      fetch(`${baseUrl}/api/ps`, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(4_000),
      }).catch(() => null),
    ]);

    if (!tagsRes.ok) {
      throw new Error(`Ollama returned HTTP ${tagsRes.status}.`);
    }

    const tagsPayload = (await tagsRes.json()) as OllamaTagsResponse;
    const models: DiscoveredModel[] = (tagsPayload.models ?? []).map((m) => ({
      name: m.name,
      size: m.size ? formatBytes(m.size) : "local",
    }));

    let runningModels: DiscoveredRunningModel[] = [];
    if (psRes && psRes.ok) {
      try {
        const psPayload = (await psRes.json()) as OllamaPsResponse;
        runningModels = (psPayload.models ?? []).map((m) => ({
          name: m.name,
          vramFormatted: m.size_vram ? formatBytes(m.size_vram) : "Active",
        }));
      } catch {
        // Ignore ps error
      }
    }

    return {
      models,
      runningModels,
      activeModel: runningModels.length > 0 ? runningModels[0].name : null,
      activeVram: runningModels.length > 0 ? runningModels[0].vramFormatted : null,
      provider: "ollama",
    };
  }

  // Handle FreeToken or llama.cpp
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey?.trim()) {
    headers["authorization"] = `Bearer ${apiKey.trim()}`;
  }

  const candidateUrls: string[] = [];
  if (provider === "llamacpp") {
    candidateUrls.push(`${baseUrl.replace(/\/v1$/, "")}/props`);
    candidateUrls.push(`${baseUrl}/slots`);
  }
  if (baseUrl.endsWith("/v1")) {
    candidateUrls.push(`${baseUrl}/models`);
  } else {
    candidateUrls.push(`${baseUrl}/v1/models`);
    candidateUrls.push(`${baseUrl}/models`);
  }
  if (provider === "freetoken") {
    candidateUrls.push(`${baseUrl}/props`);
    candidateUrls.push(`${baseUrl}/api/tags`);
  }

  let lastError: Error | null = null;
  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        headers,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        lastError = new Error(`${provider} returned HTTP ${res.status} on ${url}`);
        continue;
      }

      const json = await res.json();

      // Case 1: llama.cpp /props with default_generation_settings.model
      if (json && (json as LlamaCppPropsResponse).default_generation_settings?.model) {
        const rawModel = (json as LlamaCppPropsResponse).default_generation_settings!.model!.trim();
        const modelName = rawModel.includes("/") ? rawModel.split("/").pop()! : rawModel;
        if (modelName) {
          return {
            models: [{
              name: modelName,
              size: "Loaded in Memory",
              reasoningEfforts: reportedReasoningEfforts((json as LlamaCppPropsResponse).chat_template_caps?.reasoning_effort_levels),
            }],
            runningModels: [{ name: modelName, vramFormatted: "Loaded in Memory" }],
            activeModel: modelName,
            activeVram: "Loaded in Memory",
            provider,
          };
        }
      }

      // Case 2: OpenAI models response { data: [...] }
      if (json && Array.isArray((json as OpenAIModelsResponse).data)) {
        const rawList = (json as OpenAIModelsResponse).data ?? [];
        const models: DiscoveredModel[] = rawList
          .map((item) => {
            const raw = String(item.id || item.name || "").trim();
            const name = raw.includes("/") && raw.endsWith(".gguf") ? raw.split("/").pop()! : raw;
            return {
              name,
              size: item.size ? formatBytes(item.size) : "Loaded in Memory",
              reasoningEfforts: reportedReasoningEfforts(item.reasoning_effort_levels),
            };
          })
          .filter((item) => Boolean(item.name));

        if (models.length > 0) {
          return {
            models,
            runningModels: [{ name: models[0].name, vramFormatted: "Loaded in Memory" }],
            activeModel: models[0].name,
            activeVram: "Loaded in Memory",
            provider,
          };
        }
      }

      // Case 3: Ollama-style { models: [...] }
      if (json && Array.isArray((json as OpenAIModelsResponse).models)) {
        const rawList = (json as OpenAIModelsResponse).models ?? [];
        const models: DiscoveredModel[] = rawList
          .map((item) => {
            const raw = String(item.name || item.id || "").trim();
            const name = raw.includes("/") && raw.endsWith(".gguf") ? raw.split("/").pop()! : raw;
            return {
              name,
              size: item.size ? formatBytes(item.size) : "Loaded in Memory",
              reasoningEfforts: reportedReasoningEfforts(item.reasoning_effort_levels),
            };
          })
          .filter((item) => Boolean(item.name));

        if (models.length > 0) {
          return {
            models,
            runningModels: [{ name: models[0].name, vramFormatted: "Loaded in Memory" }],
            activeModel: models[0].name,
            activeVram: "Loaded in Memory",
            provider,
          };
        }
      }

      // Case 4: llama.cpp /slots returning array of slots with model
      if (Array.isArray(json) && json.length > 0 && json[0]?.model) {
        const rawModel = String(json[0].model).trim();
        const modelName = rawModel.includes("/") ? rawModel.split("/").pop()! : rawModel;
        return {
          models: [{ name: modelName, size: "Loaded in Memory" }],
          runningModels: [{ name: modelName, vramFormatted: "Loaded in Memory" }],
          activeModel: modelName,
          activeVram: "Loaded in Memory",
          provider,
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error(`Could not discover models from ${provider} at ${baseUrl}.`);

  throw lastError ?? new Error(`Could not discover models from ${provider} at ${baseUrl}.`);
}
