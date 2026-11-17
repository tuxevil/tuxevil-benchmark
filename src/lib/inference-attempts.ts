export type InferenceAttempt = {
  startedAt: string;
  durationMs: number;
  status: 'COMPLETED' | 'FAILED';
  errorType: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};
export async function recordInferenceAttempt<T extends {inputTokens: number | null; outputTokens: number | null}>(
  attempts: InferenceAttempt[],
  operation: () => Promise<T>,
  onStart?: () => void | Promise<void>,
  onAttempt?: (attempt: InferenceAttempt, error?: unknown) => void | Promise<void>,
): Promise<T> {
  const startedAt = new Date().toISOString(), started = performance.now();
  try { await onStart?.(); } catch { /* Diagnostic logging must not block inference. */ }
  try {
    const result = await operation();
    const attempt = {startedAt,durationMs:performance.now()-started,status:'COMPLETED' as const,errorType:null,inputTokens:result.inputTokens,outputTokens:result.outputTokens};
    attempts.push(attempt);
    try { await onAttempt?.(attempt); } catch { /* Diagnostic logging must not block inference. */ }
    return result;
  } catch (error) {
    const attempt = {startedAt,durationMs:performance.now()-started,status:'FAILED' as const,errorType:error instanceof Error ? error.name : 'UnknownError',inputTokens:null,outputTokens:null};
    attempts.push(attempt);
    try { await onAttempt?.(attempt, error); } catch { /* Diagnostic logging must not block inference. */ }
    throw error;
  }
}
