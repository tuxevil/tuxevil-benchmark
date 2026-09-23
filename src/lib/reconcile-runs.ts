import IORedis from "ioredis";
import { Queue } from "bullmq";
import { enqueueBenchmark } from "@/lib/benchmark-queue";
import { benchmarkStore } from "@/lib/benchmark-store";
import { loadPersistedState } from "@/lib/database";
import { redisConnection } from "@/lib/redis-connection";
import { LEGACY_QUEUE_NAME, LEGACY_RECOVERY_KEY_PREFIX } from "@/lib/legacy-identifiers";

const QUEUE_NAME = LEGACY_QUEUE_NAME;
const RECOVERY_KEY_PREFIX = LEGACY_RECOVERY_KEY_PREFIX;
const RECOVERY_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_RECOVERIES = 3;
const STALLED_ERROR_MESSAGE = "STALLED: worker interrupted after repeated recoveries";
const EVAL_STALLED_ERROR_MESSAGE = "STALLED: evaluation left RUNNING after run finished (reconciled)";

export type ReconcileResult = {
  reenqueued: string[];
  failed: string[];
  skipped: string[];
  evalsMarked: number;
};

export async function reconcileOrphanedRuns(options: { maxRecoveries?: number } = {}): Promise<ReconcileResult> {
  const maxRecoveries = options.maxRecoveries ?? MAX_RECOVERIES;
  const queue = new Queue(QUEUE_NAME, { connection: redisConnection() });
  const connection = redisConnection();
  const redis = new IORedis(connection.port, connection.host, connection);
  const result: ReconcileResult = { reenqueued: [], failed: [], skipped: [], evalsMarked: 0 };
  try {
    const persisted = await loadPersistedState();
    if (!persisted) return result;

    const candidates = persisted.runs.filter(({ run }) => run.status === "PENDING" || run.status === "RUNNING");
    for (const { run } of candidates) {
      if (run.paused) {
        result.skipped.push(run.id);
        continue;
      }
      const jobId = `benchmark-${run.id}`;
      const job = await queue.getJob(jobId);
      const jobState = job ? await job.getState() : null;
      if (jobState && jobState !== "failed") {
        result.skipped.push(run.id);
        continue;
      }

      const recoveryKey = `${RECOVERY_KEY_PREFIX}${run.id}`;
      const recoveries = Number((await redis.get(recoveryKey)) ?? 0);
      if (recoveries >= maxRecoveries) {
        await markStalled(run.id);
        result.failed.push(run.id);
        continue;
      }

      await enqueueBenchmark(run.id);
      await redis.incr(recoveryKey);
      if (recoveries === 0) await redis.expire(recoveryKey, RECOVERY_TTL_SECONDS);
      result.reenqueued.push(run.id);
    }

    result.evalsMarked = await reconcileOrphanedEvals(persisted);
    return result;
  } finally {
    await queue.close();
    redis.disconnect();
  }
}

export async function reconcileOrphanedEvals(persisted?: Awaited<ReturnType<typeof loadPersistedState>>): Promise<number> {
  const state = persisted ?? (await loadPersistedState());
  if (!state) return 0;
  let marked = 0;
  for (const { run } of state.runs) {
    if (!["COMPLETED", "CANCELLED", "FAILED"].includes(run.status)) continue;
    let stored = benchmarkStore.getStoredRun(run.id);
    if (!stored) {
      await benchmarkStore.refreshRun(run.id);
      stored = benchmarkStore.getStoredRun(run.id);
    }
    if (!stored) continue;
    let markedInRun = 0;
    for (const result of run.results) {
      if (result.evalStatus !== "RUNNING") continue;
      benchmarkStore.updateResult(run.id, result.id, {
        evalStatus: "FAILED",
        errorMessage: EVAL_STALLED_ERROR_MESSAGE,
      });
      markedInRun += 1;
    }
    if (markedInRun > 0) {
      await benchmarkStore.flush(run.id);
      try {
        const { reconcileExperimentExecutionsForTestRun } = await import("@/lib/experiment-runner");
        await reconcileExperimentExecutionsForTestRun(run.id);
      } catch (error) {
        console.error("[tuxevil-benchmark] experiment reconciliation after eval recovery failed", {
          runId: run.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      marked += markedInRun;
    }
  }
  return marked;
}

async function markStalled(runId: string) {
  let run = benchmarkStore.getStoredRun(runId);
  if (!run) {
    await benchmarkStore.refreshRun(runId);
    run = benchmarkStore.getStoredRun(runId);
  }
  if (!run || ["COMPLETED", "CANCELLED", "FAILED"].includes(run.status)) return;
  benchmarkStore.updateRun(runId, {
    status: "FAILED",
    finishedAt: new Date().toISOString(),
    errorMessage: STALLED_ERROR_MESSAGE,
  });
  await benchmarkStore.flush(runId);
  try {
    const { reconcileExperimentExecutionsForTestRun } = await import("@/lib/experiment-runner");
    await reconcileExperimentExecutionsForTestRun(runId);
  } catch (error) {
    console.error("[tuxevil-benchmark] experiment reconciliation after stalled run failed", {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
