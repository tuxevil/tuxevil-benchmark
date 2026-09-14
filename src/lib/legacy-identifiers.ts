/**
 * Stable identifiers created before the tuxevil Benchmark rebrand.
 *
 * They remain centralized so migrations do not silently orphan existing
 * queues, recovery counters, event subscribers, seeded scenarios, or data.
 */
export const LEGACY_QUEUE_NAME = "slmarena-benchmarks";
export const LEGACY_RECOVERY_KEY_PREFIX = "slmarena:recovery:";
export const LEGACY_RUN_EVENT_CHANNEL_PREFIX = "slmarena:run:";
export const LEGACY_SECURITY_SEED_NAMESPACE = "slmarena:security";
export const LEGACY_SQLITE_FILENAME = "compare.db";
export const CURRENT_SQLITE_FILENAME = "tuxevil-benchmark.db";
export const LEGACY_THEME_STORAGE_KEY = "slmarena-theme";

export const LEGACY_MCP_RESOURCE_URIS = {
  leaderboard: "slmarena://leaderboard",
  scenarios: "slmarena://scenarios",
} as const;
