import { afterEach, describe, expect, it, vi } from "vitest";
import { listOllamaModels } from "./ollama";

function stubFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("listOllamaModels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns installed and running models from the tuxevil Benchmark endpoint", async () => {
    stubFetch({
      models: [{ name: "qwen3:4b", size: "2.5 GB" }],
      runningModels: [{ name: "qwen3:4b", vramFormatted: "1.8 GB" }],
      activeModel: "qwen3:4b",
      activeVram: "1.8 GB",
    });

    const result = (await listOllamaModels()) as {
      models: Array<{ name: string }>;
      activeModel: string | null;
    };
    expect(result.models).toHaveLength(1);
    expect(result.models[0].name).toBe("qwen3:4b");
    expect(result.activeModel).toBe("qwen3:4b");
    const [url] = (vi.mocked(fetch).mock.calls[0] as [string]);
    expect(url).toBe("http://localhost:3000/api/ollama/models");
  });

  it("tolerates a missing running section", async () => {
    stubFetch({ models: [{ name: "lfm2.5:8b", size: "5.2 GB" }] });

    const result = (await listOllamaModels()) as {
      models: Array<{ name: string }>;
      runningModels: unknown[];
      activeModel: string | null;
    };
    expect(result.models).toHaveLength(1);
    expect(result.runningModels).toEqual([]);
    expect(result.activeModel).toBeNull();
  });
});
