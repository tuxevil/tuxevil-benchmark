import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import Redis from "ioredis";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const serviceSuite = describe.skipIf(!databaseUrl || !redisUrl);

let sql: ReturnType<typeof postgres> | undefined;
let redis: Redis | undefined;

serviceSuite("local infrastructure", () => {
  it("connects to PostgreSQL and Redis after migrations", async () => {
    sql = postgres(databaseUrl!);
    redis = new Redis(redisUrl!);

    expect((await sql`SELECT 1 AS value`)[0].value).toBe(1);
    expect(await redis.ping()).toBe("PONG");

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('app_settings', 'evaluators', 'scenarios', 'test_runs', 'model_results', 'model_result_turns', 'evaluations', 'evaluation_history', 'execution_targets', 'model_artifacts', 'execution_environments', 'experiments', 'experiment_variants', 'experiment_executions', 'experiment_execution_runs', 'experiment_observations')
    `;
    expect(tables).toHaveLength(16);
  }, 30_000);
});

afterAll(async () => {
  await redis?.quit();
  await sql?.end();
});
