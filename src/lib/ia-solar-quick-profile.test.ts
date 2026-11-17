import { describe, expect, it } from "vitest";
import { createRunSchema } from "@/lib/contracts";
import {
  IA_SOLAR_QUICK_CASES,
  IA_SOLAR_QUICK_PARAMETERS,
  IA_SOLAR_QUICK_REQUEST_SCHEMA,
  IA_SOLAR_QUICK_SAMPLES,
  quickProfileSummary,
  quickProfileCaseName,
} from "@/lib/ia-solar-quick-profile";

describe("IA Solar quick profile", () => {
  it("has a stable, short, diverse suite", () => {
    const summary = quickProfileSummary();
    expect(summary.version).toBe("ia-solar-quick@1.0.0");
    expect(summary.cases).toBe(11);
    expect(summary.turns).toBe(13);
    expect(summary.samplesPerCase).toBe(1);
    expect(summary.toolCallsTested).toBe(false);
    expect(new Set(IA_SOLAR_QUICK_CASES.map((item) => item.key)).size).toBe(summary.cases);
    expect(IA_SOLAR_QUICK_CASES.filter((item) => item.category === "SECURITY")).toHaveLength(2);
    expect(IA_SOLAR_QUICK_CASES.some((item) => item.userMessages.length > 1)).toBe(true);
  });

  it("validates every case using the existing run schema", () => {
    for (const item of IA_SOLAR_QUICK_CASES) {
      const parsed = createRunSchema.safeParse({
        provider: "llamacpp",
        providerUrl: "http://127.0.0.1:8080",
        scenarioId: null,
        category: item.category,
        attackType: item.attackType,
        systemPrompt: item.systemPrompt,
        userMessages: [...item.userMessages],
        models: ["gemma4-e2b-qat"],
        samplesPerModel: IA_SOLAR_QUICK_SAMPLES,
        parameters: IA_SOLAR_QUICK_PARAMETERS,
      });
      expect(parsed.success, item.name).toBe(true);
    }
  });

  it("only accepts one selected model and a known provider", () => {
    const valid = {
      modelName: "gemma4-e2b-qat",
      provider: "llamacpp",
      providerUrl: "http://127.0.0.1:8080",
    };
    expect(IA_SOLAR_QUICK_REQUEST_SCHEMA.safeParse(valid).success).toBe(true);
    expect(IA_SOLAR_QUICK_REQUEST_SCHEMA.safeParse({ ...valid, modelName: "" }).success).toBe(false);
    expect(IA_SOLAR_QUICK_REQUEST_SCHEMA.safeParse({ ...valid, provider: "unknown" }).success).toBe(false);
    expect(IA_SOLAR_QUICK_REQUEST_SCHEMA.safeParse({ ...valid, models: ["other"] }).success).toBe(false);
    expect(IA_SOLAR_QUICK_REQUEST_SCHEMA.safeParse({ ...valid, providerUrl: "not-a-url" }).success).toBe(false);
  });

  it("recognizes quick runs in Monitor without changing persisted run schema", () => {
    const candidate = IA_SOLAR_QUICK_CASES[0];
    expect(quickProfileCaseName(candidate)).toBe(candidate.name);
    expect(quickProfileCaseName({ systemPrompt: "otro", userMessages: ["texto"] })).toBe(null);
  });

  it("uses bounded default work for the live broadcast", () => {
    expect(IA_SOLAR_QUICK_PARAMETERS.temperature).toBe(0);
    expect(IA_SOLAR_QUICK_PARAMETERS.numCtx).toBe(8192);
    expect(IA_SOLAR_QUICK_PARAMETERS.numPredict).toBe(512);
    expect(IA_SOLAR_QUICK_PARAMETERS.reasoningEffort).toBe("off");
  });
});
