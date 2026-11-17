import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from './lib/admin-auth';
export function proxy(request: NextRequest) {
 const p=request.nextUrl.pathname;
 if(p==='/'||p==='/scenarios'||p==='/live'||p==='/api/public/results'||p==='/api/public/snapshot'||p.startsWith('/_next/static/')||p.startsWith('/_next/image')||p==='/favicon.ico')return NextResponse.next();
 return authorizeAdmin(request.headers,request.method) ?? NextResponse.next();
}
