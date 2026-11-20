import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { expect, it } from "vitest";
import { capacityConfigSchema, runCapacityBenchmark } from "@/lib/capacity-benchmark";

it("sends equally sized workloads in simultaneous waves and preserves cause and resource coverage", async () => {
  let inFlight = 0;
  let peak = 0;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body.options.num_predict === 8) {
      res.end(JSON.stringify({ message: { content: "Ready" }, done: true, done_reason: "stop" }));
      return;
    }
    inFlight++;
    peak = Math.max(peak, inFlight);
    await setTimeout(25);
    inFlight--;
    if (body.options.seed === 43) {
      res.writeHead(500).end();
    } else {
      const truncated = body.options.seed === 44;
      res.end(JSON.stringify({
        message: { content: body.options.seed === 45 ? "#### 19" : "#### 18" },
        done: true, done_reason: truncated ? "length" : "stop",
        prompt_eval_count: 10, eval_count: 4,
      }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port.");
    const config = capacityConfigSchema.parse({
      provider: "ollama", endpoint: `http://127.0.0.1:${address.port}`, model: "fixture", rounds: 2,
      parameters: { temperature: 0, numCtx: 2048, topP: 1, numPredict: 32, repeatPenalty: 1 },
    });
    const report = await runCapacityBenchmark(config, new AbortController().signal);
    expect(peak).toBe(4);
    expect(report.benchmark).toMatchObject({
      id: "gsm8k-tuxevil-lite", version: "1.0.0", grader: { type: "GSM8K", version: 1 },
    });
    expect(report.batches.map((batch) => batch.concurrency)).toEqual([1, 1, 1, 1, 2, 2, 4, 2, 2, 4, 1, 1, 1, 1]);
    expect(report.batches.every((batch) => batch.peakClientInFlight === batch.concurrency)).toBe(true);
    for (const level of report.summary) {
      expect(level).toMatchObject({
        samples: 8, gradedSamples: 4, accuracy: 0.5,
        outcomes: { PASS: 2, WRONG_ANSWER: 2, TRUNCATED: 2, PROVIDER_ERROR: 2 },
        outputTokensPerSecond: null, wattHours: null, wattHoursPerCorrect: null,
        latencyMs: { count: 8 }, firstVisibleTokenMs: { count: 6 },
      });
      const requests = report.batches.filter((batch) => batch.concurrency === level.concurrency)
        .flatMap((batch) => batch.results).map(({ requestIndex, seed, contentSha256 }) => ({ requestIndex, seed, contentSha256 }));
      expect(requests).toEqual(report.batches.filter((batch) => batch.concurrency === 1)
        .flatMap((batch) => batch.results).map(({ requestIndex, seed, contentSha256 }) => ({ requestIndex, seed, contentSha256 })));
    }
  } finally {
    server.close();
    await once(server, "close");
  }
});
