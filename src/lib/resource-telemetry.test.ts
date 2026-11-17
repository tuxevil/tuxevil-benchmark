import { expect, it } from 'vitest';
import { summarizeResources, type ResourceSample } from './resource-telemetry';
const sample=(timeMs:number,watts:number|null):ResourceSample=>({timeMs,watts,source:'GPU',scope:'gpu',ramBytes:100,vramBytes:200});
it('integrates watts over time and reports peaks',()=>{const r=summarizeResources([sample(0,10),sample(1000,20),sample(2000,10)],2000);expect(r.joules).toBe(30);expect(r.wattsMean).toBe(15);expect(r.ramPeakBytes).toBe(100);});
it('does not invent energy when samples are missing or gaps are too long',()=>{expect(summarizeResources([sample(0,10),sample(10000,20)],10000).joules).toBeNull();expect(summarizeResources([sample(0,null),sample(1000,null)],1000).wattsMean).toBeNull();expect(summarizeResources([],1000).ramPeakBytes).toBeNull();});
it('does not infer thermal throttling from high temperature alone',()=>{
 const r=summarizeResources([{...sample(0,10),gpuTemperatureC:90},{...sample(1000,10),gpuTemperatureC:95}],1000);
 expect(r.gpuTemperaturePeakC).toBe(95);expect(r.gpuTemperatureMeanC).toBe(92.5);expect(r.thermalThrottlingDetected).toBeNull();
});
it('captures reported thermal events and counter increases even after the flag clears',()=>{
 const r=summarizeResources([{...sample(0,10),thermalThrottlingActive:false,thermalHwSeconds:8},{...sample(1000,10),thermalThrottlingActive:false,thermalHwSeconds:8.5}],1000);
 expect(r.thermalThrottlingDetected).toBe(true);expect(r.thermalHwSeconds).toBe(.5);
});
it('handles counter reset without negative duration',()=>{
 const r=summarizeResources([{...sample(0,10),thermalHwSeconds:8},{...sample(1000,10),thermalHwSeconds:0}],1000);
 expect(r.thermalCounterReset).toBe(true);expect(r.thermalHwSeconds).toBeNull();
});
it('reports no event only with explicit negative signals',()=>{
 expect(summarizeResources([{...sample(0,10),thermalThrottlingActive:false},{...sample(1000,10),thermalThrottlingActive:false}],1000).thermalThrottlingDetected).toBe(false);
 expect(summarizeResources([{...sample(0,10),thermalThrottlingActive:true}],1000).thermalThrottlingDetected).toBe(true);
});
