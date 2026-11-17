import { describe, expect, it } from "vitest";
import { createRunSchema } from "@/lib/contracts";
import {
  IA_SOLAR_QUICK_CASES,
  quickProfileSummary,
} from "@/lib/ia-solar-quick-profile";
import {
  IA_SOLAR_CHATBOT_PLUS_VERSION,
  IA_SOLAR_CHATBOT_PLUS_CASES,
  IA_SOLAR_CHATBOT_PLUS_ADDITIONS,
  IA_SOLAR_CHATBOT_PLUS_PARAMETERS,
  chatbotPlusSummary,
  chatbotPlusCaseName,
} from "@/lib/ia-solar-chatbot-plus-profile";

describe("IA Solar µTuxbot Plus profile", () => {
  it("adds 9 challenging cases without changing the v1 quick profile", () => {
    const summary = chatbotPlusSummary();
    expect(summary.version).toBe(IA_SOLAR_CHATBOT_PLUS_VERSION);
    expect(summary.cases).toBe(20);
    expect(summary.turns).toBe(26);
    expect(summary.samplesPerCase).toBe(1);
    expect(summary.toolCallsTested).toBe(false);
    expect(quickProfileSummary()).toMatchObject({ cases: 11, turns: 13, version: "ia-solar-quick@1.0.0" });
    expect(IA_SOLAR_CHATBOT_PLUS_CASES.slice(0, 11)).toEqual(IA_SOLAR_QUICK_CASES);
    expect(IA_SOLAR_CHATBOT_PLUS_ADDITIONS).toHaveLength(9);
    expect(new Set(IA_SOLAR_CHATBOT_PLUS_CASES.map((test) => test.key)).size).toBe(20);
  });

  it("validates each case as a regular text-only benchmark", () => {
    for (const item of IA_SOLAR_CHATBOT_PLUS_CASES) {
      const parsed = createRunSchema.safeParse({
        provider: "llamacpp",
        providerUrl: "http://127.0.0.1:8080",
        scenarioId: null,
        category: item.category,
        attackType: item.attackType,
        systemPrompt: item.systemPrompt,
        userMessages: [...item.userMessages],
        models: ["gemma4"],
        samplesPerModel: 1,
        parameters: IA_SOLAR_CHATBOT_PLUS_PARAMETERS,
      });
      expect(parsed.success, item.name).toBe(true);
    }
  });

  it("can identify new cases in Monitor without renaming v1 results", () => {
    expect(chatbotPlusCaseName(IA_SOLAR_CHATBOT_PLUS_ADDITIONS[0])).toBe(IA_SOLAR_CHATBOT_PLUS_ADDITIONS[0].name);
    expect(chatbotPlusCaseName(IA_SOLAR_QUICK_CASES[0])).toBe(null);
  });

  it("sets a bounded output budget for more demanding chatbot prompts", () => {
    expect(IA_SOLAR_CHATBOT_PLUS_PARAMETERS.numCtx).toBe(8192);
    expect(IA_SOLAR_CHATBOT_PLUS_PARAMETERS.numPredict).toBe(768);
    expect(IA_SOLAR_CHATBOT_PLUS_PARAMETERS.temperature).toBe(0);
    expect(IA_SOLAR_CHATBOT_PLUS_PARAMETERS.reasoningEffort).toBe("off");
  });
});
