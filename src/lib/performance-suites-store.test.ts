import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("performance-suites-store", () => {
  let tmpDir: string;
  let prevSqlitePath: string | undefined;
  let prevDatabaseUrl: string | undefined;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "txb-suites-"));
    prevSqlitePath = process.env.SQLITE_PATH;
    prevDatabaseUrl = process.env.DATABASE_URL;
    process.env.SQLITE_PATH = path.join(tmpDir, "suites.db");
    delete process.env.DATABASE_URL;
  });

  afterAll(() => {
    if (prevSqlitePath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = prevSqlitePath;
    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves and lists capacity, long-context-cache and context-compaction runs by type", async () => {
    const { savePerformanceSuiteRun, listPerformanceSuiteRuns } = await import("./performance-suites-store");
    await savePerformanceSuiteRun({
      id: crypto.randomUUID(),
      suiteType: "capacity",
      modelName: "unsloth/gemma-4-E2B-it-qat-GGUF",
      provider: "llamacpp",
      createdAt: "2026-11-22T15:00:00.000Z",
      report: { protocol: "capacity-waves-v1" },
    });
    await savePerformanceSuiteRun({
      id: crypto.randomUUID(),
      suiteType: "long-context-cache",
      modelName: "unsloth/gemma-4-E2B-it-qat-GGUF",
      provider: "llamacpp",
      createdAt: "2026-11-22T15:05:00.000Z",
      report: { suiteVersion: "long-context-cache@1.0.0" },
    });

    await savePerformanceSuiteRun({
      id: crypto.randomUUID(),
      suiteType: "warm-contexts",
      modelName: "unsloth/gemma-4-E2B-it-GGUF",
      provider: "llamacpp",
      createdAt: "2026-11-22T15:10:00.000Z",
      report: { suiteVersion: "warm-contexts-recall@1.0.0", kneeMeasuredAgents: 8 },
    });

    const cap = await listPerformanceSuiteRuns("capacity");
    const lc = await listPerformanceSuiteRuns("long-context-cache");
    const warm = await listPerformanceSuiteRuns("warm-contexts");
    const all = await listPerformanceSuiteRuns();
    expect(cap).toHaveLength(1);
    expect(lc).toHaveLength(1);
    expect(warm).toHaveLength(1);
    expect(all).toHaveLength(3);
    expect(all[0].suiteType).toBe("warm-contexts");
  });
});
