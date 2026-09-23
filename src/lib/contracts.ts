import { z } from "zod";
import { validateEvaluatorEndpoint } from "@/lib/endpoints";

export const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), "URL must use HTTP or HTTPS.");

export const testCategorySchema = z.enum(["GENERAL", "SECURITY"]);
export const securityAttackTypeSchema = z.enum([
  "INSTRUCTION_OVERRIDE",
  "SYSTEM_PROMPT_LEAKAGE",
  "INDIRECT_PROMPT_INJECTION",
  "DELIMITER_HIJACKING",
  "CONTEXT_OVERSTUFFING",
  "ENCODING_OBFUSCATION",
  "TOOL_PARAMETER_HIJACKING",
  "REFUSAL_SUPPRESSION",
  "SECOPS_IAM_AUTH",
  "SECOPS_WEB_WAF",
  "SECOPS_CONTAINER_ESCAPE",
  "SECOPS_NETWORK_C2",
  "SECOPS_EDR_LOLBAS",
  "PURPLE_FIREWALL_ROUTING",
  "PURPLE_CONTAINER_ESCAPE",
  "PURPLE_MCP_INJECTION",
]);

export type TestCategory = z.infer<typeof testCategorySchema>;
export type SecurityAttackType = z.infer<typeof securityAttackTypeSchema>;

export const reasoningEffortSchema = z.enum(["off", "default", "low", "medium", "high", "max"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const benchmarkParametersSchema = z.object({
  temperature: z.number().min(0).max(2),
  numCtx: z.number().int().min(128).max(131_072),
  topP: z.number().min(0).max(1),
  repeatPenalty: z.number().min(0).max(3),
  numPredict: z.number().int().min(1).max(32_768),
  reasoningEffort: reasoningEffortSchema.default("off").optional(),
});

export const evaluatorConfigSchema = z.object({
  baseUrl: httpUrlSchema.refine((value) => !validateEvaluatorEndpoint(value), "Evaluator endpoint must use HTTPS unless local."),
  apiKey: z.string().min(1).max(4_096),
  model: z.string().trim().min(1).max(255),
});

export const evaluatorUpsertSchema = z.object({
  label: z.string().trim().max(255).optional(),
  baseUrl: httpUrlSchema.refine((value) => !validateEvaluatorEndpoint(value), "Evaluator endpoint must use HTTPS unless local."),
  model: z.string().trim().min(1).max(255),
  apiKey: z.string().max(4_096).optional(),
  makeActive: z.boolean().optional(),
});

export type EvaluatorUpsertInput = z.infer<typeof evaluatorUpsertSchema>;

export const evaluatorUpdateSchema = evaluatorUpsertSchema
  .omit({ makeActive: true })
  .partial()
  .extend({ makeActive: z.boolean().optional() });

export type EvaluatorUpdateInput = z.infer<typeof evaluatorUpdateSchema>;

export type EvaluatorEntry = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
};

export const modelProviderSchema = z.enum(["ollama", "freetoken", "llamacpp"]);
export type ModelProvider = z.infer<typeof modelProviderSchema>;
export const MODEL_PROVIDERS = ["ollama", "freetoken", "llamacpp"] as const;

export const createRunSchema = z
  .object({
    provider: modelProviderSchema.default("ollama").optional(),
    providerUrl: httpUrlSchema.optional(),
    ollamaUrl: httpUrlSchema.optional(),
    executionTargetId: z.string().uuid().nullable().optional(),
    scenarioId: z.string().uuid().nullable().optional(),
    samplesPerModel: z.number().int().min(1).max(10).default(2),
    category: testCategorySchema.default("GENERAL"),
    attackType: securityAttackTypeSchema.nullable().optional(),
    systemPrompt: z.string().trim().min(1).max(50_000),
    userMessages: z.array(z.string().trim().min(1).max(50_000)).min(1).max(100),
    models: z
      .array(z.string().trim().min(1).max(255))
      .min(1)
      .max(50)
      .refine((models) => new Set(models).size === models.length, "Models must be unique."),
    parameters: benchmarkParametersSchema,
    evaluator: evaluatorConfigSchema.optional(),
  })
  .refine(
    (data) => Boolean(data.ollamaUrl || data.providerUrl),
    {
      message: "An endpoint URL is required.",
      path: ["providerUrl"],
    }
  )
  .transform((data) => {
    const provider = data.provider ?? "ollama";
    const resolvedUrl = data.providerUrl ?? data.ollamaUrl!;
    return {
      ...data,
      provider,
      ollamaUrl: resolvedUrl,
      providerUrl: resolvedUrl,
    };
  })
  .refine(
    (data) => data.category !== "SECURITY" || Boolean(data.attackType),
    {
      message: "An attack type must be specified for security tests.",
      path: ["attackType"],
    }
  );

export const humanReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "REVIEWED", "UNREVIEWED"]),
  notes: z.string().max(10_000).optional().default(""),
});

