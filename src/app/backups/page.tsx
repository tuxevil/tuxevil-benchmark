'use client';
import { useEffect, useState } from 'react';
import { TopbarNav } from '@/components/layout/topbar-nav';
type Backup = { id: string; name: string; createdAt: string; runs: number; results: number; models: {name: string; count: number}[] };
type Detail = { results: { id: string; model_name: string; status: string; response_text: string | null }[]; turns: Record<string, unknown>[]; evaluations: Record<string, unknown>[]; history: Record<string, unknown>[] };
export default function BackupsPage() {
  const [backups,setBackups] = useState<Backup[]>([]);
  const [selected,setSelected] = useState<Backup>();
  const [detail,setDetail] = useState<Detail>();
  const [models,setModels] = useState<string[]>([]);
  const [name,setName] = useState('');
  const [clearId,setClearId] = useState('');
  const [filter,setFilter] = useState('');
  const [limit,setLimit] = useState(25);
  const [confirmation,setConfirmation] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  async function refresh() { const r = await fetch('/api/backups'); const d = await r.json(); if (!r.ok) throw Error(d.error); setBackups(d.backups); }
  useEffect(() => { let active = true; fetch('/api/backups').then(async r => { const d = await r.json(); if (!r.ok) throw Error(d.error); if (active) setBackups(d.backups); }).catch(e => { if (active) setNotice(e.message); }); return () => { active = false; }; },[]);
  async function inspect(backup: Backup) {
    setBusy(true); setDetail(undefined);
    try { const r = await fetch(`/api/backups?id=${backup.id}`); const d = await r.json(); if (!r.ok) throw Error(d.error); setSelected(backup);setDetail(d);setModels(backup.models.map(m=>m.name));setConfirmation(''); }
    catch(e) {setNotice((e as Error).message);} finally {setBusy(false);}
  }
  async function act(action: string) {
    setBusy(true);setNotice('');
    try {
      const r = await fetch('/api/backups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,name,id:action === 'clear' ? (clearId || backups[0]?.id) : selected?.id,models,confirmation})});
      const d = await r.json(); if(!r.ok) throw Error(d.error);
      setNotice(action==='create'?'Respaldo creado y verificado.':action==='clear'?`${d.deleted} resultados eliminados. Puedes empezar de cero.`:`${d.restored} resultados restaurados; ${d.skipped} ya existían.`);
      await refresh();setConfirmation(''); if(action==='create') setClearId(d.id);
    }catch(e){setNotice((e as Error).message);}finally{setBusy(false);}
  }
  const visibleResults = detail?.results.filter(r => !filter || r.model_name === filter) ?? [];
  return <><TopbarNav activeTab="backups"/><main className="backups-page">
    <header className="backups-heading"><span className="backups-eyebrow">DATOS Y COMPARACIONES</span><h1>Respaldos de resultados</h1><p>Conserva una comparación, empieza una nueva y recupera los modelos que necesites.</p></header>
    {notice && <div className="backups-notice" role="status">{notice}</div>}
    <div className="backups-actions-grid">
      <section className="backups-card"><div className="backups-step">01 · CONSERVAR</div><h2>Crear respaldo</h2><p>Incluye respuestas, turnos, evaluaciones y revisiones de todos tus modelos.</p>
        <label className="backups-field">Nombre del respaldo<input className="input" value={name} maxLength={120} onChange={e=>setName(e.target.value)} placeholder="Ej. Comparación original · noviembre"/></label>
        <button className="primary-button" disabled={busy} onClick={()=>act('create')}>{busy ? 'Procesando…' : 'Crear respaldo de resultados'}</button>
        <small>Los respaldos se guardan en este servidor.</small>
      </section>
      <section className="backups-card backups-danger"><div className="backups-step">02 · EMPEZAR DE CERO</div><h2>Limpiar resultados</h2><p>Vacía la tabla de resultados. Conserva tus respaldos, escenarios y ajustes.</p>
        <label className="backups-field">Respaldo de seguridad<select className="input" disabled={busy || !backups.length} value={clearId || backups[0]?.id || ''} onChange={e=>{setClearId(e.target.value);setConfirmation('');}}>{!backups.length && <option value="">Primero crea un respaldo</option>}{backups.map(b=><option key={b.id} value={b.id}>{b.name} · {new Date(b.createdAt).toLocaleString()}</option>)}</select></label>
        <label className="backups-field">Para confirmar, escribe LIMPIAR RESULTADOS<input className="input" disabled={!backups.length || busy} value={confirmation} placeholder="LIMPIAR RESULTADOS" onChange={e=>setConfirmation(e.target.value)}/></label>
        <button className="danger-button" disabled={busy || !backups.length || confirmation!=='LIMPIAR RESULTADOS'} onClick={()=>{if(window.confirm('¿Eliminar todas las ejecuciones y resultados actuales? Se conservará el respaldo.')) void act('clear');}}>Limpiar todos los resultados</button>
        <small>El respaldo debe coincidir con los datos actuales. Si cambiaron, crea uno nuevo.</small>
      </section>
    </div>
    <p className="backups-help">Termina o cancela las ejecuciones pendientes antes de respaldar, restaurar o limpiar.</p>
    <section className="backups-card"><div className="backups-section-heading"><div><h2>Respaldos guardados</h2><p>Abre un respaldo para explorar su contenido o recuperar modelos.</p></div><span className="backups-badge">{backups.length} respaldos</span></div>
      {!backups.length ? <div className="backups-empty">Aún no hay respaldos. Crea el primero antes de limpiar tus resultados.</div> : <div className="backups-table-wrap"><table className="backups-table"><thead><tr><th>Respaldo</th><th>Creado</th><th>Modelos</th><th>Resultados</th><th><span className="backups-sr-only">Acciones</span></th></tr></thead><tbody>{backups.map(b=><tr key={b.id} className={selected?.id===b.id?'backups-selected':''}><td><strong>{b.name}</strong><small>{b.runs.toLocaleString()} ejecuciones</small></td><td>{new Date(b.createdAt).toLocaleString()}</td><td>{b.models.length}</td><td>{b.results.toLocaleString()}</td><td><button className="quiet-button" disabled={busy} onClick={()=>{setFilter('');setLimit(25);void inspect(b);}}>Explorar y restaurar →</button></td></tr>)}</tbody></table></div>}
    </section>
    {selected&&detail&&<section className="backups-card backups-detail"><div className="backups-section-heading"><div><span className="backups-eyebrow">CONTENIDO DEL RESPALDO</span><h2>{selected.name}</h2><p>{selected.runs.toLocaleString()} ejecuciones · {selected.results.toLocaleString()} resultados</p></div><button className="quiet-button" onClick={()=>{setSelected(undefined);setDetail(undefined);}}>Cerrar detalle</button></div>
      <h3>Restaurar modelos</h3><p>Selecciona todos para restaurar el respaldo completo. Los resultados que ya existen se omiten.</p>
      <div className="backups-toolbar"><button className="quiet-button" disabled={busy} onClick={()=>setModels(selected.models.map(m=>m.name))}>Seleccionar todos</button><button className="quiet-button" disabled={busy} onClick={()=>setModels([])}>Quitar selección</button><span>{models.length} de {selected.models.length} seleccionados</span></div>
      <div className="backups-models">{selected.models.map(m=><label key={m.name} className="model-option"><input type="checkbox" disabled={busy} checked={models.includes(m.name)} onChange={e=>setModels(e.target.checked?[...models,m.name]:models.filter(n=>n!==m.name))}/><span>{m.name}</span><span className="backups-badge">{m.count}</span></label>)}</div>
      <button className="primary-button backups-restore" disabled={busy||!models.length} onClick={()=>{if(window.confirm(`¿Restaurar ${models.length} modelos de este respaldo?`)) void act('restore');}}>Restaurar {models.length === selected.models.length ? 'respaldo completo' : `${models.length} modelos seleccionados`}</button>
      <div className="backups-section-heading backups-content-heading"><h3>Explorar resultados</h3><label className="backups-field">Filtrar por modelo<select className="input" value={filter} onChange={e=>{setFilter(e.target.value);setLimit(25);}}><option value="">Todos los modelos</option>{selected.models.map(m=><option key={m.name}>{m.name}</option>)}</select></label></div>
      <p className="backups-help">Mostrando {Math.min(limit,visibleResults.length)} de {visibleResults.length.toLocaleString()} resultados</p>
      {visibleResults.slice(0,limit).map(r=><details key={r.id} className="backups-result"><summary><strong>{r.model_name}</strong><span className="backups-badge">{r.status}</span><small>{r.id}</small></summary><pre>{r.response_text||'Sin respuesta final'}</pre><details><summary>Turnos, evaluaciones e historial</summary><pre>{JSON.stringify({turnos:detail.turns.filter(t=>t.model_result_id===r.id),evaluaciones:detail.evaluations.filter(t=>t.model_result_id===r.id),historial:detail.history.filter(t=>t.model_result_id===r.id)},null,2)}</pre></details></details>)}
      {visibleResults.length>limit&&<button className="quiet-button" onClick={()=>setLimit(limit+25)}>Mostrar 25 resultados más</button>}
    </section>}
  </main></>;
}
