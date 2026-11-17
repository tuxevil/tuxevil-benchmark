export type InferenceAttempt = {
  startedAt: string;
  durationMs: number;
  status: 'COMPLETED' | 'FAILED';
  errorType: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};
export async function recordInferenceAttempt<T extends {inputTokens: number | null; outputTokens: number | null}>(
  attempts: InferenceAttempt[], operation: () => Promise<T>, onStart?: () => void,
): Promise<T> {
  const startedAt = new Date().toISOString(), started = performance.now();
  onStart?.();
  try {
    const result = await operation();
    attempts.push({startedAt,durationMs:performance.now()-started,status:'COMPLETED',errorType:null,inputTokens:result.inputTokens,outputTokens:result.outputTokens});
    return result;
  } catch (error) {
    attempts.push({startedAt,durationMs:performance.now()-started,status:'FAILED',errorType:error instanceof Error ? error.name : 'UnknownError',inputTokens:null,outputTokens:null});
    throw error;
  }
}