export const reevaluateSchema = z.object({
  evaluatorId: z.string().trim().min(1).max(255).nullish(),
});

export type ReevaluateInput = z.infer<typeof reevaluateSchema>;

export const settingsUpdateSchema = z.object({
  ollamaUrl: httpUrlSchema.optional(),
  freetokenUrl: httpUrlSchema.optional(),
  freetokenApiKey: z
    .string()
    .max(4_096)
    .nullish()
    .transform((value) => value ?? undefined),
  clearFreetokenApiKey: z.boolean().default(false),
  llamacppUrl: httpUrlSchema.optional(),
  llamacppApiKey: z
    .string()
    .max(4_096)
    .nullish()
    .transform((value) => value ?? undefined),
  clearLlamacppApiKey: z.boolean().default(false),
  activeProvider: modelProviderSchema.optional(),
  evaluatorBaseUrl: z
    .union([
      z.literal(""),
      httpUrlSchema.refine((value) => !validateEvaluatorEndpoint(value), "Evaluator endpoint must use HTTPS unless local."),
    ])
    .optional(),
  evaluatorModel: z.string().trim().max(255).optional(),
  evaluatorApiKey: z
    .string()
    .max(4_096)
    .nullish()
    .transform((value) => value ?? undefined),
  clearEvaluatorApiKey: z.boolean().default(false),
  activeEvaluatorId: z.string().max(255).nullable().optional(),
  parameters: benchmarkParametersSchema.optional(),
});

export type BenchmarkParameters = z.infer<typeof benchmarkParametersSchema>;
export type EvaluatorConfig = z.infer<typeof evaluatorConfigSchema>;
export type CreateRunInput = z.input<typeof createRunSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

export type RunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "CANCELLED" | "FAILED";
export type ModelStatus = "PENDING" | "INFERRING" | "EVALUATING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type EvaluationStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
export type HumanStatus = "APPROVED" | "REJECTED" | "REVIEWED" | "UNREVIEWED";

export type Telemetry = {
  ttftMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tokPerSec: number | null;
  totalDurationMs: number | null;
};

export type TurnResult = Telemetry & {
  id: string;
  stepOrder: number;
  userMessage: string;
  responseText: string;
  thinking: string | null;
  finishReason?: string | null;
  truncated?: boolean;
  /** Raw SSE wire capture and parsed counters. Only populated when debugWireCapture=true. */
  wireDiagnostics?: import("@/lib/providers/openai-client").WireDiagnostics | null;
  /** Protocol-level anomaly flags derived from the SSE stream. Always populated for OpenAI-compatible providers. */
  protocolDiagnostics?: import("@/lib/providers/openai-client").ProtocolDiagnostics | null;
  /** Exact request body sent to the provider (no API key). Populated for OpenAI-compatible providers. */
  requestBody?: Record<string, unknown> | null;
};

export type Evaluation = {
  evaluatorModel: string;
  grammarRating: number | null;
  complianceRating: number | null;
  accuracyRating: number | null;
  scoreStars: number | null;
  grammarAnalysis: string | null;
  complianceAnalysis: string | null;
  accuracyAnalysis: string | null;
  feedbackText: string;
  rawJson: unknown;
  securityScore: number | null;
  injectionSuccessful: boolean | null;
  systemLeakageDetected: boolean | null;
  visiblePromptLeak?: boolean | null;
  reasoningPromptLeak?: boolean | null;
  vulnerabilityAnalysis: string | null;
};

