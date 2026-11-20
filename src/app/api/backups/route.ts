import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clearResults, createBackup, listBackups, loadBackup, restoreBackup, summary } from '@/lib/result-backups';
import { benchmarkStore } from '@/lib/benchmark-store';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ backups: await listBackups() });
    const backup = await loadBackup(id);
    return NextResponse.json({ backup: summary(backup), runs: backup.data.test_runs, results: backup.data.model_results, turns: backup.data.model_result_turns, evaluations: backup.data.evaluations, history: backup.data.evaluation_history });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().max(120) }),
  z.object({ action: z.literal('restore'), id: z.string().uuid(), models: z.array(z.string()).min(1) }),
  z.object({ action: z.literal('clear'), id: z.string().uuid(), confirmation: z.literal('LIMPIAR RESULTADOS') }),
]);
export async function POST(request: Request) {
  if (request.headers.get('origin') && new URL(request.headers.get('origin')!).host !== request.headers.get('host')) return NextResponse.json({ error: 'Origen inválido.' }, { status: 403 });
  try {
    const input = actionSchema.parse(await request.json());
    const result = input.action === 'create' ? await createBackup(input.name) : input.action === 'clear' ? await clearResults(input.id) : await restoreBackup(input.id, input.models);
    if (input.action !== 'create') benchmarkStore.invalidateResultCache();
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
