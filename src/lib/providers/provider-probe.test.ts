import { afterEach, describe, expect, it, vi } from "vitest";
import { probeProviderSnapshot } from "./provider-probe";

describe("probeProviderSnapshot", () => {
  afterEach(() => vi.restoreAllMocks());

  it("captures Ollama model identity and only runtime facts actually exposed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/tags")) {
          return new Response(JSON.stringify({
            models: [{
              name: "qwen-test:latest",
              size: 12_345,
              digest: `sha256:${"a".repeat(64)}`,
            }],
          }), { status: 200 });
        }
        if (url.endsWith("/api/ps")) {
          return new Response(JSON.stringify({
            models: [{
              name: "qwen-test:latest",
              size_vram: 8_000,
              context_length: 32768,
            }],
          }), { status: 200 });
        }
        if (url.endsWith("/api/version")) {
          return new Response(JSON.stringify({ version: "0.12.3" }), { status: 200 });
        }
        if (url.endsWith("/api/show") && init?.method === "POST") {
          return new Response(JSON.stringify({
            details: {
              format: "gguf",
              family: "qwen3",
              parameter_size: "35B",
              quantization_level: "UD-IQ3_XXS",
            },
            model_info: {
              "general.architecture": "qwen3moe",
              "general.parameter_count": 35_000_000_000,
              "qwen3moe.context_length": 131072,
            },
          }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );

    const snapshot = await probeProviderSnapshot({
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      label: "beast ollama",
    });

    expect(snapshot.selectedModel).toBe("qwen-test:latest");
    expect(snapshot.artifact.architecture).toBe("qwen3moe");
    expect(snapshot.artifact.quantization).toBe("UD-IQ3_XXS");
    expect(snapshot.artifact.totalParameters).toBe(35_000_000_000);
    expect(snapshot.artifact.artifactSha256).toBe("a".repeat(64));
    expect(snapshot.environment.runtime).toBe("ollama");
    expect(snapshot.environment.runtimeVersion).toBe("0.12.3");
    expect(snapshot.environment.contextSize).toBe(32768);
    expect(snapshot.environment.totalVramBytes).toBeNull();
    expect(snapshot.environment.metadata).toMatchObject({ activeModelVramBytes: 8000 });
  });

  it("captures llama.cpp build/config while stripping connectivity and secrets from runtime flags", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/props")) {
          return new Response(JSON.stringify({
            default_generation_settings: { n_ctx: 32768 },
            total_slots: 2,
            model_path: "/models/Bonsai-27B-PQ2.gguf",
            build_info: "b7012-abcdef123",
            chat_template_caps: { tools: true },
          }), { status: 200 });
        }
        if (url.endsWith("/models")) {
          return new Response(JSON.stringify({
            data: [{
              id: "Bonsai-27B-PQ2.gguf",
              path: "/models/Bonsai-27B-PQ2.gguf",
              size: 7_200_000_000,
              details: {
                format: "gguf",
                family: "qwen3",
                parameter_size: "27B",
                quantization_level: "PQ2_0",
              },
              status: {
                value: "loaded",
                args: [
                  "llama-server",
                  "-m", "/models/Bonsai-27B-PQ2.gguf",
                  "--host", "0.0.0.0",
                  "--port", "8080",
                  "--api-key", "secret",
                  "-ctk", "q4_0",
                  "-ctv", "q4_0",
                  "-fa", "on",
                  "-ngl", "99",
                  "-b", "2048",
                  "-ub", "512",
                ],
              },
            }],
          }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );

    const snapshot = await probeProviderSnapshot({
      provider: "llamacpp",
      endpoint: "http://127.0.0.1:8080",
      label: "beast llama.cpp",
    });

    expect(snapshot.artifact.quantization).toBe("PQ2_0");
    expect(snapshot.artifact.artifactSizeBytes).toBe(7_200_000_000);
    expect(snapshot.environment.runtimeVersion).toBe("b7012-abcdef123");
    expect(snapshot.environment.runtimeCommit).toBe("abcdef123");
    expect(snapshot.environment.contextSize).toBe(32768);
    expect(snapshot.environment.parallel).toBe(2);
    expect(snapshot.environment.kvCacheK).toBe("q4_0");
    expect(snapshot.environment.kvCacheV).toBe("q4_0");
    expect(snapshot.environment.flashAttention).toBe(true);
    expect(snapshot.environment.gpuOffload).toBe(99);
    expect(snapshot.environment.batchSize).toBe(2048);
    expect(snapshot.environment.ubatchSize).toBe(512);
    expect(snapshot.environment.runtimeFlags).not.toContain("secret");
    expect(snapshot.environment.runtimeFlags).not.toContain("/models/Bonsai-27B-PQ2.gguf");
    expect(snapshot.environment.runtimeFlags).not.toContain("0.0.0.0");
  });
});
