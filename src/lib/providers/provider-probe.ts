import type { ModelProvider } from "@/lib/contracts";
import type { ExecutionEnvironmentInput, ModelArtifactInput } from "@/lib/experiment-metadata";
import { discoverProviderModels } from "@/lib/providers/model-discovery";

export type ProviderSnapshot = {
  provider: ModelProvider;
  selectedModel: string;
  discoveredModels: string[];
  artifact: ModelArtifactInput;
  environment: ExecutionEnvironmentInput;
  evidence: {
    providerVersion: string | null;
    modelPath: string | null;
    buildInfo: string | null;
    active: boolean;
    sourceEndpoints: string[];
  };
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function basename(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).pop() ?? null;
}

function sha256FromDigest(value: unknown): string | null {
  const digest = stringValue(value);
  if (!digest) return null;
  const match = digest.match(/(?:sha256:)?([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : null;
}

function buildHeaders(apiKey?: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey?.trim()) headers.authorization = `Bearer ${apiKey.trim()}`;
  return headers;
}

async function fetchJson(url: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

function sanitizeServerArgs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const args = input.map(String);
  const output: string[] = [];
  const skipValueFor = new Set([
    "-m", "--model", "--model-url", "--host", "--port", "--api-key", "--api-key-file",
    "--ssl-key-file", "--ssl-cert-file", "--log-file",
  ]);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (i === 0 && /(?:^|\/)llama-(?:server|router)$/.test(arg)) continue;
    const key = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (skipValueFor.has(key)) {
      if (!arg.includes("=")) i += 1;
      continue;
    }
    output.push(arg);
  }
  return output;
}

function flagValue(args: string[], names: string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    for (const name of names) {
      if (arg === name && args[i + 1] !== undefined) return args[i + 1];
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
  }
  return null;
}

function intFlag(args: string[], names: string[]): number | null {
  const raw = flagValue(args, names);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function boolFlag(args: string[], names: string[]): boolean | null {
  const raw = flagValue(args, names)?.toLowerCase();
  if (raw === "on" || raw === "true" || raw === "1") return true;
  if (raw === "off" || raw === "false" || raw === "0") return false;
  return null;
}

function buildInfoCommit(buildInfo: string | null): string | null {
  if (!buildInfo) return null;
  const match = buildInfo.match(/-([a-f0-9]{7,40})(?:\b|$)/i);
  return match?.[1] ?? null;
}

async function probeOllama(input: {
  endpoint: string;
  apiKey?: string | null;
  model?: string | null;
  label: string;
}): Promise<ProviderSnapshot> {
  const base = input.endpoint.replace(/\/$/, "");
  const headers = buildHeaders(input.apiKey);
  const [tagsRaw, psRaw, versionRaw] = await Promise.all([
    fetchJson(`${base}/api/tags`, { headers }),
    fetchJson(`${base}/api/ps`, { headers }).catch(() => ({})),
    fetchJson(`${base}/api/version`, { headers }).catch(() => ({})),
  ]);
  const tags = asObject(tagsRaw);
  const ps = asObject(psRaw);
  const tagModels = Array.isArray(tags.models) ? tags.models.map(asObject) : [];
  const runningModels = Array.isArray(ps.models) ? ps.models.map(asObject) : [];
  const discoveredModels = tagModels.map((item) => String(item.name ?? "")).filter(Boolean);
  const activeName = runningModels.map((item) => String(item.name ?? "")).find(Boolean) ?? null;
  const selected = input.model?.trim() || activeName || discoveredModels[0];
  if (!selected) throw new Error("No models were reported by Ollama.");

  if (input.model && !discoveredModels.includes(selected) && !runningModels.some((item) => item.name === selected)) {
    throw new Error(`Model "${selected}" was not reported by this Ollama target.`);
  }

  const show = asObject(await fetchJson(`${base}/api/show`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: selected }),
  }));
  const details = asObject(show.details);
  const modelInfo = asObject(show.model_info);
  const tag = tagModels.find((item) => item.name === selected) ?? {};
  const running = runningModels.find((item) => item.name === selected) ?? {};
  const architecture = stringValue(modelInfo["general.architecture"]) ?? stringValue(details.family);
  const totalParameters = numberValue(modelInfo["general.parameter_count"]);
  const digest = tag.digest ?? show.digest;
  const providerVersion = stringValue(asObject(versionRaw).version);

  return {
    provider: "ollama",
    selectedModel: selected,
    discoveredModels,
    artifact: {
      displayName: selected,
      baseModel: selected,
      architecture,
      totalParameters,
      activeParameters: null,
      quantization: stringValue(details.quantization_level),
      effectiveBitsPerWeight: null,
      artifactSizeBytes: numberValue(tag.size),
      artifactSha256: sha256FromDigest(digest),
      sourceUri: null,
      sourceRevision: stringValue(digest),
      tokenizerRevision: null,
      metadata: {
        provider: "ollama",
        format: details.format ?? null,
        family: details.family ?? null,
        families: details.families ?? [],
        parameterSizeLabel: details.parameter_size ?? null,
        capabilities: Array.isArray(show.capabilities) ? show.capabilities : [],
        modelContextLength: numberValue(modelInfo[`${architecture ?? ""}.context_length`]),
      },
    },
    environment: {
      label: `${input.label} · ${selected}`,
      runtime: "ollama",
      runtimeVersion: providerVersion,
      runtimeCommit: null,
      gpuModels: [],
      totalVramBytes: numberValue(running.size_vram),
      cpuModel: null,
      systemRamBytes: null,
      driverVersion: null,
      computeRuntimeVersion: null,
      os: null,
      kernel: null,
      runtimeFlags: [],
      kvCacheK: null,
      kvCacheV: null,
      contextSize: numberValue(running.context_length),
      gpuOffload: null,
      flashAttention: null,
      batchSize: null,
      ubatchSize: null,
      parallel: null,
      metadata: {
        provider: "ollama",
        active: Boolean(running.name),
      },
    },
    evidence: {
      providerVersion,
      modelPath: null,
      buildInfo: null,
      active: Boolean(running.name),
      sourceEndpoints: ["/api/tags", "/api/ps", "/api/version", "/api/show"],
    },
  };
}

