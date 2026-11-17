import { z } from 'zod';
import { validateProviderEndpoint } from './endpoints';

const sampleSchema = z.object({
  source: z.string(), scope: z.enum(['host', 'gpu', 'process']),
  ramBytes: z.number().nonnegative().nullable(), vramBytes: z.number().nonnegative().nullable(),
  watts: z.number().nonnegative().nullable(),
  gpuTemperatureC: z.number().min(-100).max(200).nullable().optional(),
  gpuTemperatureLimitC: z.number().min(-100).max(200).nullable().optional(),
  thermalThrottlingActive: z.boolean().nullable().optional(),
  thermalHwSeconds: z.number().nonnegative().nullable().optional(),
  thermalSwSeconds: z.number().nonnegative().nullable().optional(),
  sourceIntervalSeconds: z.number().positive().nullable().optional(),
  gpuUpdatedAt: z.string().nullable().optional(),
  processUpdatedAt: z.string().nullable().optional(),
  sampledAt: z.string().nullable().optional(),
});
export type ResourceSample = z.infer<typeof sampleSchema> & {
  timeMs: number;
  receivedAt?: string;
  gpuSampleTimeMs?: number | null;
  ramSampleTimeMs?: number | null;
};
export type ResourceMeasurement = {
  attempts?: import("./inference-attempts").InferenceAttempt[];
  inferenceDurationMs?: number;
  manifest?: import("./run-identity").RunManifest;
  gpuTemperaturePeakC: number | null; gpuTemperatureMeanC: number | null; gpuTemperatureLimitC: number | null;
  thermalThrottlingDetected: boolean | null; thermalHwSeconds: number | null; thermalSwSeconds: number | null; thermalCounterReset: boolean;
  sourceIntervalSeconds: number | null; source: string | null; scope: string | null; samples: number; errors: number;
  durationMs: number; ramPeakBytes: number | null; vramPeakBytes: number | null;
  wattsMean: number | null; wattsPeak: number | null; joules: number | null;
  powerCoveragePct: number; unavailableReason: string | null;
  measurementVersion?: 'source-time-v2';
  independentGpuSamples?: number;
  independentRamSamples?: number;
  rawSamples?: ResourceSample[];
  rawSamplesTruncated?: boolean;
};

