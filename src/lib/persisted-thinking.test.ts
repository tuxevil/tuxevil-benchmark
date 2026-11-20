import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

it("preserves explicit Thinking modes in SQLite and tolerates legacy settings", async () => {
  vi.stubEnv("SQLITE_PATH", ":memory:");
  vi.stubEnv("DATABASE_URL", undefined);
  const { loadPersistedSettings, persistSettings } = await import("./database");
  const { getSqliteDb } = await import("./sqlite-db");
  const settings = {
    ollamaUrl: "http://localhost:11434",
    evaluators: [],
    activeEvaluatorId: null,
    evaluatorApiKey: null,
    parameters: { temperature: 0, numCtx: 4096, topP: 0.9, repeatPenalty: 1.1, numPredict: 512, seed: 42 },
  };

  for (const reasoningEffort of ["on", "off", "default", "medium"] as const) {
    await persistSettings({ ...settings, parameters: { ...settings.parameters, reasoningEffort } });
    expect((await loadPersistedSettings())?.parameters).toEqual({ ...settings.parameters, reasoningEffort });
  }

  const db = getSqliteDb();
  for (const reasoningEffort of [undefined, "unknown"]) {
    db.prepare("UPDATE app_settings SET parameters_json = ? WHERE id = 1")
      .run(JSON.stringify({ ...settings.parameters, reasoningEffort }));
    expect((await loadPersistedSettings())?.parameters.reasoningEffort).toBeUndefined();
    expect((await loadPersistedSettings())?.parameters.seed).toBe(42);
  }
});
