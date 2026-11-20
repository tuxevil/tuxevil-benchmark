import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverProviderModels } from "./model-discovery";

describe("discoverProviderModels", () => {
  afterEach(() => vi.restoreAllMocks());

  it("discovers models from Ollama tags endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/tags")) {
          return new Response(JSON.stringify({ models: [{ name: "llama3.2:latest", size: 2_000_000_000 }] }), { status: 200 });
        }
        if (url.includes("/api/ps")) {
          return new Response(JSON.stringify({ models: [{ name: "llama3.2:latest", size_vram: 1_500_000_000 }] }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );

    const result = await discoverProviderModels({
      provider: "ollama",
      endpoint: "http://localhost:11434",
    });

    expect(result.provider).toBe("ollama");
    expect(result.models.length).toBe(1);
    expect(result.models[0].name).toBe("llama3.2:latest");
    expect(result.activeModel).toBe("llama3.2:latest");
  });

  it("discovers models from FreeToken OpenAI-compatible endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/models")) {
          return new Response(
            JSON.stringify({
              data: [
                { id: "freetoken-model-1", size: 4_000_000_000 },
                { id: "freetoken-model-2" },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );

    const result = await discoverProviderModels({
      provider: "freetoken",
      endpoint: "http://localhost:8000/v1",
      apiKey: "test-token",
    });

    expect(result.provider).toBe("freetoken");
    expect(result.models.length).toBe(2);
    expect(result.models[0].name).toBe("freetoken-model-1");
    expect(result.models[1].name).toBe("freetoken-model-2");
  });

  it("discovers Strata models using bearer authentication and the v1 endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "qwen3.8-flash-next-iq3_xxs" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await discoverProviderModels({
      provider: "strata",
      endpoint: "http://10.128.128.254:8081/v1",
      apiKey: "test-strata-key",
    });
    expect(result.provider).toBe("strata");
    expect(result.models[0].name).toBe("qwen3.8-flash-next-iq3_xxs");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "http://10.128.128.254:8081/v1/models",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer test-strata-key" }) }),
    );
  });

  it("discovers models from llama.cpp endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/v1/models")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "mistral-7b-instruct.Q4_K_M.gguf" }],
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );

    const result = await discoverProviderModels({
      provider: "llamacpp",
      endpoint: "http://localhost:8080",
    });

    expect(result.provider).toBe("llamacpp");
    expect(result.models.length).toBe(1);
    expect(result.models[0].name).toBe("mistral-7b-instruct.Q4_K_M.gguf");
  });
});
