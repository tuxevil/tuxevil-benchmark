import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbPath = join(tmpdir(), `tuxevil-targets-${process.pid}-${Date.now()}.sqlite`);
const originalSqlitePath = process.env.SQLITE_PATH;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalEncryptionKey = process.env.APP_ENCRYPTION_KEY;

let store: typeof import("@/lib/execution-target-store");
let sqlite: typeof import("@/lib/sqlite-db");
let experimentDb: typeof import("@/lib/experiment-db");

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.SQLITE_PATH = dbPath;
  process.env.APP_ENCRYPTION_KEY = "execution-target-test-key";
  store = await import("@/lib/execution-target-store");
  sqlite = await import("@/lib/sqlite-db");
  experimentDb = await import("@/lib/experiment-db");
});

afterAll(async () => {
  await experimentDb.closeExperimentDb();
  if (originalSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = originalSqlitePath;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalEncryptionKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = originalEncryptionKey;

  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${dbPath}${suffix}`;
    if (existsSync(path)) rmSync(path, { force: true });
  }
});

describe("execution target persistence", () => {
  it("encrypts credentials at rest and never returns them from public target reads", async () => {
    const target = await store.createExecutionTarget({
      label: "local llama",
      provider: "llamacpp",
      endpoint: "http://127.0.0.1:8080",
      apiKey: "super-secret-token",
    });

    expect(target.apiKeyConfigured).toBe(true);
    expect("apiKey" in target).toBe(false);

    const row = sqlite.getSqliteDb()
      .prepare("SELECT api_key_encrypted FROM execution_targets WHERE id = ?")
      .get(target.id) as { api_key_encrypted: string };
    expect(row.api_key_encrypted).not.toContain("super-secret-token");
    expect(row.api_key_encrypted).toMatch(/^v1:/);

    const connection = await store.getExecutionTargetConnection(target.id);
    expect(connection?.apiKey).toBe("super-secret-token");

    const listed = await store.listExecutionTargets();
    expect(listed.find((item) => item.id === target.id)?.apiKeyConfigured).toBe(true);
    expect("apiKey" in listed[0]).toBe(false);
  });

  it("supports credential clearing without changing scientific metadata", async () => {
    const target = await store.createExecutionTarget({
      label: "ollama",
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      apiKey: "secret",
    });

    const updated = await store.updateExecutionTarget(target.id, { clearApiKey: true });
    expect(updated?.apiKeyConfigured).toBe(false);
    expect((await store.getExecutionTargetConnection(target.id))?.apiKey).toBeNull();
  });
});
