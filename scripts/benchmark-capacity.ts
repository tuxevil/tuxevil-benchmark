import { readFile } from "node:fs/promises";
import { capacityConfigSchema, runCapacityBenchmark } from "@/lib/capacity-benchmark";
import { sanitizeDiagnosticText } from "@/lib/diagnostic-safety";
import { probeProviderSnapshot } from "@/lib/providers/provider-probe";

async function main() {
  const configPath = process.argv[2];
  if (!configPath || process.argv.length !== 3) throw new Error("Usage: npm run --silent benchmark:capacity -- CONFIG.json");
  const config = capacityConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const apiKey = process.env.BENCHMARK_CAPACITY_API_KEY;
    const snapshot = await probeProviderSnapshot({
      provider: config.provider, endpoint: config.endpoint, model: config.model, label: "Capacity run", apiKey,
    });
    const { artifact, environment } = snapshot;
    if (!artifact.artifactSha256 && !config.artifactSha256) {
      throw new Error("This runtime did not report an artifact hash. Supply the GGUF SHA-256 as artifactSha256.");
    }
    const startedAt = new Date().toISOString();
    const report = await runCapacityBenchmark(config, controller.signal, apiKey);
    process.stdout.write(JSON.stringify({
      ...report,
      startedAt, completedAt: new Date().toISOString(),
      configuration: {
        provider: config.provider, model: config.model, rounds: config.rounds,
        timeoutMs: config.timeoutMs, parameters: config.parameters,
        artifact: {
          reportedSha256: artifact.artifactSha256 ?? null,
          suppliedFileSha256: config.artifactSha256 ?? null,
          quantization: artifact.quantization ?? null,
          artifactSizeBytes: artifact.artifactSizeBytes ?? null,
          totalParameters: artifact.totalParameters ?? null,
          activeParameters: artifact.activeParameters ?? null,
        },
        runtime: {
          version: environment.runtimeVersion ?? null, commit: environment.runtimeCommit ?? null,
          parallel: environment.parallel ?? null, contextSize: environment.contextSize ?? null,
          cpuModel: environment.cpuModel ?? null, gpuModels: environment.gpuModels ?? [],
          gpuOffload: environment.gpuOffload ?? null,
          totalVramBytes: environment.totalVramBytes ?? null,
        },
      },
    }, null, 2) + "\n");
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    if (controller.signal.aborted) process.exitCode = 130;
  }
}

main().catch((error: unknown) => {
  console.error(sanitizeDiagnosticText(error instanceof Error ? error.message : "Capacity run failed."));
  process.exitCode ??= 1;
});