/** One observation per publisher timestamp, bounded to the inference window. */
function independentSamples(samples: ResourceSample[], durationMs: number, field: 'gpuSampleTimeMs' | 'ramSampleTimeMs') {
  const unique = new Map<string, ResourceSample>();
  for (const sample of samples) {
    const time = sample[field] === undefined ? sample.timeMs : sample[field];
    if (time === null || time < 0 || time > durationMs) continue;
    unique.set(`${sample.source}:${sample.scope}:${time}`, { ...sample, timeMs: time });
  }
  return [...unique.values()].sort((a, b) => a.timeMs - b.timeMs);
}
export function summarizeResources(samples: ResourceSample[], durationMs: number, errors = 0): ResourceMeasurement {
  const gpu = independentSamples(samples, durationMs, 'gpuSampleTimeMs');
  const ram = independentSamples(samples, durationMs, 'ramSampleTimeMs');
  const peak = (values: Array<number | null | undefined>) => {
    const known = values.filter((n): n is number => n != null);
    return known.length ? Math.max(...known) : null;
  };
  let joules = 0, coveredMs = 0;
  for (let i = 1; i < gpu.length; i++) {
    const a = gpu[i - 1], b = gpu[i];
    const dt = b.timeMs - a.timeMs;
    const maxGap = Math.min(25000, Math.max(5000, (b.sourceIntervalSeconds ?? 0) * 2000));
    if (a.watts !== null && b.watts !== null && dt > 0 && dt <= maxGap && a.source === b.source && a.scope === b.scope) {
      coveredMs += dt;
      joules += (a.watts + b.watts) / 2 * dt / 1000;
    }
  }
  const coverage = durationMs > 0 ? Math.min(100, coveredMs / durationMs * 100) : 0;
  const temperatures = gpu.flatMap(s => s.gpuTemperatureC == null ? [] : [s.gpuTemperatureC]);
  function counterDelta(key: 'thermalHwSeconds' | 'thermalSwSeconds') {
    const values = gpu.flatMap(s => s[key] == null ? [] : [s[key]!]);
    const reset = values.some((v, i) => i > 0 && v < values[i - 1]);
    return { delta: values.length >= 2 && !reset ? values[values.length - 1] - values[0] : null, reset };
  }
  const hw = counterDelta('thermalHwSeconds'), sw = counterDelta('thermalSwSeconds');
  const thermalSignals = gpu.flatMap(s => s.thermalThrottlingActive == null ? [] : [s.thermalThrottlingActive]);
  const detected = thermalSignals.includes(true) || (hw.delta ?? 0) > 0 || (sw.delta ?? 0) > 0;
  const thermal = detected ? true : !hw.reset && !sw.reset && coverage >= 90 && thermalSignals.length >= 2 && thermalSignals.length === gpu.length ? false : null;
  const raw = [...new Set([...gpu, ...ram])];
  return {
    measurementVersion: 'source-time-v2',
    gpuTemperaturePeakC: peak(temperatures),
    gpuTemperatureMeanC: temperatures.length ? temperatures.reduce((a, b) => a + b, 0) / temperatures.length : null,
    gpuTemperatureLimitC: gpu.find(s => s.gpuTemperatureLimitC != null)?.gpuTemperatureLimitC ?? null,
    thermalThrottlingDetected: thermal, thermalHwSeconds: hw.delta, thermalSwSeconds: sw.delta, thermalCounterReset: hw.reset || sw.reset,
    sourceIntervalSeconds: samples.find(s => s.sourceIntervalSeconds)?.sourceIntervalSeconds ?? null,
    source: samples[0]?.source ?? null, scope: samples[0]?.scope ?? null, samples: samples.length, errors, durationMs,
    ramPeakBytes: peak(ram.map(s => s.ramBytes)), vramPeakBytes: peak(gpu.map(s => s.vramBytes)), wattsPeak: peak(gpu.map(s => s.watts)),
    wattsMean: coveredMs > 0 ? joules / (coveredMs / 1000) : null, joules: coverage >= 90 ? joules : null,
    powerCoveragePct: coverage,
    independentGpuSamples: gpu.length, independentRamSamples: ram.length,
    rawSamples: raw.slice(0, 10000), rawSamplesTruncated: raw.length > 10000,
    unavailableReason: gpu.length || ram.length ? null : 'Sin muestras nuevas del sensor dentro de la ventana de inferencia.',
  };
}
export async function startResourceMeasurement(endpoint: string) {
  const started = performance.now(), wallStarted = Date.now();
  let stopped = false, errors = 0;
  const samples: ResourceSample[] = [];
  let config: { url: string; token?: string } | undefined;
  try { config = JSON.parse(process.env.BENCHMARK_RESOURCE_TARGETS || '{}')[new URL(endpoint).origin]; } catch { /* unavailable */ }
  let unavailableReason = config ? null : 'No hay colector configurado para este servidor de inferencia.';
  try {
    if (config && (!['http:', 'https:'].includes(new URL(config.url).protocol) || validateProviderEndpoint(config.url, 'telemetry'))) throw Error('endpoint');
  } catch { unavailableReason = 'Endpoint de telemetría no permitido.'; config = undefined; }
  const poll = async () => {
    if (!config) return;
    try {
      const response = await fetch(config.url, { signal: AbortSignal.timeout(1500), redirect: 'error', headers: config.token ? { authorization: `Bearer ${config.token}` } : {} });
      if (!response.ok) throw Error('collector');
      const sample = sampleSchema.parse(await response.json());
      const now = Date.now();
      const sourceTime = (stamp: string | null | undefined) => {
        const time = stamp ? Date.parse(stamp) : NaN;
        return Number.isFinite(time) && time <= now && now - time <= 25000 ? time - wallStarted : null;
      };
      samples.push({ ...sample, timeMs: performance.now() - started, receivedAt: new Date(now).toISOString(),
        gpuSampleTimeMs: sourceTime(sample.gpuUpdatedAt ?? sample.sampledAt),
        ramSampleTimeMs: sourceTime(sample.processUpdatedAt ?? sample.sampledAt) });
    } catch { errors++; }
  };
  // Do not delay inference waiting on the collector.
  let pending = poll(), polling = true;
  void pending.finally(() => { polling = false; });
  const timer = config ? setInterval(() => {
    if (!stopped && !polling) { polling = true; pending = poll().finally(() => { polling = false; }); }
  }, 1000) : undefined;
  return async () => {
    const durationMs = performance.now() - started;
    stopped = true;
    if (timer) clearInterval(timer);
    await pending;
    const result = summarizeResources(samples, durationMs, errors);
    if (unavailableReason) result.unavailableReason = unavailableReason;
    return result;
  };
}

/** Reports use summaries; raw sensor series stay in the result store. */
export function resourceSummary(measurement: ResourceMeasurement): ResourceMeasurement {
  return Object.fromEntries(Object.entries(measurement).filter(([key]) => key !== 'rawSamples')) as ResourceMeasurement;
}