export type EvaluationHistoryEntry = Evaluation & {
  id: string;
  evaluatorId: string | null;
  createdAt: string;
};

export type ModelResult = Telemetry & {
  id: string;
  modelName: string;
  sampleIndex: number;
  status: ModelStatus;
  evalStatus: EvaluationStatus;
  responseText: string | null;
  turns: TurnResult[];
  evaluation: Evaluation | null;
  humanStatus: HumanStatus;
  humanNotes: string;
  errorMessage: string | null;
  finishReason?: string | null;
  truncated?: boolean;
};

export type TestRun = {
  id: string;
  category: TestCategory;
  attackType: SecurityAttackType | null;
  status: RunStatus;
  paused: boolean;
  controlVersion: number;
  scenarioId: string | null;
  samplesPerModel: number;
  systemPrompt: string;
  userMessages: string[];
  models: string[];
  parameters: BenchmarkParameters;
  evaluatorModel: string | null;
  results: ModelResult[];
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  provider?: ModelProvider;
  providerUrl?: string;
  executionTargetId?: string | null;
};

export type AppSettings = {
  ollamaUrl: string;
  freetokenUrl: string;
  freetokenApiKeyConfigured: boolean;
  llamacppUrl: string;
  llamacppApiKeyConfigured: boolean;
  activeProvider: ModelProvider;
  evaluatorBaseUrl: string;
  evaluatorModel: string;
  evaluatorApiKeyConfigured: boolean;
  evaluators: EvaluatorEntry[];
  activeEvaluatorId: string | null;
  parameters: BenchmarkParameters;
};

export type Scenario = {
  id: string;
  name: string;
  category: TestCategory;
  attackType: SecurityAttackType | null;
  systemPrompt: string;
  userMessages: string[];
  createdAt: string;
  updatedAt: string;
};

export const scenarioSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    category: testCategorySchema.default("GENERAL"),
    attackType: securityAttackTypeSchema.nullish().transform((v) => v ?? null),
    systemPrompt: z.string().trim().min(1).max(50_000),
    userMessages: z.array(z.string().trim().min(1).max(50_000)).min(1).max(100),
  })
  .refine(
    (data) => data.category !== "SECURITY" || Boolean(data.attackType),
    {
      message: "An attack type must be specified for security scenarios.",
      path: ["attackType"],
    }
  );

export type ScenarioInput = z.infer<typeof scenarioSchema>;

export type RunEvent = {
  id: number;
  type: string;
  run: TestRun;
  createdAt: string;
};

export type LeaderboardWeights = {
  quality: number; // default 40
  security: number; // default 40
  speed: number; // default 20
};

export type ScenarioDifficulty = "easy" | "medium" | "hard";

export type SecurityRadarMetrics = {
  instructionOverrideResistance: number;
  systemPromptLeakageResistance: number;
  indirectInjectionDefense: number;
  systemPromptAdherence: number;
};

export type LeaderboardModelRow = {
  modelName: string;
  provider?: ModelProvider;
  reasoningEffort?: ReasoningEffort;
  paramSizeLabel: string;
  paramSizeValue: number;
  totalRuns: number;
  failedEvals: number;
  avgTokPerSec: number | null;
  avgTtftMs: number | null;
  avgQualityStars: number | null;
  avgGrammar: number | null;
  avgCompliance: number | null;
  avgAccuracy: number | null;
  avgOutputTokens: number | null;
  avgDurationMs: number | null;
  attackSuccessRatePct: number | null;
  securityResilienceScore: number | null;
  /** Fraction (0..1) of the discriminating security signal the model covered. */
  securityScenarioCoverage: number | null;
  /** Fraction (0..1) of the discriminating quality signal the model covered. */
  qualityScenarioCoverage: number | null;
  /** False when the model ran too few scenarios to be fairly ranked. */
  rankingEligible: boolean;
  radar: SecurityRadarMetrics;
  arenaIndex: number;
};

export type GlobalKpis = {
  totalBenchmarkRuns: number;
  avgSystemSpeed: number | null;
  globalAvgQuality: number | null;
  globalAsrPercent: number | null;
};

export type LeaderboardData = {
  kpis: GlobalKpis;
  models: LeaderboardModelRow[];
  weights: LeaderboardWeights;
};

