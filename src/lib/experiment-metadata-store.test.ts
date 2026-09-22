import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbPath = join(tmpdir(), `tuxevil-experiment-metadata-${process.pid}-${Date.now()}.sqlite`);
const originalSqlitePath = process.env.SQLITE_PATH;
const originalDatabaseUrl = process.env.DATABASE_URL;

let store: typeof import("@/lib/experiment-metadata-store");

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.SQLITE_PATH = dbPath;
  store = await import("@/lib/experiment-metadata-store");
});

afterAll(async () => {
  await store.closeExperimentMetadataStore();
  if (originalSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = originalSqlitePath;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (existsSync(dbPath)) rmSync(dbPath, { force: true });
  if (existsSync(`${dbPath}-wal`)) rmSync(`${dbPath}-wal`, { force: true });
  if (existsSync(`${dbPath}-shm`)) rmSync(`${dbPath}-shm`, { force: true });
});

describe("experiment metadata SQLite persistence", () => {
  it("deduplicates model artifacts by fingerprint", async () => {
    const marker = crypto.randomUUID();
    const first = await store.upsertModelArtifact({
      displayName: `artifact-${marker}`,
      baseModel: `base-${marker}`,
      architecture: "test",
      quantization: "Q4_K_M",
      artifactSha256: "b".repeat(64),
      metadata: { revision: 1 },
    });
    const second = await store.upsertModelArtifact({
      displayName: `artifact-renamed-${marker}`,
      baseModel: `base-${marker}`,
      architecture: "test",
      quantization: "Q4_K_M",
      artifactSha256: "b".repeat(64),
      metadata: { revision: 2 },
    });

    expect(second.id).toBe(first.id);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.displayName).toContain("renamed");
    expect((await store.getModelArtifact(first.id))?.metadata).toEqual({ revision: 2 });
    expect((await store.listModelArtifacts()).some((item) => item.id === first.id)).toBe(true);
  });

  it("deduplicates environments and splits behavior changes", async () => {
    const marker = crypto.randomUUID();
    const base = {
      label: `env-${marker}`,
      runtime: "llama.cpp",
      runtimeCommit: marker.replaceAll("-", ""),
      gpuModels: ["Test GPU"],
      runtimeFlags: ["-fa on", "-ngl 99"],
      kvCacheK: "q8_0",
      kvCacheV: "q8_0",
      contextSize: 8192,
    };

    const first = await store.upsertExecutionEnvironment(base);
    const renamed = await store.upsertExecutionEnvironment({
      ...base,
      label: `renamed-${marker}`,
      runtimeFlags: ["-fa on", "-ngl 99"],
    });
    const changed = await store.upsertExecutionEnvironment({ ...base, kvCacheK: "q4_0" });

    expect(renamed.id).toBe(first.id);
    expect(changed.id).not.toBe(first.id);
    expect((await store.getExecutionEnvironment(first.id))?.label).toContain("renamed");
    expect((await store.listExecutionEnvironments()).some((item) => item.id === changed.id)).toBe(true);
  });
});
