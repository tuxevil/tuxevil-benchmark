import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import {
  buildAgentSessionFixture,
  detectWarmContextKnee,
  runWarmContextsSuite,
  warmContextsConfigSchema,
} from "./warm-contexts-suite";

describe("warm-contexts-suite (RECALL)", () => {
  it("builds unique deterministic per-agent dossiers and needles without cross-agent prefix collisions", () => {
    const a0 = buildAgentSessionFixture(4, 0, 1024, 3);
    const a1 = buildAgentSessionFixture(4, 1, 1024, 3);
    expect(a0.agentTag).not.toBe(a1.agentTag);
    expect(a0.systemPrompt).not.toBe(a1.systemPrompt);
    expect(a0.needles).toHaveLength(3);
    expect(a0.needles[0]).not.toBe(a1.needles[0]);
    expect(a0.turnPrompts[0]).toContain(a0.needles[0]);
    expect(a0.turnPrompts[0]).toContain(a0.needles[2]);
  });

  it("detects knee when warm cache hit ratio collapses or warm TTFT doubles", () => {
    const cacheCollapse = detectWarmContextKnee([
      { agents: 2, failedTurns: 0, warmCacheHitRatio: 0.92, warmTtftP50Ms: 120 },
      { agents: 4, failedTurns: 0, warmCacheHitRatio: 0.88, warmTtftP50Ms: 145 },
      { agents: 8, failedTurns: 0, warmCacheHitRatio: 0.22, warmTtftP50Ms: 640 },
    ]);
    expect(cacheCollapse.maxSustainedAgents).toBe(8);
    expect(cacheCollapse.kneeMeasuredAgents).toBe(8);
    expect(cacheCollapse.kneeReason).toContain("92%");

    const ttftJump = detectWarmContextKnee([
      { agents: 2, failedTurns: 0, warmCacheHitRatio: null, warmTtftP50Ms: 150 },
      { agents: 4, failedTurns: 0, warmCacheHitRatio: null, warmTtftP50Ms: 360 },
    ]);
    expect(ttftJump.kneeMeasuredAgents).toBe(4);
    expect(ttftJump.kneeReason).toContain("TTFT");
  });

  it("sweeps round-robin multi-turn fleets, detects cache eviction knee, and verifies factual recall", async () => {
    const seenAgents = new Set<string>();
    const server = createServer((req, res) => {
      if (req.url !== "/v1/chat/completions") {
        res.statusCode = 404;
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          messages: Array<{ role: string; content: string }>;
        };
        const sys = body.messages[0]?.content ?? "";
        const userTurns = body.messages.filter((m) => m.role === "user");
        const firstDoc = userTurns[0]?.content ?? "";
        const turnIdx = userTurns.length;
        const match = firstDoc.match(new RegExp(`CLAVE_TURNO_${turnIdx}=([A-Z0-9-]+)`));
        const answer = match ? match[1] : "UNKNOWN";

        // Detect level size from dossier header to simulate cache fitting at N=2 and evicting at N=4.
        const levelMatch = firstDoc.match(/NIVEL FLOTA=(\d+)/);
        const fleetN = levelMatch ? Number(levelMatch[1]) : 2;
        const isWarm = turnIdx > 1;
        seenAgents.add(sys);

        const promptTokens = 1200 + turnIdx * 60;
        const cachedTokens = !isWarm ? 0 : fleetN <= 2 ? 1150 : 120;
        const promptMs = !isWarm ? 80 : fleetN <= 2 ? 15 : 180;

        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: answer }, finish_reason: null }],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: 12,
              prompt_tokens_details: { cached_tokens: cachedTokens },
            },
            timings: {
              cache_n: cachedTokens,
              prompt_n: promptTokens - cachedTokens,
              prompt_ms: promptMs,
              predicted_n: 12,
              predicted_ms: 80,
            },
          })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected numeric port");

    try {
      const config = warmContextsConfigSchema.parse({
        provider: "llamacpp",
        endpoint: `http://127.0.0.1:${addr.port}`,
        model: "gemma-4-e2b-test",
        agentCounts: [2, 4],
        concurrencySlots: 2,
        turnsPerAgent: 3,
        contextTokens: 512,
        parameters: { temperature: 0, numCtx: 8192, topP: 0.9, repeatPenalty: 1.1, numPredict: 64 },
      });

      const report = await runWarmContextsSuite(config, new AbortController().signal);
      expect(report.levels).toHaveLength(2);
      expect(report.maxSustainedAgents).toBe(4);
      expect(report.kneeMeasuredAgents).toBe(4);
      expect(report.levels[0].passedChecks).toBe(6);
      expect(report.levels[1].passedChecks).toBe(12);
      expect(report.levels[0].warmCacheHitRatio).toBeGreaterThan(0.8);
      expect(report.levels[1].warmCacheHitRatio).toBeLessThan(0.2);
      expect(report.levels[0].tasksPerMinute).toBeGreaterThan(0);
      expect(seenAgents.size).toBe(6); // 2 distinct agents in level 1 + 4 distinct agents in level 2
    } finally {
      server.close();
    }
  });
});