async function probeLlamaCpp(input: {
  endpoint: string;
  apiKey?: string | null;
  model?: string | null;
  label: string;
}): Promise<ProviderSnapshot> {
  const supplied = input.endpoint.replace(/\/$/, "");
  const root = supplied.endsWith("/v1") ? supplied.slice(0, -3) : supplied;
  const headers = buildHeaders(input.apiKey);

  const [propsRaw, modelsRaw] = await Promise.all([
    fetchJson(`${root}/props`, { headers }),
    fetchJson(`${root}/models`, { headers })
      .catch(() => fetchJson(`${root}/v1/models`, { headers }))
      .catch(() => ({ data: [] })),
  ]);

  const props = asObject(propsRaw);
  const defaultSettings = asObject(props.default_generation_settings);
  const modelEntries = Array.isArray(asObject(modelsRaw).data)
    ? (asObject(modelsRaw).data as unknown[]).map(asObject)
    : Array.isArray(asObject(modelsRaw).models)
      ? (asObject(modelsRaw).models as unknown[]).map(asObject)
      : [];

  const path = stringValue(props.model_path);
  const pathName = basename(path);
  const discoveredModels = modelEntries
    .map((entry) => stringValue(entry.id) ?? stringValue(entry.name) ?? basename(stringValue(entry.path)))
    .filter((value): value is string => Boolean(value));

  const selected = input.model?.trim()
    || stringValue(defaultSettings.model)
    || pathName
    || discoveredModels[0];
  if (!selected) throw new Error("No model was reported by llama.cpp.");

  const entry = modelEntries.find((candidate) => {
    const names = [
      stringValue(candidate.id),
      stringValue(candidate.name),
      basename(stringValue(candidate.path)),
    ].filter(Boolean);
    return names.includes(selected);
  }) ?? {};
  const details = asObject(entry.details);
  const architectureObject = asObject(entry.architecture);
  const status = asObject(entry.status);
  const rawArgs = Array.isArray(status.args) ? status.args.map(String) : [];
  const args = sanitizeServerArgs(rawArgs);
  const buildInfo = stringValue(props.build_info);
  const runtimeCommit = buildInfoCommit(buildInfo);
  const nCtx = numberValue(defaultSettings.n_ctx);
  const modelPath = stringValue(entry.path) ?? path;
  const modelName = stringValue(entry.id) ?? stringValue(entry.name) ?? basename(modelPath) ?? selected;
  const quant = stringValue(details.quantization_level);
  const architecture =
    stringValue(details.family)
    ?? stringValue(architectureObject.name)
    ?? stringValue(architectureObject.model)
    ?? stringValue(architectureObject.type);

  return {
    provider: "llamacpp",
    selectedModel: modelName,
    discoveredModels: discoveredModels.length ? discoveredModels : [modelName],
    artifact: {
      displayName: basename(modelPath) ?? modelName,
      baseModel: modelName,
      architecture,
      totalParameters: numberValue(entry.parameter_count),
      activeParameters: null,
      quantization: quant,
      effectiveBitsPerWeight: null,
      artifactSizeBytes: numberValue(entry.size),
      artifactSha256: sha256FromDigest(entry.digest),
      sourceUri: null,
      sourceRevision: stringValue(entry.digest),
      tokenizerRevision: null,
      metadata: {
        provider: "llamacpp",
        format: details.format ?? null,
        family: details.family ?? null,
        parameterSizeLabel: details.parameter_size ?? null,
      },
    },
    environment: {
      label: `${input.label} · ${basename(modelPath) ?? modelName}`,
      runtime: "llama.cpp",
      runtimeVersion: buildInfo,
      runtimeCommit,
      gpuModels: [],
      totalVramBytes: null,
      cpuModel: null,
      systemRamBytes: null,
      driverVersion: null,
      computeRuntimeVersion: null,
      os: null,
      kernel: null,
      runtimeFlags: args,
      kvCacheK: flagValue(args, ["-ctk", "--cache-type-k"]),
      kvCacheV: flagValue(args, ["-ctv", "--cache-type-v"]),
      contextSize: nCtx ?? intFlag(args, ["-c", "--ctx-size"]),
      gpuOffload: intFlag(args, ["-ngl", "--n-gpu-layers"]),
      flashAttention: boolFlag(args, ["-fa", "--flash-attn"]),
      batchSize: intFlag(args, ["-b", "--batch-size"]),
      ubatchSize: intFlag(args, ["-ub", "--ubatch-size"]),
      parallel: numberValue(props.total_slots) ?? intFlag(args, ["-np", "--parallel"]),
      metadata: {
        provider: "llamacpp",
        modelPathBasename: basename(modelPath),
        serverArgs: args,
        modelStatus: stringValue(status.value),
        chatTemplateCaps: asObject(props.chat_template_caps),
        modalities: asObject(props.modalities),
      },
    },
    evidence: {
      providerVersion: buildInfo,
      modelPath: basename(modelPath),
      buildInfo,
      active: stringValue(status.value) === "loaded" || Boolean(path),
      sourceEndpoints: ["/props", "/models"],
    },
  };
}

