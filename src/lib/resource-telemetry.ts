import { z } from 'zod';
import { validateProviderEndpoint } from './endpoints';

const sampleSchema = z.object({
  source: z.string(), scope: z.enum(['host', 'gpu', 'process', 'wall']),
  ramBytes: z.number().nonnegative().nullable(), vramBytes: z.number().nonnegative().nullable(),
  watts: z.number().nonnegative().nullable(),
  wallWatts: z.number().nonnegative().nullable().optional(),
  wallUpdatedAt: z.string().nullable().optional(),
  wallSource: z.string().nullable().optional(),
  wallEntityId: z.string().nullable().optional(),
  wallIdleBaselineWatts: z.number().nonnegative().nullable().optional(),
  wallSourceIntervalSeconds: z.number().positive().nullable().optional(),
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
  wallSampleTimeMs?: number | null;
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
  gpuWattHours?: number | null;
  powerCoveragePct: number; unavailableReason: string | null;
  wallSource?: string | null;
  wallEntityId?: string | null;
  wallWattsMean?: number | null;
  wallWattsPeak?: number | null;
  wallJoules?: number | null;
  wallWattHours?: number | null;
  wallIdleBaselineWatts?: number | null;
  wallIncrementalJoules?: number | null;
  wallIncrementalWattHours?: number | null;
  wallPowerCoveragePct?: number;
  independentWallSamples?: number;
  measurementVersion?: 'source-time-v2';
  independentGpuSamples?: number;
  independentRamSamples?: number;
  rawSamples?: ResourceSample[];
  rawSamplesTruncated?: boolean;
};

/** One observation per publisher timestamp, bounded to the inference window. */
function independentSamples(samples: ResourceSample[], durationMs: number, field: 'gpuSampleTimeMs' | 'ramSampleTimeMs' | 'wallSampleTimeMs') {
  const unique = new Map<string, ResourceSample>();
  for (const sample of samples) {
    const time = sample[field] === undefined ? sample.timeMs : sample[field];
    if (time === null || time < 0 || time > durationMs) continue;
    const keySource = field === 'wallSampleTimeMs' ? (sample.wallSource ?? sample.wallEntityId ?? sample.source) : sample.source;
    const keyScope = field === 'wallSampleTimeMs' ? 'wall' : sample.scope;
    unique.set(`${keySource}:${keyScope}:${time}`, { ...sample, timeMs: time });
  }
  return [...unique.values()].sort((a, b) => a.timeMs - b.timeMs);
}
export function summarizeResources(samples: ResourceSample[], durationMs: number, errors = 0): ResourceMeasurement {
  const gpu = independentSamples(samples, durationMs, 'gpuSampleTimeMs');
  const ram = independentSamples(samples, durationMs, 'ramSampleTimeMs');
  const wall = independentSamples(
    samples.filter((s) => s.wallWatts !== undefined && s.wallWatts !== null || s.scope === 'wall'),
    durationMs,
    'wallSampleTimeMs',
  );
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

  // Independent wall/socket power integration (never summed or mixed with GPU readings)
  let wallJoulesAcc = 0, wallCoveredMs = 0;
  for (let i = 1; i < wall.length; i++) {
    const a = wall[i - 1], b = wall[i];
    const aWatts = a.wallWatts ?? (a.scope === 'wall' ? a.watts : null);
    const bWatts = b.wallWatts ?? (b.scope === 'wall' ? b.watts : null);
    const dt = b.timeMs - a.timeMs;
    const maxGap = Math.min(90000, Math.max(5000, (b.wallSourceIntervalSeconds ?? b.sourceIntervalSeconds ?? 0) * 2000));
    const aSource = a.wallSource ?? a.wallEntityId ?? a.source;
    const bSource = b.wallSource ?? b.wallEntityId ?? b.source;
    if (aWatts != null && bWatts != null && dt > 0 && dt <= maxGap && aSource === bSource) {
      wallCoveredMs += dt;
      wallJoulesAcc += (aWatts + bWatts) / 2 * dt / 1000;
    }
  }
  const wallCoverage = durationMs > 0 ? Math.min(100, wallCoveredMs / durationMs * 100) : 0;
  const wallWattsValues = wall.map((s) => s.wallWatts ?? (s.scope === 'wall' ? s.watts : null));
  const wallJoules = wallCoverage >= 90 ? wallJoulesAcc : null;
  const wallWattHours = wallJoules !== null ? Number((wallJoules / 3600).toFixed(6)) : null;
  const wallIdleBaselineWatts = wall.find((s) => s.wallIdleBaselineWatts != null)?.wallIdleBaselineWatts ?? null;
  const wallIncrementalJoules =
    wallJoules !== null && wallIdleBaselineWatts !== null
      ? Math.max(0, wallJoules - wallIdleBaselineWatts * (durationMs / 1000))
      : null;
  const wallIncrementalWattHours =
    wallIncrementalJoules !== null ? Number((wallIncrementalJoules / 3600).toFixed(6)) : null;
  const gpuJoules = coverage >= 90 ? joules : null;
  const gpuWattHours = gpuJoules !== null ? Number((gpuJoules / 3600).toFixed(6)) : null;

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
  const raw = [...new Set([...gpu, ...ram, ...wall])];
  return {
    measurementVersion: 'source-time-v2',
    gpuTemperaturePeakC: peak(temperatures),
    gpuTemperatureMeanC: temperatures.length ? temperatures.reduce((a, b) => a + b, 0) / temperatures.length : null,
    gpuTemperatureLimitC: gpu.find(s => s.gpuTemperatureLimitC != null)?.gpuTemperatureLimitC ?? null,
    thermalThrottlingDetected: thermal, thermalHwSeconds: hw.delta, thermalSwSeconds: sw.delta, thermalCounterReset: hw.reset || sw.reset,
    sourceIntervalSeconds: samples.find(s => s.sourceIntervalSeconds)?.sourceIntervalSeconds ?? null,
    source: samples[0]?.source ?? null, scope: samples[0]?.scope ?? null, samples: samples.length, errors, durationMs,
    ramPeakBytes: peak(ram.map(s => s.ramBytes)), vramPeakBytes: peak(gpu.map(s => s.vramBytes)), wattsPeak: peak(gpu.map(s => s.watts)),
    wattsMean: coveredMs > 0 ? joules / (coveredMs / 1000) : null, joules: gpuJoules,
    gpuWattHours,
    powerCoveragePct: coverage,
    wallSource: wall.find((s) => s.wallSource)?.wallSource ?? (wall[0]?.scope === 'wall' ? wall[0].source : null),
    wallEntityId: wall.find((s) => s.wallEntityId)?.wallEntityId ?? null,
    wallWattsMean: wallCoveredMs > 0 ? wallJoulesAcc / (wallCoveredMs / 1000) : null,
    wallWattsPeak: peak(wallWattsValues),
    wallJoules,
    wallWattHours,
    wallIdleBaselineWatts,
    wallIncrementalJoules,
    wallIncrementalWattHours,
    wallPowerCoveragePct: wallCoverage,
    independentGpuSamples: gpu.length, independentRamSamples: ram.length, independentWallSamples: wall.length,
    rawSamples: raw.slice(0, 10000), rawSamplesTruncated: raw.length > 10000,
    unavailableReason: gpu.length || ram.length || wall.length ? null : 'Sin muestras nuevas del sensor dentro de la ventana de inferencia.',
  };
}

export type BatchResourceSummary = {
  runs: number;
  totalDurationMs: number;
  ramPeakBytes: number | null;
  vramPeakBytes: number | null;
  gpuJoules: number | null;
  gpuWattHours: number | null;
  gpuMeasuredRuns: number;
  wallJoules: number | null;
  wallWattHours: number | null;
  wallIncrementalWattHours: number | null;
  wallMeasuredRuns: number;
};

/**
 * Aggregates resource measurements across a contiguous batch/suite of runs.
 * Prefers summing individually covered runs; when rawSamples exist across short runs,
 * re-integrates continuous wall-clock samples without extrapolating gaps.
 */
export function summarizeBatchResources(measurements: ResourceMeasurement[]): BatchResourceSummary {
  const totalDurationMs = measurements.reduce((sum, m) => sum + (Number.isFinite(m.durationMs) ? m.durationMs : 0), 0);
  const peaks = (values: Array<number | null | undefined>) => {
    const valid = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return valid.length ? Math.max(...valid) : null;
  };
  const gpuCovered = measurements.filter((m) => m.joules != null && Number.isFinite(m.joules));
  const wallCovered = measurements.filter((m) => m.wallJoules != null && Number.isFinite(m.wallJoules));
  const wallIncCovered = measurements.filter((m) => m.wallIncrementalJoules != null && Number.isFinite(m.wallIncrementalJoules));

  let gpuJoules: number | null =
    measurements.length > 0 && gpuCovered.length === measurements.length
      ? gpuCovered.reduce((sum, m) => sum + m.joules!, 0)
      : null;
  let wallJoules: number | null =
    measurements.length > 0 && wallCovered.length === measurements.length
      ? wallCovered.reduce((sum, m) => sum + m.wallJoules!, 0)
      : null;
  let wallIncrementalJoules: number | null =
    measurements.length > 0 && wallIncCovered.length === measurements.length
      ? wallIncCovered.reduce((sum, m) => sum + m.wallIncrementalJoules!, 0)
      : null;

  // Fallback for short back-to-back runs (<10s each) that share contiguous rawSamples
  if ((gpuJoules === null || wallJoules === null) && totalDurationMs > 0) {
    let offsetMs = 0;
    const stitched: ResourceSample[] = [];
    for (const m of measurements) {
      for (const s of m.rawSamples ?? []) {
        stitched.push({
          ...s,
          timeMs: offsetMs + s.timeMs,
          gpuSampleTimeMs: s.gpuSampleTimeMs != null ? offsetMs + s.gpuSampleTimeMs : s.gpuSampleTimeMs,
          ramSampleTimeMs: s.ramSampleTimeMs != null ? offsetMs + s.ramSampleTimeMs : s.ramSampleTimeMs,
          wallSampleTimeMs: s.wallSampleTimeMs != null ? offsetMs + s.wallSampleTimeMs : s.wallSampleTimeMs,
        });
      }
      offsetMs += m.durationMs;
    }
    if (stitched.length >= 2) {
      const merged = summarizeResources(stitched, totalDurationMs);
      if (gpuJoules === null && merged.joules != null) gpuJoules = merged.joules;
      if (wallJoules === null && merged.wallJoules != null) wallJoules = merged.wallJoules;
      if (wallIncrementalJoules === null && merged.wallIncrementalJoules != null) {
        wallIncrementalJoules = merged.wallIncrementalJoules;
      }
    }
  }

  return {
    runs: measurements.length,
    totalDurationMs,
    ramPeakBytes: peaks(measurements.map((m) => m.ramPeakBytes)),
    vramPeakBytes: peaks(measurements.map((m) => m.vramPeakBytes)),
    gpuJoules,
    gpuWattHours: gpuJoules !== null ? Number((gpuJoules / 3600).toFixed(6)) : null,
    gpuMeasuredRuns: gpuCovered.length,
    wallJoules,
    wallWattHours: wallJoules !== null ? Number((wallJoules / 3600).toFixed(6)) : null,
    wallIncrementalWattHours: wallIncrementalJoules !== null ? Number((wallIncrementalJoules / 3600).toFixed(6)) : null,
    wallMeasuredRuns: wallCovered.length,
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
  const configuredPollMs = Number(process.env.BENCHMARK_RESOURCE_POLL_MS ?? '1000');
  const pollMs = Number.isFinite(configuredPollMs) ? Math.min(5000, Math.max(250, Math.round(configuredPollMs))) : 1000;
  const wallMaxAgeMs = Math.min(180000, Math.max(5000, Number(process.env.RESOURCE_WALL_MAX_AGE_SECONDS ?? '90') * 1000));
  const poll = async () => {
    if (!config) return;
    try {
      const response = await fetch(config.url, { signal: AbortSignal.timeout(1500), redirect: 'error', headers: config.token ? { authorization: `Bearer ${config.token}` } : {} });
      if (!response.ok) throw Error('collector');
      const sample = sampleSchema.parse(await response.json());
      const now = Date.now();
      const sourceTime = (stamp: string | null | undefined, maxAgeMs = 25000) => {
        const time = stamp ? Date.parse(stamp) : NaN;
        return Number.isFinite(time) && time <= now && now - time <= maxAgeMs ? time - wallStarted : null;
      };
      samples.push({ ...sample, timeMs: performance.now() - started, receivedAt: new Date(now).toISOString(),
        gpuSampleTimeMs: sourceTime(sample.gpuUpdatedAt ?? sample.sampledAt),
        ramSampleTimeMs: sourceTime(sample.processUpdatedAt ?? sample.sampledAt),
        wallSampleTimeMs: sample.wallWatts != null || sample.scope === 'wall'
          ? sourceTime(sample.wallUpdatedAt ?? sample.sampledAt, wallMaxAgeMs)
          : null });
    } catch { errors++; }
  };
  // Do not delay inference waiting on the collector.
  let pending = poll(), polling = true;
  void pending.finally(() => { polling = false; });
  const timer = config ? setInterval(() => {
    if (!stopped && !polling) { polling = true; pending = poll().finally(() => { polling = false; }); }
  }, pollMs) : undefined;
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
