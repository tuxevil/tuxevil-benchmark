import { afterEach,expect,it,vi } from 'vitest';
import { requireQuiescentWorkers } from './backup-activity';
import { beginExecutionActivity } from './execution-activity';
afterEach(()=>vi.unstubAllEnvs());
it('requires the worker to finish flushing even if the database run was cancelled',async()=>{
 vi.stubEnv('REDIS_URL','');const end=beginExecutionActivity();
 try{await expect(requireQuiescentWorkers()).rejects.toThrow('termine de guardar');}finally{end();}
 await expect(requireQuiescentWorkers()).resolves.toBeUndefined();
});
