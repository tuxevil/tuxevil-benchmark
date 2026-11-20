export function approvedPublicModels(models: readonly { modelName: string }[]): Set<string> {
  const configuration = (process.env.BENCHMARK_PUBLIC_MODELS ?? "").trim();
  if (configuration === "ALL") return new Set(models.map(model => model.modelName));
  return new Set(configuration.split(",").map(name => name.trim()).filter(Boolean));
}
