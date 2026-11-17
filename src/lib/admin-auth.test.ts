import { describe,it,expect,vi,afterEach } from 'vitest';
vi.mock('next/headers',()=>({headers:vi.fn()}));
import { authorizeAdmin } from './admin-auth';
afterEach(()=>vi.unstubAllEnvs());
describe('admin access',()=>{
 it('fails closed without credentials',()=>{vi.stubEnv('BENCHMARK_ADMIN_USER','');expect(authorizeAdmin(new Headers())?.status).toBe(503);});
 it('requires credentials and rejects cross site writes',()=>{vi.stubEnv('BENCHMARK_ADMIN_USER','admin');vi.stubEnv('BENCHMARK_ADMIN_PASSWORD','test-secret');expect(authorizeAdmin(new Headers())?.status).toBe(401);const h=new Headers({authorization:`Basic ${Buffer.from('admin:test-secret').toString('base64')}`,host:'benchmark.example'});expect(authorizeAdmin(h)).toBeNull();h.set('origin','https://attacker.example');expect(authorizeAdmin(h,'POST')?.status).toBe(403);});
});
