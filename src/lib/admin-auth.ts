import { timingSafeEqual } from 'node:crypto';
import { headers } from 'next/headers';
export function authorizeAdmin(h: Headers, method = 'GET'): Response | null {
  const user = process.env.BENCHMARK_ADMIN_USER;
  const password = process.env.BENCHMARK_ADMIN_PASSWORD;
  if (!user || !password) return new Response('Administración sin configurar.', {status:503});
  const expected = Buffer.from(`Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`);
  const actual = Buffer.from(h.get('authorization') ?? '');
  if(actual.length !== expected.length || !timingSafeEqual(actual, expected)) return new Response('Acceso privado', {status:401,headers:{'WWW-Authenticate':'Basic realm="Benchmark admin", charset="UTF-8"','Cache-Control':'no-store'}});
  if(!['GET','HEAD','OPTIONS'].includes(method)) {
    const origin = h.get('origin');
    if(h.get('sec-fetch-site') === 'cross-site' || (origin && new URL(origin).host !== h.get('host'))) return new Response('Origen no permitido', {status:403});
  }
  return null;
}
export async function requireAdmin(method: string) { return authorizeAdmin(await headers(), method); }
