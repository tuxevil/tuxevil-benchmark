"use client";
import { useEffect, useState } from "react";
import type { PublicSnapshot } from "./public-snapshot";
export function useSnapshot() {
 const [data,setData]=useState<PublicSnapshot|null>(null);
 const [error,setError]=useState<string|null>(null);
 useEffect(()=>{let stopped=false;let timer:ReturnType<typeof setTimeout>;
 const poll=async()=>{try{const r=await fetch('/api/public/snapshot',{cache:'no-store'});if(!r.ok)throw Error();const snapshot=await r.json();if(!stopped){setData(snapshot);setError(null);}}catch{if(!stopped)setError('La actualización está temporalmente pausada. Reintentando…');}finally{if(!stopped)timer=setTimeout(poll,3000);}};
 void poll();return()=>{stopped=true;clearTimeout(timer);};},[]);
 return {data,error:data?null:error};
}
