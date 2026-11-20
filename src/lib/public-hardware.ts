import { publicLabel } from './public-snapshot-builder';
import type { PublicSnapshot } from './public-snapshot';

// The same approved component labels used by the original public landing.
export function publicHardwareRig(env: Readonly<Record<string, string | undefined>> = process.env): PublicSnapshot['hardware_rig'] {
 const component=(value:string|undefined,fallback:string)=>publicLabel(value?.trim(),fallback);
 return {
  cpu:component(env.SNAPSHOT_CPU,'AMD Ryzen 9 7945HX'),
  ram:component(env.SNAPSHOT_RAM,'96GB DDR5 RAM'),
  gpu:component(env.SNAPSHOT_GPU,'NVIDIA Quadro RTX 4000 8GB VRAM'),
  provider:component(env.SNAPSHOT_PROVIDER,'Local model inference'),
 };
}