async function probeGeneric(input: {
  provider: "freetoken";
  endpoint: string;
  apiKey?: string | null;
  model?: string | null;
  label: string;
}): Promise<ProviderSnapshot> {
  const discovery = await discoverProviderModels({
    provider: input.provider,
    endpoint: input.endpoint,
    apiKey: input.apiKey,
  });
  const selected = input.model?.trim() || discovery.activeModel || discovery.models[0]?.name;
  if (!selected) throw new Error(`No models were reported by ${input.provider}.`);
  if (input.model && !discovery.models.some((model) => model.name === selected)) {
    throw new Error(`Model "${selected}" was not reported by this target.`);
  }

  return {
    provider: input.provider,
    selectedModel: selected,
    discoveredModels: discovery.models.map((model) => model.name),
    artifact: {
      displayName: selected,
      baseModel: selected,
      architecture: null,
      totalParameters: null,
      activeParameters: null,
      quantization: null,
      effectiveBitsPerWeight: null,
      artifactSizeBytes: null,
      artifactSha256: null,
      sourceUri: null,
      sourceRevision: null,
      tokenizerRevision: null,
      metadata: { provider: input.provider },
    },
    environment: {
      label: `${input.label} · ${selected}`,
      runtime: input.provider,
      runtimeVersion: null,
      runtimeCommit: null,
      gpuModels: [],
      totalVramBytes: null,
      cpuModel: null,
      systemRamBytes: null,
      driverVersion: null,
      computeRuntimeVersion: null,
      os: null,
      kernel: null,
      runtimeFlags: [],
      kvCacheK: null,
      kvCacheV: null,
      contextSize: null,
      gpuOffload: null,
      flashAttention: null,
      batchSize: null,
      ubatchSize: null,
      parallel: null,
      metadata: { provider: input.provider },
    },
    evidence: {
      providerVersion: null,
      modelPath: null,
      buildInfo: null,
      active: discovery.activeModel === selected,
      sourceEndpoints: ["/models"],
    },
  };
}

export async function probeProviderSnapshot(input: {
  provider: ModelProvider;
  endpoint: string;
  apiKey?: string | null;
  model?: string | null;
  label: string;
}): Promise<ProviderSnapshot> {
  if (input.provider === "ollama") return probeOllama(input);
  if (input.provider === "llamacpp") return probeLlamaCpp(input);
  return probeGeneric({ ...input, provider: "freetoken" });
}
