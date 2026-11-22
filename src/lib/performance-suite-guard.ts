import { benchmarkStore } from "@/lib/benchmark-store";
import { hasDatabase, listPersistedHistory } from "@/lib/database";

let activePerformanceSuite: string | null = null;

export async function acquirePerformanceSuiteSlot(suiteName: string): Promise<string | null> {
  if (activePerformanceSuite) {
    return `Ya hay una suite de rendimiento en ejecución (${activePerformanceSuite}). Espera a que termine para evitar contención en la GPU.`;
  }
  if (hasDatabase()) {
    const recent = await listPersistedHistory({
      keyword: "",
      date: "",
      model: "",
      provider: "",
      timezoneOffset: 0,
      page: 1,
      pageSize: 20,
    });
    const busy = recent.runs.find((r) => r.status === "RUNNING" || r.status === "PENDING");
    if (busy) {
      return `Hay una prueba de Arena activa (${busy.id}, estado ${busy.status}). Espera o páusala antes de lanzar suites de rendimiento.`;
    }
  } else {
    await benchmarkStore.hydrate();
    const recent = benchmarkStore.listRuns({ keyword: "", date: "", model: "", timezoneOffset: 0, page: 1, pageSize: 20 });
    const busy = recent.runs.find((r) => r.status === "RUNNING" || r.status === "PENDING");
    if (busy) {
      return `Hay una prueba de Arena activa (${busy.id}, estado ${busy.status}).`;
    }
  }
  activePerformanceSuite = suiteName;
  return null;
}

export function releasePerformanceSuiteSlot() {
  activePerformanceSuite = null;
}

export async function resolveProviderApiKey(provider: "ollama" | "llamacpp"): Promise<string | undefined> {
  await benchmarkStore.hydrate();
  if (provider === "llamacpp") {
    return (await benchmarkStore.getLlamacppApiKey()) ?? undefined;
  }
  return undefined;
}
