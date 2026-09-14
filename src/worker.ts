import { loadEnvConfig } from "@next/env";
import { Worker } from "bullmq";
import { executeBenchmark } from "./lib/benchmark-queue";
import { reconcileOrphanedRuns } from "./lib/reconcile-runs";
import { redisConnection } from "./lib/redis-connection";
import { LEGACY_QUEUE_NAME } from "./lib/legacy-identifiers";

loadEnvConfig(process.cwd());

if (!process.env.REDIS_URL || !process.env.DATABASE_URL || !process.env.APP_ENCRYPTION_KEY) {
  throw new Error("REDIS_URL, DATABASE_URL, and APP_ENCRYPTION_KEY are required to start the durable worker.");
}

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

async function reconcile() {
  try {
    const outcome = await reconcileOrphanedRuns();
    if (outcome.reenqueued.length > 0 || outcome.failed.length > 0) {
      console.log("[tuxevil-benchmark] reconciliation done", {
        reenqueued: outcome.reenqueued,
        failed: outcome.failed,
        skipped: outcome.skipped.length,
      });
    }
  } catch (error) {
    console.error("[tuxevil-benchmark] reconciliation failed", error);
  }
}

const worker = new Worker<{ runId: string }>(
  LEGACY_QUEUE_NAME,
  async (job) => executeBenchmark(job.data.runId),
  {
    connection: redisConnection(),
    concurrency: Math.max(1, Number(process.env.BENCHMARK_CONCURRENCY ?? 1)),
  },
);

worker.on("completed", (job) => console.log(`[tuxevil-benchmark] completed ${job.data.runId}`));
worker.on("failed", (job, error) => console.error(`[tuxevil-benchmark] failed ${job?.data.runId ?? "unknown"}`, error));
worker.on("error", (error) => console.error("[tuxevil-benchmark] worker error", error));

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

worker.waitUntilReady().then(() => {
  console.log("[tuxevil-benchmark] benchmark worker ready");
  void reconcile();
  setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
});
