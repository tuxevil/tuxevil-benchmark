"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LeaderboardModelRow } from "@/lib/contracts";
import { compareCotEnergyPairs, computeSolarEfficiencyRows } from "@/lib/solar-efficiency";

type SuiteRunRecord = {
  id: string;
  suiteType: "capacity" | "long-context-cache" | "context-compaction" | "warm-contexts";
  modelName: string;
  provider: string;
  createdAt: string;
  report: Record<string, unknown>;
};

export function SolarAndSuitesPanel() {
  const [leaderboardModels, setLeaderboardModels] = useState<LeaderboardModelRow[]>([]);
  const [provider, setProvider] = useState<"llamacpp" | "ollama">("llamacpp");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:8888");
  const [modelName, setModelName] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<"off" | "default">("off");
  const [capacityWorkload, setCapacityWorkload] = useState<"gsm8k-lite" | "long-context">("gsm8k-lite");
  const [capacityRounds, setCapacityRounds] = useState(2);
  const [compactionTokens, setCompactionTokens] = useState(4096);
  const [warmFleetLevels, setWarmFleetLevels] = useState("2,4,8");
  const [warmSlots, setWarmSlots] = useState(2);
  const [activeSuite, setActiveSuite] = useState<string | null>(null);
  const [suiteError, setSuiteError] = useState<string | null>(null);
  const [capacityRuns, setCapacityRuns] = useState<SuiteRunRecord[]>([]);
  const [longContextRuns, setLongContextRuns] = useState<SuiteRunRecord[]>([]);
  const [compactionRuns, setCompactionRuns] = useState<SuiteRunRecord[]>([]);
  const [warmContextRuns, setWarmContextRuns] = useState<SuiteRunRecord[]>([]);

  const fetchSnapshot = useCallback(async () => {
    const [lbRes, settingsRes, capRes, lcRes, compRes, warmRes] = await Promise.all([
      fetch("/api/leaderboard"),
      fetch("/api/settings"),
      fetch("/api/experiments/capacity"),
      fetch("/api/experiments/suites/long-context-cache"),
      fetch("/api/experiments/suites/context-compaction"),
      fetch("/api/experiments/suites/warm-contexts"),
    ]);
    const lb = lbRes.ok ? await lbRes.json() : null;
    const settings = settingsRes.ok ? (await settingsRes.json()).settings : null;
    const cap = capRes.ok ? (await capRes.json()).runs ?? [] : null;
    const lc = lcRes.ok ? (await lcRes.json()).runs ?? [] : null;
    const comp = compRes.ok ? (await compRes.json()).runs ?? [] : null;
    const warm = warmRes.ok ? (await warmRes.json()).runs ?? [] : null;
    return { lb, settings, cap, lc, comp, warm };
  }, []);

  const applySnapshot = useCallback(
    (snap: Awaited<ReturnType<typeof fetchSnapshot>>) => {
      if (snap.lb) setLeaderboardModels(Array.isArray(snap.lb.models) ? snap.lb.models : []);
      if (snap.settings) {
        const active = snap.settings.activeProvider === "ollama" ? "ollama" : "llamacpp";
        setProvider(active);
        setEndpoint(active === "ollama" ? snap.settings.ollamaUrl : snap.settings.llamacppUrl);
      }
      if (snap.cap) setCapacityRuns(snap.cap);
      if (snap.lc) setLongContextRuns(snap.lc);
      if (snap.comp) setCompactionRuns(snap.comp);
      if (snap.warm) setWarmContextRuns(snap.warm);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot()
      .then((snap) => {
        if (!cancelled) applySnapshot(snap);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchSnapshot, applySnapshot]);

  const solarRows = useMemo(() => computeSolarEfficiencyRows(leaderboardModels), [leaderboardModels]);
  const cotComparisons = useMemo(() => compareCotEnergyPairs(leaderboardModels), [leaderboardModels]);
  const bestSolarRow = useMemo(() => solarRows.find((r) => r.whPerUsefulTask != null) ?? null, [solarRows]);
  const bestCotGain = useMemo(() => cotComparisons[0] ?? null, [cotComparisons]);

  const runSuite = async (suite: "capacity" | "long-context-cache" | "context-compaction" | "warm-contexts") => {
    if (!modelName.trim()) {
      setSuiteError("Indica el identificador del modelo a evaluar.");
      return;
    }
    setActiveSuite(suite);
    setSuiteError(null);
    try {
      const url =
        suite === "capacity"
          ? "/api/experiments/capacity"
          : suite === "long-context-cache"
            ? "/api/experiments/suites/long-context-cache"
            : suite === "context-compaction"
              ? "/api/experiments/suites/context-compaction"
              : "/api/experiments/suites/warm-contexts";
      const baseParams = {
        temperature: 0,
        numCtx: 16384,
        topP: 0.9,
        repeatPenalty: 1.1,
        numPredict: 512,
        reasoningEffort,
      };
      const parsedFleet = warmFleetLevels
        .split(",")
        .map((v) => Number.parseInt(v.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 32);
      const payload =
        suite === "capacity"
          ? { provider, endpoint, model: modelName.trim(), rounds: capacityRounds, workloadMode: capacityWorkload, parameters: { ...baseParams, seed: 42 } }
          : suite === "long-context-cache"
            ? { provider, endpoint, model: modelName.trim(), tiers: [1024, 4096, 8192, 16384], includeColdLoadProbe: true, parameters: baseParams }
            : suite === "context-compaction"
              ? { provider, endpoint, model: modelName.trim(), targetHistoryTokens: compactionTokens, parameters: { ...baseParams, seed: 42 } }
              : {
                  provider,
                  endpoint,
                  model: modelName.trim(),
                  agentCounts: parsedFleet.length > 0 ? parsedFleet : [2, 4, 8],
                  concurrencySlots: Math.max(1, Math.min(8, warmSlots)),
                  turnsPerAgent: 3,
                  contextTokens: compactionTokens,
                  parameters: baseParams,
                };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSuiteError(data.error ?? `Error HTTP ${res.status}`);
        return;
      }
      applySnapshot(await fetchSnapshot());
    } catch (error) {
      setSuiteError(error instanceof Error ? error.message : "Error ejecutando la suite.");
    } finally {
      setActiveSuite(null);
    }
  };

  return (
    <>
      <section className="panel-card txb-cyber-panel">
        <div className="panel-card-header">
          <div>
            <p className="card-kicker">SOLAR TELEMETRY // WH PER USEFUL TASK</p>
            <h2>Eficiencia Solar</h2>
          </div>
          <span className="txb-sensor-pill">
            <span className="live-dot" aria-hidden="true" />
            WALL: <code>sensor.servidor_potencia_local</code>
          </span>
        </div>

        <div className="txb-mini-kpi-grid">
          <div className="txb-mini-kpi">
            <span className="txb-mini-kpi-label">MEJOR WH / TAREA ÚTIL</span>
            <strong className="txb-mini-kpi-val">
              {bestSolarRow?.whPerUsefulTask != null ? `${bestSolarRow.whPerUsefulTask.toFixed(4)} Wh` : "Sin datos"}
            </strong>
            <small>{bestSolarRow ? `${bestSolarRow.modelName} (${bestSolarRow.energyScope?.toUpperCase()})` : "Esperando lecturas ≥90%"}</small>
          </div>
          <div className="txb-mini-kpi">
            <span className="txb-mini-kpi-label">MAYOR GANANCIA CoT</span>
            <strong className="txb-mini-kpi-val accent-lime">
              {bestCotGain ? `${bestCotGain.arenaDelta >= 0 ? "+" : ""}${bestCotGain.arenaDelta} idx` : "—"}
            </strong>
            <small>{bestCotGain ? `${bestCotGain.modelName} (${bestCotGain.cotMode} vs off)` : "Sin pares CoT"}</small>
          </div>
          <div className="txb-mini-kpi">
            <span className="txb-mini-kpi-label">MODELOS CON ENERGÍA</span>
            <strong className="txb-mini-kpi-val accent-cyan">
              {solarRows.filter((r) => r.energyScope !== null).length} / {solarRows.length}
            </strong>
            <small>scope wall priorizado sobre GPU</small>
          </div>
        </div>

        <div className="performance-table-wrap">
          <table className="performance-table">
            <thead>
              <tr>
                <th>Modelo / Config</th>
                <th>CoT</th>
                <th>Arena</th>
                <th>Fuente</th>
                <th>Wh / petición</th>
                <th>Wh / tarea útil</th>
                <th>Tareas útiles / kWh</th>
                <th>Tokens vis. / Wh</th>
                <th>Cobertura</th>
              </tr>
            </thead>
            <tbody>
              {solarRows.slice(0, 20).map((row) => (
                <tr key={row.identityKey}>
                  <td>
                    <strong>{row.modelName}</strong>
                    <small>{row.configurationLabel} · {row.provider}</small>
                  </td>
                  <td>{row.reasoningEffort}</td>
                  <td>{row.arenaIndex}</td>
                  <td>{row.energyScope ?? "Sin datos"}</td>
                  <td>{row.whPerRequest != null ? `${row.whPerRequest.toFixed(4)} Wh` : "—"}</td>
                  <td>{row.whPerUsefulTask != null ? `${row.whPerUsefulTask.toFixed(4)} Wh` : "—"}</td>
                  <td>{row.usefulTasksPerKwh != null ? row.usefulTasksPerKwh.toLocaleString() : "—"}</td>
                  <td>{row.usefulVisibleTokensPerWh != null ? row.usefulVisibleTokensPerWh.toLocaleString() : "—"}</td>
                  <td>{row.measuredCount}/{row.totalRuns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {cotComparisons.length > 0 && (
          <>
            <h3 style={{ marginTop: "18px" }}>Coste energético y ganancia de CoT (On / Default vs. Off)</h3>
            <div className="performance-table-wrap">
              <table className="performance-table">
                <thead>
                  <tr>
                    <th>Modelo</th>
                    <th>Modo CoT</th>
                    <th>Δ Arena</th>
                    <th>Δ Calidad / Seg.</th>
                    <th>Latencia ×</th>
                    <th>Tokens ×</th>
                    <th>Energía (Wh/req)</th>
                    <th>Wh extra / punto Arena</th>
                  </tr>
                </thead>
                <tbody>
                  {cotComparisons.map((c) => (
                    <tr key={c.pairKey}>
                      <td>
                        <strong>{c.modelName}</strong>
                        <small>{c.configurationLabel}</small>
                      </td>
                      <td>{c.cotMode} vs off</td>
                      <td>{c.arenaDelta >= 0 ? `+${c.arenaDelta}` : c.arenaDelta} ({c.offArenaIndex} → {c.cotArenaIndex})</td>
                      <td>
                        {c.qualityStarsDelta != null ? `${c.qualityStarsDelta >= 0 ? "+" : ""}${c.qualityStarsDelta}★` : "—"} /{" "}
                        {c.securityDelta != null ? `${c.securityDelta >= 0 ? "+" : ""}${c.securityDelta}%` : "—"}
                      </td>
                      <td>{c.durationMultiplier != null ? `${c.durationMultiplier}×` : "—"}</td>
                      <td>{c.outputTokensMultiplier != null ? `${c.outputTokensMultiplier}×` : "—"}</td>
                      <td>
                        {c.energyScope && c.offWhPerRequest != null && c.cotWhPerRequest != null
                          ? `${c.offWhPerRequest.toFixed(4)} → ${c.cotWhPerRequest.toFixed(4)} (${c.energyScope}, ${c.whRatio ?? "—"}×)`
                          : "Sin datos"}
                      </td>
                      <td>{c.whPerArenaPointGained != null ? `${c.whPerArenaPointGained.toFixed(5)} Wh` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel-card">
        <div className="panel-card-header">
          <div>
            <p className="card-kicker">Fase 2 · Suites Especializadas</p>
            <h2>Cold vs. Warm · Prompt Cache · Concurrencia · Context Compaction</h2>
          </div>
        </div>

        <div className="performance-options" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
          <label>
            Proveedor
            <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as "llamacpp" | "ollama")}>
              <option value="llamacpp">llama.cpp</option>
              <option value="ollama">Ollama</option>
            </select>
          </label>
          <label>
            Endpoint
            <input className="input" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
          </label>
          <label>
            Modelo
            <input className="input" placeholder="unsloth/gemma-4-E2B-it-qat-GGUF" value={modelName} onChange={(e) => setModelName(e.target.value)} />
          </label>
          <label>
            CoT
            <select className="input" value={reasoningEffort} onChange={(e) => setReasoningEffort(e.target.value as "off" | "default")}>
              <option value="off">off</option>
              <option value="default">default</option>
            </select>
          </label>
          <label>
            Workload Concurrencia
            <select className="input" value={capacityWorkload} onChange={(e) => setCapacityWorkload(e.target.value as "gsm8k-lite" | "long-context")}>
              <option value="gsm8k-lite">GSM8K lite (corto)</option>
              <option value="long-context">Long context (4k KV)</option>
            </select>
          </label>
          <label>
            Rondas / Historial (tok)
            <div style={{ display: "flex", gap: "6px" }}>
              <input className="input" type="number" min={1} max={6} value={capacityRounds} onChange={(e) => setCapacityRounds(Number(e.target.value))} title="Rondas de concurrencia" />
              <input className="input" type="number" min={512} max={16384} step={512} value={compactionTokens} onChange={(e) => setCompactionTokens(Number(e.target.value))} title="Tokens previos a compactación" />
            </div>
          </label>
          <label>
            RECALL Flota / Slots GPU
            <div style={{ display: "flex", gap: "6px" }}>
              <input className="input" value={warmFleetLevels} onChange={(e) => setWarmFleetLevels(e.target.value)} title="Niveles de agentes (ej. 2,4,8)" placeholder="2,4,8" />
              <input className="input" type="number" min={1} max={8} value={warmSlots} onChange={(e) => setWarmSlots(Number(e.target.value))} title="Slots GPU simultáneos (S)" style={{ maxWidth: "74px" }} />
            </div>
          </label>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "12px" }}>
          <button type="button" className="btn-primary" disabled={Boolean(activeSuite)} onClick={() => void runSuite("long-context-cache")}>
            {activeSuite === "long-context-cache" ? "Ejecutando Cold/Warm + Cache…" : "▶ Ejecutar Cold/Warm + Cache (1k–16k)"}
          </button>
          <button type="button" className="btn-primary" disabled={Boolean(activeSuite)} onClick={() => void runSuite("capacity")}>
            {activeSuite === "capacity" ? "Ejecutando Concurrencia 1/2/4…" : "▶ Ejecutar Concurrent Throughput (1/2/4)"}
          </button>
          <button type="button" className="btn-primary" disabled={Boolean(activeSuite)} onClick={() => void runSuite("warm-contexts")}>
            {activeSuite === "warm-contexts" ? "Ejecutando RECALL Warm Contexts…" : "▶ Ejecutar RECALL Warm Contexts (Flota/RAM)"}
          </button>
          <button type="button" className="btn-primary" disabled={Boolean(activeSuite)} onClick={() => void runSuite("context-compaction")}>
            {activeSuite === "context-compaction" ? "Ejecutando Context Compaction…" : "▶ Ejecutar Context Compaction Overhead"}
          </button>
        </div>
        {suiteError && <p className="reevaluate-error" role="alert" style={{ marginTop: "8px" }}>{suiteError}</p>}

        {longContextRuns.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <h3>Últimas ejecuciones: Cold vs. Warm + Prompt Cache + Long Context</h3>
            <div className="performance-table-wrap">
              <table className="performance-table">
                <thead>
                  <tr>
                    <th>Fecha / Modelo</th>
                    <th>Cold Load</th>
                    <th>Degradación Decode</th>
                    <th>Resumen por nivel (Prefill / Cache Hit / TTFT Δ)</th>
                  </tr>
                </thead>
                <tbody>
                  {longContextRuns.slice(0, 5).map((r) => {
                    const rep = r.report as {
                      coldLoadProbe?: { durationMs?: number } | null;
                      decodeDegradationPct?: number | null;
                      tiers?: Array<{
                        targetPromptTokens: number;
                        warmCacheHitRatio: number | null;
                        ttftSpeedupPct: number | null;
                        coldCache?: { prefillTokPerSec: number | null } | null;
                      }>;
                    };
                    return (
                      <tr key={r.id}>
                        <td><strong>{r.modelName}</strong><small>{new Date(r.createdAt).toLocaleString()}</small></td>
                        <td>{rep.coldLoadProbe?.durationMs != null ? `${rep.coldLoadProbe.durationMs} ms` : "—"}</td>
                        <td>{rep.decodeDegradationPct != null ? `${rep.decodeDegradationPct}%` : "—"}</td>
                        <td>
                          {(rep.tiers ?? []).map((t) => (
                            <span key={t.targetPromptTokens} style={{ display: "inline-block", marginRight: "10px", fontSize: "0.78rem" }}>
                              <strong>{t.targetPromptTokens}t:</strong>{" "}
                              {t.coldCache?.prefillTokPerSec != null ? `${t.coldCache.prefillTokPerSec} tok/s` : "—"} · cache{" "}
                              {t.warmCacheHitRatio != null ? `${Math.round(t.warmCacheHitRatio * 100)}%` : "—"} · TTFT{" "}
                              {t.ttftSpeedupPct != null ? `${t.ttftSpeedupPct >= 0 ? "-" : "+"}${Math.abs(t.ttftSpeedupPct)}%` : "—"}
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {capacityRuns.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <h3>Últimas ejecuciones: Concurrent Throughput (c = 1 / 2 / 4)</h3>
            <div className="performance-table-wrap">
              <table className="performance-table">
                <thead>
                  <tr>
                    <th>Fecha / Modelo</th>
                    <th>Workload</th>
                    <th>Curva por concurrencia (tok/s · TTFT p50 · precisión · Wh/correcta)</th>
                  </tr>
                </thead>
                <tbody>
                  {capacityRuns.slice(0, 5).map((r) => {
                    const rep = r.report as {
                      workloadMode?: string;
                      summary?: Array<{
                        concurrency: number;
                        outputTokensPerSecond: number | null;
                        accuracy: number | null;
                        ttftMs?: { p50: number | null };
                        wattHoursPerCorrect: number | null;
                        wallWattHoursPerCorrect?: number | null;
                      }>;
                    };
                    return (
                      <tr key={r.id}>
                        <td><strong>{r.modelName}</strong><small>{new Date(r.createdAt).toLocaleString()}</small></td>
                        <td>{rep.workloadMode ?? "gsm8k-lite"}</td>
                        <td>
                          {(rep.summary ?? []).map((lvl) => (
                            <span key={lvl.concurrency} style={{ display: "inline-block", marginRight: "12px", fontSize: "0.78rem" }}>
                              <strong>c={lvl.concurrency}:</strong>{" "}
                              {lvl.outputTokensPerSecond != null ? `${lvl.outputTokensPerSecond.toFixed(1)} tok/s` : "—"} · TTFT{" "}
                              {lvl.ttftMs?.p50 != null ? `${Math.round(lvl.ttftMs.p50)} ms` : "—"} · acc{" "}
                              {lvl.accuracy != null ? `${Math.round(lvl.accuracy * 100)}%` : "—"} ·{" "}
                              {lvl.wallWattHoursPerCorrect != null
                                ? `${lvl.wallWattHoursPerCorrect.toFixed(4)} Wh_wall/ok`
                                : lvl.wattHoursPerCorrect != null
                                  ? `${lvl.wattHoursPerCorrect.toFixed(4)} Wh_gpu/ok`
                                  : "Wh —"}
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {warmContextRuns.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <h3>Últimas ejecuciones: RECALL Warm Contexts (Flota N agentes / S slots + Wh solar)</h3>
            <div className="performance-table-wrap">
              <table className="performance-table">
                <thead>
                  <tr>
                    <th>Fecha / Modelo</th>
                    <th>Slots / Ctx</th>
                    <th>Sostenidos / Rodilla</th>
                    <th>Curva por flota (Cache Hit · TTFT p50/p95 · Tasks/min · Wh)</th>
                  </tr>
                </thead>
                <tbody>
                  {warmContextRuns.slice(0, 5).map((r) => {
                    const rep = r.report as {
                      concurrencySlots?: number;
                      contextTokens?: number;
                      maxSustainedAgents?: number;
                      kneeMeasuredAgents?: number | null;
                      kneeReason?: string | null;
                      levels?: Array<{
                        agents: number;
                        warmCacheHitRatio: number | null;
                        warmTtftP50Ms: number | null;
                        warmTtftP95Ms: number | null;
                        tasksPerMinute: number | null;
                        wallWattHours: number | null;
                        gpuWattHours: number | null;
                        passedChecks: number;
                        totalTurns: number;
                      }>;
                    };
                    return (
                      <tr key={r.id}>
                        <td><strong>{r.modelName}</strong><small>{new Date(r.createdAt).toLocaleString()}</small></td>
                        <td>S={rep.concurrencySlots ?? "—"} · {rep.contextTokens ?? "—"}t</td>
                        <td title={rep.kneeReason ?? undefined}>
                          <strong>{rep.maxSustainedAgents ?? 0} ag.</strong>
                          <small>{rep.kneeMeasuredAgents != null ? `rodilla N=${rep.kneeMeasuredAgents}` : "sin rodilla"}</small>
                        </td>
                        <td>
                          {(rep.levels ?? []).map((lvl) => (
                            <span key={lvl.agents} style={{ display: "inline-block", marginRight: "12px", fontSize: "0.78rem" }}>
                              <strong>N={lvl.agents}:</strong>{" "}
                              cache {lvl.warmCacheHitRatio != null ? `${Math.round(lvl.warmCacheHitRatio * 100)}%` : "—"} · TTFT{" "}
                              {lvl.warmTtftP50Ms != null ? `${Math.round(lvl.warmTtftP50Ms)}/${Math.round(lvl.warmTtftP95Ms ?? lvl.warmTtftP50Ms)} ms` : "—"} ·{" "}
                              {lvl.tasksPerMinute != null ? `${lvl.tasksPerMinute.toFixed(1)} t/m` : "—"} ·{" "}
                              {lvl.passedChecks}/{lvl.totalTurns} ok ·{" "}
                              {lvl.wallWattHours != null
                                ? `${lvl.wallWattHours.toFixed(4)} Wh_wall`
                                : lvl.gpuWattHours != null
                                  ? `${lvl.gpuWattHours.toFixed(4)} Wh_gpu`
                                  : "Wh —"}
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {compactionRuns.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <h3>Últimas ejecuciones: Context Compaction Overhead</h3>
            <div className="performance-table-wrap">
              <table className="performance-table">
                <thead>
                  <tr>
                    <th>Fecha / Modelo</th>
                    <th>Historial</th>
                    <th>Overhead compactación</th>
                    <th>Retención post-compactación</th>
                    <th>Cache invalidado</th>
                  </tr>
                </thead>
                <tbody>
                  {compactionRuns.slice(0, 5).map((r) => {
                    const rep = r.report as {
                      targetHistoryTokens?: number;
                      compactionTimeSharePct?: number | null;
                      cacheInvalidated?: boolean | null;
                      compaction?: { durationMs: number; outputTokens: number | null };
                      postCompaction?: { retainedFacts: number; totalFacts: number; retentionScorePct: number };
                    };
                    return (
                      <tr key={r.id}>
                        <td><strong>{r.modelName}</strong><small>{new Date(r.createdAt).toLocaleString()}</small></td>
                        <td>{rep.targetHistoryTokens ?? "—"} tok</td>
                        <td>
                          {rep.compaction ? `${rep.compaction.durationMs} ms (${rep.compaction.outputTokens ?? "—"} tok)` : "—"}
                          {rep.compactionTimeSharePct != null ? ` · ${rep.compactionTimeSharePct}% tiempo` : ""}
                        </td>
                        <td>
                          {rep.postCompaction
                            ? `${rep.postCompaction.retentionScorePct}% (${rep.postCompaction.retainedFacts}/${rep.postCompaction.totalFacts})`
                            : "—"}
                        </td>
                        <td>{rep.cacheInvalidated == null ? "Sin datos" : rep.cacheInvalidated ? "Sí (re-prefill)" : "No"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
