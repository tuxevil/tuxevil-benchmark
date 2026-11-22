import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import {
  buildDeterministicLongContext,
  longContextCacheConfigSchema,
  runLongContextCacheSuite,
} from "./long-context-cache-suite";

describe("long-context-cache-suite", () => {
  it("builds deterministic unique needles per tier", () => {
    const t1 = buildDeterministicLongContext(1024, 0);
    const t2 = buildDeterministicLongContext(4096, 1);
    expect(t1.needlePrimary).not.toBe(t1.needleSecondary);
    expect(t1.needlePrimary).not.toBe(t2.needlePrimary);
    expect(t1.contextBlock).toContain(t1.needlePrimary);
    expect(t1.contextBlock).toContain(t1.needleSecondary);
    expect(t2.contextBlock.length).toBeGreaterThan(t1.contextBlock.length);
  });

  it("measures cold load, cold cache, warm cache hit ratio and skips tiers exceeding numCtx", async () => {
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const messages = body.messages as Array<{ role: string; content: string }>;
      const isWarm = messages.length >= 4;
      const joined = messages.map((m) => m.content).join("\n");
      const primary = joined.match(/CLAVE_PRIMARIA_AUDITORIA=([A-Z0-9-]+)/)?.[1] ?? "READY";
      const secondary = joined.match(/CLAVE_SECUNDARIA_SOLAR=([A-Z0-9-]+)/)?.[1] ?? "READY";
      const answer = isWarm ? secondary : primary;
      const payload = {
        choices: [{ delta: { content: answer }, finish_reason: "stop" }],
        timings: isWarm
          ? { cache_n: 900, prompt_n: 100, prompt_ms: 20, prompt_per_second: 5000, predicted_n: 8, predicted_ms: 80, predicted_per_second: 100 }
          : { cache_n: 0, prompt_n: 1000, prompt_ms: 200, prompt_per_second: 5000, predicted_n: 8, predicted_ms: 80, predicted_per_second: 100 },
      };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Missing port");
      const cfg = longContextCacheConfigSchema.parse({
        provider: "llamacpp",
        endpoint: `http://127.0.0.1:${addr.port}`,
        model: "fixture",
        tiers: [512, 8192],
        includeColdLoadProbe: true,
        parameters: { temperature: 0, numCtx: 2048, topP: 1, repeatPenalty: 1, numPredict: 64 },
      });
      const report = await runLongContextCacheSuite(cfg, new AbortController().signal);
      expect(report.coldLoadProbe?.passed).toBe(true);
      expect(report.tiers).toHaveLength(2);
      expect(report.tiers[0].skippedReason).toBeNull();
      expect(report.tiers[0].coldCache?.passed).toBe(true);
      expect(report.tiers[0].coldCache?.cacheHitRatio).toBe(0);
      expect(report.tiers[0].warmCache?.passed).toBe(true);
      expect(report.tiers[0].warmCacheHitRatio).toBe(0.9);
      expect(report.tiers[1].skippedReason).toContain("numCtx");
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
