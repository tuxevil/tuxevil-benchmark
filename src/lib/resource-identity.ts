/** Conservative default: endpoints on one host share its inference resource. */
export function inferenceResourceKey(endpoint: string): string {
  const url = new URL(endpoint);
  let groups: Record<string,string> = {};
  try { groups = JSON.parse(process.env.BENCHMARK_RESOURCE_GROUPS || '{}'); } catch { /* conservative host grouping */ }
  return (typeof groups[url.origin] === "string" && groups[url.origin].trim() ? groups[url.origin] : null) || `host:${url.hostname.toLowerCase()}`;
}
export function assertNoPhysicalReservationConflict(executionId: string, requestedIds: string[], targets: {id:string;endpoint:string}[], leases: {target_id:string;execution_id:string}[]) {
  const resources = new Set(targets.filter(t=>requestedIds.includes(t.id)).map(t=>inferenceResourceKey(t.endpoint)));
  for (const lease of leases) {
    const target=targets.find(t=>t.id===lease.target_id);
    if(target && lease.execution_id!==executionId && resources.has(inferenceResourceKey(target.endpoint))) throw new Error('Inference resource is reserved by another experiment.');
  }
}
