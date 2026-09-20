import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

process.env.SQLITE_PATH = join(
  tmpdir(),
  `tuxevil-benchmark-experiment-schema-${process.pid}-${crypto.randomUUID()}.db`,
);

describe("experiment foundation SQLite schema", () => {
  it("creates experiment metadata tables and optional run/result links", async () => {
    const { getSqliteDb } = await import("@/lib/sqlite-db");
    const db = getSqliteDb();

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('model_artifacts', 'execution_environments', 'experiments', 'experiment_arms') ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual([
      "execution_environments",
      "experiment_arms",
      "experiments",
      "model_artifacts",
    ]);

    const runColumns = db.prepare("PRAGMA table_info(test_runs)").all() as Array<{ name: string }>;
    expect(runColumns.some((column) => column.name === "execution_environment_id")).toBe(true);

    const resultColumns = db.prepare("PRAGMA table_info(model_results)").all() as Array<{ name: string }>;
    expect(resultColumns.some((column) => column.name === "model_artifact_id")).toBe(true);
  });
});
