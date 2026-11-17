import { z } from 'zod';
import { validateProviderEndpoint } from './endpoints';
const sampleSchema = z.object({
  source: z.string(), scope: z.enum(['host','gpu','process']),
  ramBytes: z.number().nonnegative().nullable(), vramBytes: z.number().nonnegative().nullable(),
  watts: z.number().nonnegative().nullable(),
  gpuTemperatureC: z.number().min(-100).max(200).nullable().optional(),
  gpuTemperatureLimitC: z.number().min(-100).max(200).nullable().optional(),
  thermalThrottlingActive: z.boolean().nullable().optional(),
  thermalHwSeconds: z.number().nonnegative().nullable().optional(),
  thermalSwSeconds: z.number().nonnegative().nullable().optional(),
  sourceIntervalSeconds: z.number().positive().nullable().optional(),
});
export type ResourceSample = z.infer<typeof sampleSchema> & { timeMs: number };
export type ResourceMeasurement = {
  gpuTemperaturePeakC: number | null; gpuTemperatureMeanC: number | null; gpuTemperatureLimitC: number | null;
  thermalThrottlingDetected: boolean | null; thermalHwSeconds: number | null; thermalSwSeconds: number | null; thermalCounterReset: boolean;
  sourceIntervalSeconds: number | null; source: string | null; scope: string | null; samples: number; errors: number;
  durationMs: number; ramPeakBytes: number | null; vramPeakBytes: number | null;
  wattsMean: number | null; wattsPeak: number | null; joules: number | null;
  powerCoveragePct: number; unavailableReason: string | null;
};
export function summarizeResources(samples: ResourceSample[], durationMs: number, errors = 0): ResourceMeasurement {
  const peak = (key: 'ramBytes'|'vramBytes'|'watts') => {const values=samples.flatMap(s=>s[key]===null?[]:[s[key]!]);return values.length?Math.max(...values):null;};
  let joules=0, coveredMs=0;
  for(let i=1;i<samples.length;i++) {const a=samples[i-1], b=samples[i];const dt=b.timeMs-a.timeMs;if(a.watts!==null&&b.watts!==null&&dt>0&&dt<=5000&&a.source===b.source&&a.scope===b.scope){coveredMs+=dt;joules+=(a.watts+b.watts)/2*dt/1000;}}
  const coverage=durationMs>0?Math.min(100,coveredMs/durationMs*100):0;
  const temperatures = samples.flatMap(s => s.gpuTemperatureC == null ? [] : [s.gpuTemperatureC]);
  function counterDelta(key: 'thermalHwSeconds' | 'thermalSwSeconds') {
    const values = samples.flatMap(s => s[key] == null ? [] : [s[key]!]);
    const reset = values.some((v,i) => i > 0 && v < values[i-1]);
    return { delta: values.length >= 2 && !reset ? values[values.length-1] - values[0] : null, reset };
  }
  const hw = counterDelta('thermalHwSeconds'), sw = counterDelta('thermalSwSeconds');
  const thermalSignals = samples.flatMap(s => s.thermalThrottlingActive == null ? [] : [s.thermalThrottlingActive]);
  const detected = thermalSignals.includes(true) || (hw.delta ?? 0) > 0 || (sw.delta ?? 0) > 0;
  const thermal = detected ? true : thermalSignals.length >= 2 && thermalSignals.length === samples.length ? false : null;
  return {gpuTemperaturePeakC: temperatures.length ? Math.max(...temperatures) : null,
    gpuTemperatureMeanC: temperatures.length ? temperatures.reduce((a,b) => a+b,0)/temperatures.length : null,
    gpuTemperatureLimitC: samples.find(s => s.gpuTemperatureLimitC != null)?.gpuTemperatureLimitC ?? null,
    thermalThrottlingDetected: thermal, thermalHwSeconds: hw.delta, thermalSwSeconds: sw.delta, thermalCounterReset: hw.reset || sw.reset,
    sourceIntervalSeconds:samples.find(s=>s.sourceIntervalSeconds)?.sourceIntervalSeconds ?? null,source:samples[0]?.source??null,scope:samples[0]?.scope??null,samples:samples.length,errors,durationMs,
    ramPeakBytes:peak('ramBytes'),vramPeakBytes:peak('vramBytes'),wattsPeak:peak('watts'),
    wattsMean:coveredMs>0?joules/(coveredMs/1000):null,joules:coverage>=90?joules:null,
    powerCoveragePct:coverage,unavailableReason:samples.length?null:'No se recibieron muestras del equipo de inferencia.'};
}
export async function startResourceMeasurement(endpoint: string) {
  const started=performance.now(); let stopped=false;let errors=0;const samples: ResourceSample[]=[];
  // Map inference origin to an explicitly configured collector. Never measure the web host by default.
  let config: {url:string;token?:string}|undefined;
  try {config=JSON.parse(process.env.BENCHMARK_RESOURCE_TARGETS || '{}')[new URL(endpoint).origin];} catch { /* reported as unavailable */ }
  let unavailableReason = config ? null : 'No hay colector configurado para este servidor de inferencia.';
  try { if(config && (!['http:', 'https:'].includes(new URL(config.url).protocol) || validateProviderEndpoint(config.url,'strata'))) throw Error('endpoint'); } catch { unavailableReason='Endpoint de telemetría no permitido.'; config=undefined; }
  const poll=async()=>{if(!config)return;try{const response=await fetch(config.url,{signal:AbortSignal.timeout(1500),redirect:'error',headers:config.token?{authorization:`Bearer ${config.token}`}:{}});if(!response.ok)throw Error('collector');samples.push({...sampleSchema.parse(await response.json()),timeMs:performance.now()-started});}catch{errors++;}};
  await poll();
  let pending=Promise.resolve(); let polling=false;
  const timer=config?setInterval(()=>{if(!stopped && !polling) { polling=true; pending=poll().finally(()=>{polling=false;}); }},1000):undefined;
  return async()=>{stopped=true;if(timer)clearInterval(timer);await pending;await poll();const result=summarizeResources(samples,performance.now()-started,errors);if(unavailableReason)result.unavailableReason=unavailableReason;return result;};
}
