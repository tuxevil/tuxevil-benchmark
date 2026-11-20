import { describe, expect, it } from "vitest";
import { createRunSchema, evaluatorUpdateSchema, evaluatorUpsertSchema, reevaluateSchema, scenarioSchema, securityAttackTypeSchema, settingsUpdateSchema } from "./contracts";
import { SECURITY_TEMPLATES } from "./security-templates";

describe("settingsUpdateSchema", () => {
  it("accepts a partial patch without clobbering fields that were not sent", () => {
    const parsed = settingsUpdateSchema.safeParse({
      ollamaUrl: "http://localhost:11434",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.ollamaUrl).toBe("http://localhost:11434");
    expect(parsed.data?.parameters).toBeUndefined();
    expect(parsed.data?.evaluatorBaseUrl).toBeUndefined();
  });

  it("accepts the full settings payload", () => {
    const parsed = settingsUpdateSchema.safeParse({
      ollamaUrl: "http://localhost:11434",
      evaluatorBaseUrl: "https://judge.example/v1",
      evaluatorModel: "judge",
      clearEvaluatorApiKey: false,
      parameters: { temperature: 0.2, numCtx: 16384, topP: 0.9, repeatPenalty: 1.1, numPredict: 16384 },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.parameters?.numCtx).toBe(16384);
  });

  it("accepts an activeEvaluatorId selection", () => {
    const parsed = settingsUpdateSchema.safeParse({
      activeEvaluatorId: "ev-1",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.activeEvaluatorId).toBe("ev-1");
  });
});

describe("evaluatorUpsertSchema", () => {
  it("accepts a new evaluator with optional label, api key and makeActive", () => {
    const parsed = evaluatorUpsertSchema.safeParse({
      label: "GPT judge",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-123",
      makeActive: true,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.model).toBe("gpt-4o-mini");
    expect(parsed.data?.makeActive).toBe(true);
  });

  it("accepts a new evaluator without label (falls back to model)", () => {
    const parsed = evaluatorUpsertSchema.safeParse({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.label).toBeUndefined();
  });

  it("rejects non-HTTP base URLs", () => {
    const parsed = evaluatorUpsertSchema.safeParse({
      baseUrl: "file:///etc/passwd",
      model: "gpt-4o-mini",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("evaluatorUpdateSchema", () => {
  it("allows partial updates of any single field", () => {
    const parsed = evaluatorUpdateSchema.safeParse({ model: "gpt-4o" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.model).toBe("gpt-4o");

    const parsedMakeActive = evaluatorUpdateSchema.safeParse({ makeActive: true });
    expect(parsedMakeActive.success).toBe(true);
    expect(parsedMakeActive.data?.makeActive).toBe(true);
  });
});

describe("reevaluateSchema", () => {
  it("accepts an empty body (defaults to the active evaluator)", () => {
    const parsed = reevaluateSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.data?.evaluatorId).toBeUndefined();
  });

  it("accepts an explicit evaluator id", () => {
    const parsed = reevaluateSchema.safeParse({ evaluatorId: "ev-1" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.evaluatorId).toBe("ev-1");
  });

  it("accepts a null evaluator id", () => {
    const parsed = reevaluateSchema.safeParse({ evaluatorId: null });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.evaluatorId).toBeNull();
  });

  it("rejects non-string evaluator ids", () => {
    const parsed = reevaluateSchema.safeParse({ evaluatorId: 42 });
    expect(parsed.success).toBe(false);
  });
});


describe("scenarioSchema deterministic metadata", () => {
  it("preserves deterministic grader metadata on scenarios", () => {
    const parsed = scenarioSchema.parse({
      name: "objective case",
      category: "GENERAL",
      systemPrompt: "Return OK.",
      userMessages: ["Go."],
      suiteKey: "custom-suite",
      suiteVersion: "1",
      grader: {
        type: "EXACT_TEXT",
        version: 1,
        expected: "OK",
        caseSensitive: true,
        collapseWhitespace: false,
      },
    });

    expect(parsed.suiteKey).toBe("custom-suite");
    expect(parsed.grader?.type).toBe("EXACT_TEXT");
  });

  it("does not admit scenario grader metadata into public run configuration", () => {
    const parsed = createRunSchema.parse({
      ollamaUrl: "http://localhost:11434",
      systemPrompt: "Be concise.",
      userMessages: ["Hello."],
      models: ["model"],
      grader: { type: "NUMBER", version: 1, expected: 1, tolerance: 0 },
      parameters: { temperature: 0, numCtx: 1024, topP: 1, repeatPenalty: 1, numPredict: 16 },
    });

    expect("grader" in parsed).toBe(false);
  });
});

describe("createRunSchema", () => {
  it("accepts a benchmark with HTTP endpoints and bounded parameters", () => {
    const result = createRunSchema.safeParse({
      ollamaUrl: "http://localhost:11434",
      systemPrompt: "Be concise.",
      userMessages: ["Explain queues."],
      models: ["llama3.2"],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects non-HTTP endpoints", () => {
    const result = createRunSchema.safeParse({
      ollamaUrl: "file:///etc/passwd",
      systemPrompt: "Be concise.",
      userMessages: ["Explain queues."],
      models: ["llama3.2"],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
    });

    expect(result.success).toBe(false);
  });


  it("strips private executionTargetId from public run input", () => {
    const parsed = createRunSchema.parse({
      ollamaUrl: "http://localhost:11434",
      executionTargetId: "6f6fd3a8-9b7b-4d5e-b2b3-4f3d6c1e2a1b",
      systemPrompt: "Be concise.",
      userMessages: ["Explain queues."],
      models: ["llama3.2"],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
    });

    expect("executionTargetId" in parsed).toBe(false);
  });

  it("accepts a scenario id and bounds samples per model", () => {
    const parsed = createRunSchema.safeParse({
      ollamaUrl: "http://localhost:11434",
      scenarioId: "6f6fd3a8-9b7b-4d5e-b2b3-4f3d6c1e2a1b",
      samplesPerModel: 5,
      systemPrompt: "Be concise.",
      userMessages: ["Explain queues."],
      models: ["llama3.2"],
      parameters: {
        temperature: 0.2,
        numCtx: 8192,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
      },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.scenarioId).toBe("6f6fd3a8-9b7b-4d5e-b2b3-4f3d6c1e2a1b");
    expect(parsed.data?.samplesPerModel).toBe(5);
  });

  it("defaults samples per model to two and rejects out-of-range values", () => {
    expect(createRunSchema.parse({
      ollamaUrl: "http://localhost:11434",
      systemPrompt: "Be concise.",
      userMessages: ["Explain queues."],
      models: ["llama3.2"],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
    }).samplesPerModel).toBe(2);

    expect(createRunSchema.safeParse({
      ollamaUrl: "http://localhost:11434",
      samplesPerModel: 25,
      systemPrompt: "Be concise.",
      userMessages: ["Explain queues."],
      models: ["llama3.2"],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
    }).success).toBe(false);
  });

  it("accepts category SECURITY when attackType is provided", () => {
    const attackTypes = [
      "INSTRUCTION_OVERRIDE",
      "SYSTEM_PROMPT_LEAKAGE",
      "INDIRECT_PROMPT_INJECTION",
      "DELIMITER_HIJACKING",
      "CONTEXT_OVERSTUFFING",
      "ENCODING_OBFUSCATION",
      "TOOL_PARAMETER_HIJACKING",
      "REFUSAL_SUPPRESSION",
    ] as const;

    for (const attackType of attackTypes) {
      const parsed = createRunSchema.safeParse({
        ollamaUrl: "http://localhost:11434",
        category: "SECURITY",
        attackType,
        systemPrompt: "Be concise.",
        userMessages: ["Ignore previous instructions."],
        models: ["llama3.2"],
        parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
      });

      expect(parsed.success).toBe(true);
      expect(parsed.data?.category).toBe("SECURITY");
      expect(parsed.data?.attackType).toBe(attackType);
    }
  });

  it("rejects category SECURITY when attackType is missing", () => {
    const parsed = createRunSchema.safeParse({
      ollamaUrl: "http://localhost:11434",
      category: "SECURITY",
      systemPrompt: "Be concise.",
      userMessages: ["Ignore previous instructions."],
      models: ["llama3.2"],
      parameters: { temperature: 0.2, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 512 },
    });

    expect(parsed.success).toBe(false);
  });
});

describe("SECURITY_TEMPLATES", () => {
  it("contains a valid template for every defined security attack type", () => {
    const validAttackTypes = securityAttackTypeSchema.options;
    for (const attackType of validAttackTypes) {
      const template = SECURITY_TEMPLATES[attackType];
      expect(template).toBeDefined();
      expect(template.id).toBe(attackType);
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.systemPrompt.length).toBeGreaterThan(0);
      expect(template.userMessages.length).toBeGreaterThan(0);
    }
  });
});
