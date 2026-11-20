import { expect, it, vi } from 'vitest';
import { recordInferenceAttempt, type InferenceAttempt } from './inference-attempts';
it('retains failed attempts and never fabricates their token consumption',async()=>{
 const attempts: InferenceAttempt[]=[]; const clock=vi.spyOn(performance,'now').mockReturnValueOnce(0).mockReturnValueOnce(100).mockReturnValueOnce(100).mockReturnValueOnce(150);
 await expect(recordInferenceAttempt(attempts,async()=>{throw new TypeError('private endpoint must not be recorded');})).rejects.toThrow();
 await recordInferenceAttempt(attempts,async()=>({inputTokens:2,outputTokens:3}));
 expect(attempts.map(a=>a.durationMs)).toEqual([100,50]);expect(attempts[0].inputTokens).toBeNull();expect(attempts[0].errorType).toBe('TypeError');expect(JSON.stringify(attempts)).not.toContain('private endpoint');clock.mockRestore();
});
