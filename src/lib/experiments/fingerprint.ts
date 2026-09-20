import { createHash } from "node:crypto";

export type EnvironmentFingerprintInput = {
  runtime?: string | null;
  runtimeVersion?: string | null;
  runtimeCommit?: string | null;
  backend?: string | null;
  operatingSystem?: string | null;
  cpu?: string | null;
  ramBytes?: number | null;
  gpu?: string | null;
  vramBytes?: number | null;
  driverVersion?: string | null;
  serverArgs?: string[];
  metadata?: Record<string, unknown>;
};

/**
 * Produces a stable fingerprint for the execution conditions that can alter
 * benchmark behaviour. Object keys are canonicalized recursively so callers
 * do not get different IDs merely because metadata insertion order changed.
 */
export function executionEnvironmentFingerprint(input: EnvironmentFingerprintInput): string {
  const canonical = stableStringify({
    runtime: input.runtime ?? null,
    runtimeVersion: input.runtimeVersion ?? null,
    runtimeCommit: input.runtimeCommit ?? null,
    backend: input.backend ?? null,
    operatingSystem: input.operatingSystem ?? null,
    cpu: input.cpu ?? null,
    ramBytes: input.ramBytes ?? null,
    gpu: input.gpu ?? null,
    vramBytes: input.vramBytes ?? null,
    driverVersion: input.driverVersion ?? null,
    serverArgs: input.serverArgs ?? [],
    metadata: input.metadata ?? {},
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}
