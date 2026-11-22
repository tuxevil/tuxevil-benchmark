import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import {
  COMPACTION_FACTS,
  contextCompactionConfigSchema,
  gradeCompactionRetention,
  runContextCompactionSuite,
} from "./context-compaction-suite";

describe("context-compaction-suite", () => {
  it("grades deterministic fact retention accurately", () => {
    const full = gradeCompactionRetention(
      "LOTE-4821, sensor.servidor_potencia_local, 8 GB, NO_REINICIAR_INVERSOR, v3.2.9-stable",
    );
    expect(full.retainedFacts).toBe(COMPACTION_FACTS.length);
    expect(full.retentionScorePct).toBe(100);

    const partial = gradeCompactionRetention("LOTE-4821 y 8 GB únicamente");
    expect(partial.retainedFacts).toBe(2);
    expect(partial.retentionScorePct).toBe(40);
  });

  it("measures compaction overhead, cache invalidation and post-compaction retention", async () => {
    let callIndex = 0;
    const server = createServer(async (req, res) => {
      for await (const chunk of req) void chunk;
      callIndex++;
      const text =
        callIndex === 1
          ? "Resumen: LOTE-4821, sensor.servidor_potencia_local, 8 GB, NO_REINICIAR_INVERSOR, rollback v3.2.9-stable."
          : "lote=LOTE-4821\nsensor=sensor.servidor_potencia_local\nvram=8 GB\nprohibido=NO_REINICIAR_INVERSOR\nrollback=v3.2.9-stable";
      const payload = {
        choices: [{ delta: { content: text }, finish_reason: "stop" }],
        timings: { cache_n: 0, prompt_n: callIndex === 1 ? 1200 : 180, prompt_ms: 50, prompt_per_second: 2400, predicted_n: 40, predicted_ms: 200, predicted_per_second: 200 },
      };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Missing port");
      const cfg = contextCompactionConfigSchema.parse({
        provider: "llamacpp",
        endpoint: `http://127.0.0.1:${addr.port}`,
        model: "fixture",
        targetHistoryTokens: 1024,
        parameters: { temperature: 0, numCtx: 8192, topP: 1, repeatPenalty: 1, numPredict: 256 },
      });
      const report = await runContextCompactionSuite(cfg, new AbortController().signal);
      expect(report.compaction.summaryCharLength).toBeGreaterThan(20);
      expect(report.postCompaction.retainedFacts).toBe(5);
      expect(report.postCompaction.retentionScorePct).toBe(100);
      expect(report.cacheInvalidated).toBe(true);
      expect(report.compactionTimeSharePct).not.toBeNull();
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
