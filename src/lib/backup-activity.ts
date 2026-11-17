import { activeExecutionCount } from './execution-activity';
import { LEGACY_QUEUE_NAME } from './legacy-identifiers';
/** Terminal DB status alone does not prove a cancelling worker has finished flushing. */
export async function requireQuiescentWorkers() {
  if(activeExecutionCount()) throw new Error('Espera a que el worker termine de guardar los resultados antes de respaldar, restaurar o limpiar.');
  if(!process.env.REDIS_URL) return;
  const [{Queue},{default:Redis}] = await Promise.all([import('bullmq'),import('ioredis')]);
  const connection=new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:1,connectTimeout:2000,retryStrategy:()=>null});
  const queue=new Queue(LEGACY_QUEUE_NAME,{connection});
  try {
    const counts=await queue.getJobCounts('active','waiting','delayed','prioritized','waiting-children');
    if(Object.values(counts).some(count=>count>0)) throw new Error('Hay trabajos activos o pendientes en el worker. Termínalos antes de continuar.');
  } finally { await queue.close().catch(()=>undefined); connection.disconnect(); }
}
