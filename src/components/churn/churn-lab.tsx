"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExecutionTargetPanel } from "@/components/churn/execution-target-panel";
import { ExperimentRunnerPanel } from "@/components/churn/experiment-runner-panel";

type ModelArtifact = {
  id: string;
  displayName: string;
  baseModel: string;
  architecture: string | null;
  quantization: string | null;
  totalParameters: number | null;
  activeParameters: number | null;
  effectiveBitsPerWeight: number | null;
  artifactSizeBytes: number | null;
  fingerprint: string;
  metadata: Record<string, unknown>;
};

type ExecutionEnvironment = {
  id: string;
  label: string;
  runtime: string;
  runtimeVersion: string | null;
  runtimeCommit: string | null;
  gpuModels: string[];
  cpuModel: string | null;
  kvCacheK: string | null;
  kvCacheV: string | null;
  contextSize: number | null;
  flashAttention: boolean | null;
  fingerprint: string;
  metadata: Record<string, unknown>;
};

type ExperimentRecord = {
  id: string;
  name: string;
  factorUnderTest: string;
  status: string;
  validityStatus: string;
  suiteKey: string | null;
  notes: string;
  baselineVariantId: string | null;
  updatedAt: string;
};

type ExperimentVariant = {
  id: string;
  experimentId: string;
  name: string;
  role: "BASELINE" | "VARIANT" | "BASELINE_REPEAT" | "CONTROL";
  modelArtifactId: string;
  executionEnvironmentId: string;
  executionTargetId: string | null;
  executionModelName: string | null;
  inferenceParameters: Record<string, unknown>;
  reasoningMode: string | null;
};

type ExperimentDetail = {
  experiment: ExperimentRecord;
  variants: ExperimentVariant[];
};

type CaseDiff = {
  caseId: string;
  status: "UNCHANGED" | "LOST" | "GAINED" | "CHANGED_NEUTRAL" | "BASELINE_ONLY" | "VARIANT_ONLY";
  baselineValue: string | null;
  variantValue: string | null;
  baselineSuccess: boolean | null;
  variantSuccess: boolean | null;
  repeatValue: string | null;
  repeatChanged: boolean | null;
};

type Comparison = {
  experimentId: string;
  baselineVariantId: string;
  variantId: string;
  baselineRepeatVariantId: string | null;
  summary: {
    churn: {
      totalPairs: number;
      changed: number;
      unchanged: number;
      churnRate: number;
      agreementRate: number;
      lostSuccesses: number;
      gainedSuccesses: number;
      neutralChanged: number;
      netSuccessDelta: number;
      baselineSuccessRate: number | null;
      variantSuccessRate: number | null;
      exactMcNemarPValue: number | null;
      churnRate95Ci: { low: number; high: number };
    };
    determinism: {
      validity: "UNCHECKED" | "VALID" | "INVALID";
      intrinsicChanged: number | null;
      intrinsicChurnRate: number | null;
      threshold: number;
      excessChurnRate: number | null;
      signalToNoiseRatio: number | null;
    };
    missingFromBaseline: string[];
    missingFromVariant: string[];
    missingFromRepeat: string[];
  };
  cases: CaseDiff[];
};

type Preset = {
  id: string;
  label: string;
  factor: string;
  hint: string;
  sameArtifact: boolean;
  sameEnvironment: boolean;
};

const PRESETS: Preset[] = [
  {
    id: "quant",
    label: "Quant / weights",
    factor: "MODEL_WEIGHTS",
    hint: "Keep runtime/environment identical; change the model artifact or quantization.",
    sameArtifact: false,
    sameEnvironment: true,
  },
  {
    id: "kv",
    label: "KV cache",
    factor: "KV_CACHE",
    hint: "Keep the model artifact identical; compare environments that differ only in K/V cache type.",
    sameArtifact: true,
    sameEnvironment: false,
  },
  {
    id: "backend",
    label: "Backend build",
    factor: "BACKEND_VERSION",
    hint: "Keep the artifact fixed; compare runtime commits/builds.",
    sameArtifact: true,
    sameEnvironment: false,
  },
  {
    id: "context",
    label: "Context depth",
    factor: "CONTEXT_DEPTH",
    hint: "Keep the artifact fixed; vary only context size/depth.",
    sameArtifact: true,
    sameEnvironment: false,
  },
  {
    id: "reasoning",
    label: "Reasoning mode",
    factor: "REASONING_MODE",
    hint: "Keep artifact and environment identical; change reasoning mode.",
    sameArtifact: true,
    sameEnvironment: true,
  },
  {
    id: "flash",
    label: "Flash Attention",
    factor: "FLASH_ATTENTION",
    hint: "Keep the artifact fixed; compare otherwise-equivalent environments with FA on/off.",
    sameArtifact: true,
    sameEnvironment: false,
  },
  {
    id: "sampling",
    label: "Sampling",
    factor: "SAMPLING",
    hint: "Keep artifact/environment identical; vary only inference parameters.",
    sameArtifact: true,
    sameEnvironment: true,
  },
  {
    id: "custom",
    label: "Custom",
    factor: "OTHER",
    hint: "Declare the variable you intend to change and keep everything else controlled.",
    sameArtifact: false,
    sameEnvironment: false,
  },
];

function pct(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function numberOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function bytesFromGb(value: string) {
  const gb = numberOrNull(value);
  return gb === null ? null : Math.round(gb * 1024 ** 3);
}

function formatFingerprint(value: string) {
  return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : "—";
}

function parseSuccess(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (["true", "pass", "passed", "1", "yes", "ok"].includes(text)) return true;
  if (["false", "fail", "failed", "0", "no"].includes(text)) return false;
  return null;
}

function parseObservations(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Paste at least one observation.");

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("JSON input must be an array.");
    return parsed.map((item, index) => {
      if (!item || typeof item !== "object") throw new Error(`Invalid JSON observation at index ${index}.`);
      const record = item as Record<string, unknown>;
      const caseId = String(record.caseId ?? record.case_id ?? "").trim();
      const rawValue = record.canonicalValue ?? record.value ?? "";
      const canonicalValue =
        typeof rawValue === "object" && rawValue !== null
          ? JSON.stringify(rawValue)
          : String(rawValue);
      if (!caseId) throw new Error(`Missing caseId at index ${index}.`);
      return {
        caseId,
        canonicalValue,
        success: parseSuccess(record.success),
        comparisonKind: record.comparisonKind === "STRUCTURAL" ? "STRUCTURAL" : "EXACT",
        telemetry:
          record.telemetry && typeof record.telemetry === "object" ? record.telemetry : {},
        metadata: record.metadata && typeof record.metadata === "object" ? record.metadata : {},
      };
    });
  }

  const rows = trimmed.split(/\r?\n/).filter(Boolean);
  return rows
    .filter((line, index) => !(index === 0 && /^case(id)?\t/i.test(line)))
    .map((line, index) => {
      const [caseIdRaw, value = "", successRaw = ""] = line.split("\t");
      const caseId = (caseIdRaw ?? "").trim();
      if (!caseId) throw new Error(`Missing caseId on line ${index + 1}.`);
      return {
        caseId,
        canonicalValue: value,
        success: parseSuccess(successRaw),
        comparisonKind: "EXACT" as const,
        telemetry: {},
        metadata: {},
      };
    });
}

export function ChurnLab() {
  const [artifacts, setArtifacts] = useState<ModelArtifact[]>([]);
  const [environments, setEnvironments] = useState<ExecutionEnvironment[]>([]);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [selectedExperimentId, setSelectedExperimentId] = useState("");
  const [compareVariantId, setCompareVariantId] = useState("");
  const [caseFilter, setCaseFilter] = useState("changed");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [artifactForm, setArtifactForm] = useState({
    displayName: "",
    baseModel: "",
    architecture: "",
    quantization: "",
    totalParametersB: "",
    activeParametersB: "",
    bpw: "",
    sizeGb: "",
    sha256: "",
    sourceUri: "",
    sourceRevision: "",
  });
  const [environmentForm, setEnvironmentForm] = useState({
    label: "",
    runtime: "llama.cpp",
    runtimeVersion: "",
    runtimeCommit: "",
    gpuModels: "",
    totalVramGb: "",
    cpuModel: "",
    systemRamGb: "",
    driverVersion: "",
    computeRuntimeVersion: "",
    os: "",
    kernel: "",
    runtimeFlags: "",
    kvCacheK: "q8_0",
    kvCacheV: "q8_0",
    contextSize: "8192",
    gpuOffload: "",
    flashAttention: "unknown",
    batchSize: "",
    ubatchSize: "",
    parallel: "1",
  });

  const [presetId, setPresetId] = useState("quant");
  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[0];
  const [experimentName, setExperimentName] = useState("");
  const [suiteKey, setSuiteKey] = useState("");
  const [notes, setNotes] = useState("");
  const [temperature, setTemperature] = useState("0");
  const [seed, setSeed] = useState("0");
  const [baselineArtifactId, setBaselineArtifactId] = useState("");
  const [variantArtifactId, setVariantArtifactId] = useState("");
  const [baselineEnvironmentId, setBaselineEnvironmentId] = useState("");
  const [variantEnvironmentId, setVariantEnvironmentId] = useState("");
  const [baselineReasoning, setBaselineReasoning] = useState("off");
  const [variantReasoning, setVariantReasoning] = useState("off");
  const [createRepeat, setCreateRepeat] = useState(true);

  const [observationVariantId, setObservationVariantId] = useState("");
  const [observationText, setObservationText] = useState(
    "caseId\tvalue\tsuccess\ncase-001\tA\tpass\ncase-002\tB\tfail",
  );

  const loadRegistries = useCallback(async () => {
    const [artifactRes, envRes, experimentRes] = await Promise.all([
      fetch("/api/experiments/artifacts"),
      fetch("/api/experiments/environments"),
      fetch("/api/experiments"),
    ]);
    if (!artifactRes.ok || !envRes.ok || !experimentRes.ok) {
      throw new Error("Could not load Churn Lab registries.");
    }
    const [artifactData, envData, experimentData] = await Promise.all([
      artifactRes.json(),
      envRes.json(),
      experimentRes.json(),
    ]);
    const nextArtifacts = (artifactData.artifacts ?? []) as ModelArtifact[];
    const nextEnvironments = (envData.environments ?? []) as ExecutionEnvironment[];
    const nextExperiments = (experimentData.experiments ?? []) as ExperimentRecord[];
    setArtifacts(nextArtifacts);
    setEnvironments(nextEnvironments);
    setExperiments(nextExperiments);
    setBaselineArtifactId((value) => value || nextArtifacts[0]?.id || "");
    setVariantArtifactId((value) => value || nextArtifacts[1]?.id || nextArtifacts[0]?.id || "");
    setBaselineEnvironmentId((value) => value || nextEnvironments[0]?.id || "");
    setVariantEnvironmentId((value) => value || nextEnvironments[0]?.id || "");
    return { nextArtifacts, nextEnvironments, nextExperiments };
  }, []);

  const loadExperiment = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      setComparison(null);
      return;
    }
    const res = await fetch(`/api/experiments/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("Could not load experiment.");
    const data = (await res.json()) as ExperimentDetail;
    setDetail(data);
    const targetVariant = data.variants.find((item) => item.role === "VARIANT");
    setCompareVariantId(targetVariant?.id ?? "");
    setObservationVariantId(data.experiment.baselineVariantId ?? data.variants[0]?.id ?? "");
    setComparison(null);
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const loaded = await loadRegistries();
        if (ignore) return;
        const firstId = loaded.nextExperiments[0]?.id ?? "";
        if (firstId) {
          setSelectedExperimentId(firstId);
          await loadExperiment(firstId);
        }
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "Could not initialize Churn Lab.");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [loadExperiment, loadRegistries]);

  const handlePresetChange = (id: string) => {
    const next = PRESETS.find((item) => item.id === id) ?? PRESETS[0];
    setPresetId(id);
    if (next.sameArtifact && baselineArtifactId) setVariantArtifactId(baselineArtifactId);
    if (next.sameEnvironment && baselineEnvironmentId) setVariantEnvironmentId(baselineEnvironmentId);
  };

  const controlWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (preset.sameArtifact && baselineArtifactId && variantArtifactId && baselineArtifactId !== variantArtifactId) {
      warnings.push("This preset expects the same model artifact on baseline and variant.");
    }
    if (
      preset.sameEnvironment &&
      baselineEnvironmentId &&
      variantEnvironmentId &&
      baselineEnvironmentId !== variantEnvironmentId
    ) {
      warnings.push("This preset expects the same execution environment on baseline and variant.");
    }
    if (preset.id === "quant" && baselineArtifactId === variantArtifactId && baselineArtifactId) {
      warnings.push("Quant experiments normally need two distinct model artifacts.");
    }
    if (preset.id === "reasoning" && baselineReasoning === variantReasoning) {
      warnings.push("Reasoning-mode experiments should use different reasoning modes.");
    }
    return warnings;
  }, [
    preset,
    baselineArtifactId,
    variantArtifactId,
    baselineEnvironmentId,
    variantEnvironmentId,
    baselineReasoning,
    variantReasoning,
  ]);

  const handleRegisterArtifact = async () => {
    setError(null);
    setNotice(null);
    const totalB = numberOrNull(artifactForm.totalParametersB);
    const activeB = numberOrNull(artifactForm.activeParametersB);
    const payload = {
      displayName: artifactForm.displayName.trim(),
      baseModel: artifactForm.baseModel.trim(),
      architecture: artifactForm.architecture.trim() || null,
      quantization: artifactForm.quantization.trim() || null,
      totalParameters: totalB === null ? null : Math.round(totalB * 1e9),
      activeParameters: activeB === null ? null : Math.round(activeB * 1e9),
      effectiveBitsPerWeight: numberOrNull(artifactForm.bpw),
      artifactSizeBytes: bytesFromGb(artifactForm.sizeGb),
      artifactSha256: artifactForm.sha256.trim() || null,
      sourceUri: artifactForm.sourceUri.trim() || null,
      sourceRevision: artifactForm.sourceRevision.trim() || null,
      tokenizerRevision: null,
      metadata: {},
    };
    const res = await fetch("/api/experiments/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not register artifact.");
      return;
    }
    setNotice(`Artifact registered: ${data.artifact.displayName}`);
    setArtifactForm((prev) => ({ ...prev, displayName: "", sha256: "" }));
    await loadRegistries();
    setBaselineArtifactId((value) => value || data.artifact.id);
  };

  const handleRegisterEnvironment = async () => {
    setError(null);
    setNotice(null);
    const payload = {
      label: environmentForm.label.trim(),
      runtime: environmentForm.runtime.trim(),
      runtimeVersion: environmentForm.runtimeVersion.trim() || null,
      runtimeCommit: environmentForm.runtimeCommit.trim() || null,
      gpuModels: environmentForm.gpuModels
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
      totalVramBytes: bytesFromGb(environmentForm.totalVramGb),
      cpuModel: environmentForm.cpuModel.trim() || null,
      systemRamBytes: bytesFromGb(environmentForm.systemRamGb),
      driverVersion: environmentForm.driverVersion.trim() || null,
      computeRuntimeVersion: environmentForm.computeRuntimeVersion.trim() || null,
      os: environmentForm.os.trim() || null,
      kernel: environmentForm.kernel.trim() || null,
      runtimeFlags: environmentForm.runtimeFlags
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
      kvCacheK: environmentForm.kvCacheK.trim() || null,
      kvCacheV: environmentForm.kvCacheV.trim() || null,
      contextSize: numberOrNull(environmentForm.contextSize),
      gpuOffload: numberOrNull(environmentForm.gpuOffload),
      flashAttention:
        environmentForm.flashAttention === "true"
          ? true
          : environmentForm.flashAttention === "false"
            ? false
            : null,
      batchSize: numberOrNull(environmentForm.batchSize),
      ubatchSize: numberOrNull(environmentForm.ubatchSize),
      parallel: numberOrNull(environmentForm.parallel),
      metadata: {},
    };
    const res = await fetch("/api/experiments/environments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not register environment.");
      return;
    }
    setNotice(`Environment registered: ${data.environment.label}`);
    setEnvironmentForm((prev) => ({ ...prev, label: "" }));
    await loadRegistries();
    setBaselineEnvironmentId((value) => value || data.environment.id);
  };

  const createVariant = async (
    experimentId: string,
    input: {
      name: string;
      role: ExperimentVariant["role"];
      modelArtifactId: string;
      executionEnvironmentId: string;
      reasoningMode?: string | null;
      parentVariantId?: string | null;
    },
  ) => {
    const res = await fetch(`/api/experiments/${encodeURIComponent(experimentId)}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        reasoningMode: input.reasoningMode ?? null,
        parentVariantId: input.parentVariantId ?? null,
        inferenceParameters: {
          temperature: numberOrNull(temperature) ?? 0,
          seed: numberOrNull(seed),
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not create experiment variant.");
    return data.variant as ExperimentVariant;
  };

  const handleCreateExperiment = async () => {
    setError(null);
    setNotice(null);
    if (!baselineArtifactId || !variantArtifactId || !baselineEnvironmentId || !variantEnvironmentId) {
      setError("Register/select artifacts and environments first.");
      return;
    }
    if (!experimentName.trim()) {
      setError("Experiment name is required.");
      return;
    }
    try {
      const experimentRes = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: experimentName.trim(),
          factorUnderTest: preset.factor,
          suiteKey: suiteKey.trim() || null,
          samplingSnapshot: {
            temperature: numberOrNull(temperature) ?? 0,
            seed: numberOrNull(seed),
          },
          notes,
        }),
      });
      const experimentData = await experimentRes.json();
      if (!experimentRes.ok) throw new Error(experimentData.error || "Could not create experiment.");
      const experiment = experimentData.experiment as ExperimentRecord;

      const baseline = await createVariant(experiment.id, {
        name: "baseline",
        role: "BASELINE",
        modelArtifactId: baselineArtifactId,
        executionEnvironmentId: baselineEnvironmentId,
        reasoningMode: baselineReasoning || null,
      });

      if (createRepeat) {
        await createVariant(experiment.id, {
          name: "baseline-repeat",
          role: "BASELINE_REPEAT",
          modelArtifactId: baselineArtifactId,
          executionEnvironmentId: baselineEnvironmentId,
          reasoningMode: baselineReasoning || null,
          parentVariantId: baseline.id,
        });
      }

      const variant = await createVariant(experiment.id, {
        name: "variant",
        role: "VARIANT",
        modelArtifactId: variantArtifactId,
        executionEnvironmentId: variantEnvironmentId,
        reasoningMode: variantReasoning || null,
        parentVariantId: baseline.id,
      });

      await loadRegistries();
      setSelectedExperimentId(experiment.id);
      await loadExperiment(experiment.id);
      setCompareVariantId(variant.id);
      setObservationVariantId(baseline.id);
      setNotice("Experiment created. Import observations for each variant, then compare.");
      setExperimentName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create experiment.");
    }
  };

  const handleSelectExperiment = async (id: string) => {
    setSelectedExperimentId(id);
    setError(null);
    try {
      await loadExperiment(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load experiment.");
    }
  };

  const handleImportObservations = async () => {
    if (!detail || !observationVariantId) {
      setError("Select an experiment variant first.");
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const parsed = parseObservations(observationText);
      const res = await fetch(
        `/api/experiments/${encodeURIComponent(detail.experiment.id)}/variants/${encodeURIComponent(observationVariantId)}/observations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ observations: parsed }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not import observations.");
      setNotice(`${parsed.length} observations imported into ${detail.variants.find((item) => item.id === observationVariantId)?.name ?? "variant"}.`);
      setComparison(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse/import observations.");
    }
  };

  const handleCompare = async () => {
    if (!detail || !compareVariantId) {
      setError("Select a variant to compare.");
      return;
    }
    setError(null);
    setNotice(null);
    const repeat = detail.variants.find((item) => item.role === "BASELINE_REPEAT");
    const query = new URLSearchParams({ variantId: compareVariantId });
    if (repeat) query.set("baselineRepeatVariantId", repeat.id);
    const res = await fetch(
      `/api/experiments/${encodeURIComponent(detail.experiment.id)}/compare?${query.toString()}`,
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not compare variants.");
      return;
    }
    setComparison(data as Comparison);
  };

  const filteredCases = useMemo(() => {
    if (!comparison) return [];
    if (caseFilter === "all") return comparison.cases;
    if (caseFilter === "changed") return comparison.cases.filter((item) => item.status !== "UNCHANGED");
    return comparison.cases.filter((item) => item.status === caseFilter);
  }, [comparison, caseFilter]);

  const runnerVariants = useMemo(() => {
    if (!detail) return [];
    const artifactById = new Map(artifacts.map((item) => [item.id, item]));
    const environmentById = new Map(environments.map((item) => [item.id, item]));

    return detail.variants.map((variant) => {
      if (variant.executionTargetId && variant.executionModelName) return variant;
      const artifact = artifactById.get(variant.modelArtifactId);
      const environment = environmentById.get(variant.executionEnvironmentId);
      const artifactTarget =
        typeof artifact?.metadata?.executionTargetId === "string"
          ? artifact.metadata.executionTargetId
          : null;
      const environmentTarget =
        typeof environment?.metadata?.executionTargetId === "string"
          ? environment.metadata.executionTargetId
          : null;
      const inferredTarget =
        artifactTarget && environmentTarget && artifactTarget === environmentTarget
          ? artifactTarget
          : null;

      return {
        ...variant,
        executionTargetId: variant.executionTargetId ?? inferredTarget,
        executionModelName:
          variant.executionModelName
          ?? (inferredTarget && artifactTarget === inferredTarget ? artifact?.displayName ?? null : null),
      };
    });
  }, [detail, artifacts, environments]);

  if (loading) {
    return <div className="churn-loading panel">Loading Churn Lab…</div>;
  }

  return (
    <div className="churn-lab">
      <section className="churn-hero">
        <div>
          <p className="eyebrow">Experimental laboratory</p>
          <h1>Churn Lab</h1>
          <p>
            Compare local model variants case by case. Keep controlled variables explicit,
            measure intrinsic run noise, and inspect regressions that aggregate scores hide.
          </p>
        </div>
        <div className="churn-hero-stats">
          <div><strong>{artifacts.length}</strong><span>Artifacts</span></div>
          <div><strong>{environments.length}</strong><span>Environments</span></div>
          <div><strong>{experiments.length}</strong><span>Experiments</span></div>
        </div>
      </section>

      {(notice || error) && (
        <div className={`churn-notice ${error ? "error" : "success"}`}>
          {error ?? notice}
        </div>
      )}

      <ExecutionTargetPanel onRegistryChange={loadRegistries} />

      <section className="churn-grid churn-registry-grid">
        <div className="panel churn-card">
          <div className="churn-card-head">
            <div>
              <p className="card-kicker">Registry</p>
              <h2>Model Artifact</h2>
            </div>
            <span className="churn-count">{artifacts.length}</span>
          </div>
          <div className="churn-form-grid">
            <label>
              Display name
              <input className="input" value={artifactForm.displayName} onChange={(e) => setArtifactForm({ ...artifactForm, displayName: e.target.value })} placeholder="Qwen3.6 35B IQ3" />
            </label>
            <label>
              Base model
              <input className="input" value={artifactForm.baseModel} onChange={(e) => setArtifactForm({ ...artifactForm, baseModel: e.target.value })} placeholder="Qwen3.6-35B-A3B" />
            </label>
            <label>
              Quantization
              <input className="input" value={artifactForm.quantization} onChange={(e) => setArtifactForm({ ...artifactForm, quantization: e.target.value })} placeholder="UD-IQ3_XXS" />
            </label>
            <label>
              Architecture
              <input className="input" value={artifactForm.architecture} onChange={(e) => setArtifactForm({ ...artifactForm, architecture: e.target.value })} placeholder="MoE" />
            </label>
          </div>
          <details className="churn-advanced">
            <summary>Advanced artifact identity</summary>
            <div className="churn-form-grid">
              <label>Total params (B)<input className="input" value={artifactForm.totalParametersB} onChange={(e) => setArtifactForm({ ...artifactForm, totalParametersB: e.target.value })} /></label>
              <label>Active params (B)<input className="input" value={artifactForm.activeParametersB} onChange={(e) => setArtifactForm({ ...artifactForm, activeParametersB: e.target.value })} /></label>
              <label>Effective bpw<input className="input" value={artifactForm.bpw} onChange={(e) => setArtifactForm({ ...artifactForm, bpw: e.target.value })} /></label>
              <label>Artifact size (GiB)<input className="input" value={artifactForm.sizeGb} onChange={(e) => setArtifactForm({ ...artifactForm, sizeGb: e.target.value })} /></label>
              <label className="churn-span-2">SHA256<input className="input mono" value={artifactForm.sha256} onChange={(e) => setArtifactForm({ ...artifactForm, sha256: e.target.value })} placeholder="optional 64 hex chars" /></label>
              <label className="churn-span-2">Source URI<input className="input" value={artifactForm.sourceUri} onChange={(e) => setArtifactForm({ ...artifactForm, sourceUri: e.target.value })} /></label>
              <label>Source revision<input className="input" value={artifactForm.sourceRevision} onChange={(e) => setArtifactForm({ ...artifactForm, sourceRevision: e.target.value })} /></label>
            </div>
          </details>
          <button className="primary-button churn-action" type="button" onClick={handleRegisterArtifact} disabled={!artifactForm.displayName.trim() || !artifactForm.baseModel.trim()}>
            Register artifact
          </button>
          <div className="churn-registry-list">
            {artifacts.slice(0, 5).map((item) => (
              <div className="churn-registry-row" key={item.id}>
                <div><strong>{item.displayName}</strong><span>{item.baseModel} · {item.quantization ?? "unquantized/unknown"}</span></div>
                <code>{formatFingerprint(item.fingerprint)}</code>
              </div>
            ))}
          </div>
        </div>

        <div className="panel churn-card">
          <div className="churn-card-head">
            <div>
              <p className="card-kicker">Registry</p>
              <h2>Execution Environment</h2>
            </div>
            <span className="churn-count">{environments.length}</span>
          </div>
          <div className="churn-form-grid">
            <label>
              Label
              <input className="input" value={environmentForm.label} onChange={(e) => setEnvironmentForm({ ...environmentForm, label: e.target.value })} placeholder="beast / llama.cpp build A" />
            </label>
            <label>
              Runtime
              <input className="input" value={environmentForm.runtime} onChange={(e) => setEnvironmentForm({ ...environmentForm, runtime: e.target.value })} />
            </label>
            <label>
              Runtime commit
              <input className="input mono" value={environmentForm.runtimeCommit} onChange={(e) => setEnvironmentForm({ ...environmentForm, runtimeCommit: e.target.value })} />
            </label>
            <label>
              GPUs
              <input className="input" value={environmentForm.gpuModels} onChange={(e) => setEnvironmentForm({ ...environmentForm, gpuModels: e.target.value })} placeholder="Quadro RTX 4000" />
            </label>
            <label>KV K<input className="input" value={environmentForm.kvCacheK} onChange={(e) => setEnvironmentForm({ ...environmentForm, kvCacheK: e.target.value })} /></label>
            <label>KV V<input className="input" value={environmentForm.kvCacheV} onChange={(e) => setEnvironmentForm({ ...environmentForm, kvCacheV: e.target.value })} /></label>
            <label>Context<input className="input" value={environmentForm.contextSize} onChange={(e) => setEnvironmentForm({ ...environmentForm, contextSize: e.target.value })} /></label>
            <label>
              Flash Attention
              <select className="input" value={environmentForm.flashAttention} onChange={(e) => setEnvironmentForm({ ...environmentForm, flashAttention: e.target.value })}>
                <option value="unknown">Unknown</option>
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </label>
          </div>
          <details className="churn-advanced">
            <summary>Advanced runtime fingerprint</summary>
            <div className="churn-form-grid">
              <label>Runtime version<input className="input" value={environmentForm.runtimeVersion} onChange={(e) => setEnvironmentForm({ ...environmentForm, runtimeVersion: e.target.value })} /></label>
              <label>VRAM (GiB)<input className="input" value={environmentForm.totalVramGb} onChange={(e) => setEnvironmentForm({ ...environmentForm, totalVramGb: e.target.value })} /></label>
              <label>CPU<input className="input" value={environmentForm.cpuModel} onChange={(e) => setEnvironmentForm({ ...environmentForm, cpuModel: e.target.value })} /></label>
              <label>RAM (GiB)<input className="input" value={environmentForm.systemRamGb} onChange={(e) => setEnvironmentForm({ ...environmentForm, systemRamGb: e.target.value })} /></label>
              <label>Driver<input className="input" value={environmentForm.driverVersion} onChange={(e) => setEnvironmentForm({ ...environmentForm, driverVersion: e.target.value })} /></label>
              <label>CUDA/compute runtime<input className="input" value={environmentForm.computeRuntimeVersion} onChange={(e) => setEnvironmentForm({ ...environmentForm, computeRuntimeVersion: e.target.value })} /></label>
              <label>OS<input className="input" value={environmentForm.os} onChange={(e) => setEnvironmentForm({ ...environmentForm, os: e.target.value })} /></label>
              <label>Kernel<input className="input" value={environmentForm.kernel} onChange={(e) => setEnvironmentForm({ ...environmentForm, kernel: e.target.value })} /></label>
              <label>GPU offload<input className="input" value={environmentForm.gpuOffload} onChange={(e) => setEnvironmentForm({ ...environmentForm, gpuOffload: e.target.value })} /></label>
              <label>Batch<input className="input" value={environmentForm.batchSize} onChange={(e) => setEnvironmentForm({ ...environmentForm, batchSize: e.target.value })} /></label>
              <label>UBatch<input className="input" value={environmentForm.ubatchSize} onChange={(e) => setEnvironmentForm({ ...environmentForm, ubatchSize: e.target.value })} /></label>
              <label>Parallel<input className="input" value={environmentForm.parallel} onChange={(e) => setEnvironmentForm({ ...environmentForm, parallel: e.target.value })} /></label>
              <label className="churn-span-2">Runtime flags (one per line)<textarea className="textarea mono" value={environmentForm.runtimeFlags} onChange={(e) => setEnvironmentForm({ ...environmentForm, runtimeFlags: e.target.value })} /></label>
            </div>
          </details>
          <button className="primary-button churn-action" type="button" onClick={handleRegisterEnvironment} disabled={!environmentForm.label.trim() || !environmentForm.runtime.trim()}>
            Register environment
          </button>
          <div className="churn-registry-list">
            {environments.slice(0, 5).map((item) => (
              <div className="churn-registry-row" key={item.id}>
                <div><strong>{item.label}</strong><span>{item.runtime} · {item.kvCacheK ?? "?"}/{item.kvCacheV ?? "?"} · ctx {item.contextSize ?? "?"}</span></div>
                <code>{formatFingerprint(item.fingerprint)}</code>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel churn-card churn-builder">
        <div className="churn-card-head">
          <div>
            <p className="card-kicker">Controlled experiment</p>
            <h2>Experiment Builder</h2>
          </div>
          <span className="churn-count">Step 2</span>
        </div>

        <div className="churn-preset-row">
          {PRESETS.map((item) => (
            <button key={item.id} type="button" className={`churn-preset ${presetId === item.id ? "active" : ""}`} onClick={() => handlePresetChange(item.id)}>
              <strong>{item.label}</strong>
              <span>{item.factor}</span>
            </button>
          ))}
        </div>
        <p className="churn-hint">{preset.hint}</p>

        <div className="churn-form-grid churn-builder-meta">
          <label>Experiment name<input className="input" value={experimentName} onChange={(e) => setExperimentName(e.target.value)} placeholder="Bonsai PTQ1 — KV q8 vs q4" /></label>
          <label>Suite key<input className="input" value={suiteKey} onChange={(e) => setSuiteKey(e.target.value)} placeholder="arc-500 / agent-lite-v1" /></label>
          <label>Temperature<input className="input" value={temperature} onChange={(e) => setTemperature(e.target.value)} /></label>
          <label>Seed<input className="input" value={seed} onChange={(e) => setSeed(e.target.value)} /></label>
          <label className="churn-span-2">Notes<textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What is held constant? What exactly changes?" /></label>
        </div>

        <div className="churn-variant-grid">
          <VariantEditor
            title="Baseline"
            artifactId={baselineArtifactId}
            environmentId={baselineEnvironmentId}
            reasoningMode={baselineReasoning}
            artifacts={artifacts}
            environments={environments}
            onArtifactChange={(value) => {
              setBaselineArtifactId(value);
              if (preset.sameArtifact) setVariantArtifactId(value);
            }}
            onEnvironmentChange={(value) => {
              setBaselineEnvironmentId(value);
              if (preset.sameEnvironment) setVariantEnvironmentId(value);
            }}
            onReasoningChange={setBaselineReasoning}
          />
          <VariantEditor
            title="Variant"
            artifactId={variantArtifactId}
            environmentId={variantEnvironmentId}
            reasoningMode={variantReasoning}
            artifacts={artifacts}
            environments={environments}
            onArtifactChange={setVariantArtifactId}
            onEnvironmentChange={setVariantEnvironmentId}
            onReasoningChange={setVariantReasoning}
          />
        </div>

        <label className="churn-check">
          <input type="checkbox" checked={createRepeat} onChange={(e) => setCreateRepeat(e.target.checked)} />
          Create identical baseline repeat for determinism validation
        </label>

        {controlWarnings.length > 0 && (
          <div className="churn-warning-list">
            {controlWarnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}
          </div>
        )}

        <button className="primary-button churn-action churn-create" type="button" onClick={handleCreateExperiment} disabled={!artifacts.length || !environments.length}>
          Create controlled experiment
        </button>
      </section>

      <section className="churn-workbench">
        <aside className="panel churn-card churn-experiment-list">
          <div className="churn-card-head">
            <div><p className="card-kicker">History</p><h2>Experiments</h2></div>
            <span className="churn-count">{experiments.length}</span>
          </div>
          {experiments.length === 0 ? (
            <p className="churn-empty">No experiments yet.</p>
          ) : (
            experiments.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`churn-experiment-item ${selectedExperimentId === item.id ? "active" : ""}`}
                onClick={() => void handleSelectExperiment(item.id)}
              >
                <strong>{item.name}</strong>
                <span>{item.factorUnderTest}</span>
                <small>{new Date(item.updatedAt).toLocaleString()}</small>
              </button>
            ))
          )}
        </aside>

        <div className="churn-workbench-main">
          {detail && (
            <ExperimentRunnerPanel
              key={detail.experiment.id}
              experimentId={detail.experiment.id}
              variants={runnerVariants}
              onBindingsSaved={() => loadExperiment(detail.experiment.id)}
              onComparison={(value) => setComparison(value as Comparison)}
            />
          )}

          <section className="panel churn-card">
            <div className="churn-card-head">
              <div>
                <p className="card-kicker">Manual fallback</p>
                <h2>Observation Import</h2>
              </div>
              {detail && <span className="churn-count">{detail.variants.length} variants</span>}
            </div>
            {!detail ? (
              <p className="churn-empty">Select an experiment.</p>
            ) : (
              <>
                <div className="churn-inline-fields">
                  <label>
                    Target variant
                    <select className="input" value={observationVariantId} onChange={(e) => setObservationVariantId(e.target.value)}>
                      {detail.variants.map((variant) => (
                        <option key={variant.id} value={variant.id}>{variant.name} · {variant.role}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <textarea className="textarea churn-observation-input mono" value={observationText} onChange={(e) => setObservationText(e.target.value)} />
                <p className="churn-hint">
                  TSV: <code>caseId TAB canonicalValue TAB pass|fail</code>. JSON arrays are also accepted.
                </p>
                <button className="primary-button churn-action" type="button" onClick={handleImportObservations}>
                  Import / update observations
                </button>
              </>
            )}
          </section>

          <section className="panel churn-card">
            <div className="churn-card-head">
              <div>
                <p className="card-kicker">Comparison</p>
                <h2>Paired Comparison</h2>
              </div>
              {comparison && <span className={`churn-validity ${comparison.summary.determinism.validity.toLowerCase()}`}>{comparison.summary.determinism.validity}</span>}
            </div>
            {!detail ? (
              <p className="churn-empty">Select an experiment.</p>
            ) : (
              <>
                <div className="churn-compare-controls">
                  <label>
                    Variant vs baseline
                    <select className="input" value={compareVariantId} onChange={(e) => setCompareVariantId(e.target.value)}>
                      {detail.variants.filter((variant) => variant.role === "VARIANT" || variant.role === "CONTROL").map((variant) => (
                        <option key={variant.id} value={variant.id}>{variant.name}</option>
                      ))}
                    </select>
                  </label>
                  <button className="primary-button churn-action" type="button" onClick={handleCompare} disabled={!compareVariantId}>
                    Compare
                  </button>
                </div>
                {comparison && <ComparisonView comparison={comparison} caseFilter={caseFilter} setCaseFilter={setCaseFilter} cases={filteredCases} />}
              </>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function VariantEditor({
  title,
  artifactId,
  environmentId,
  reasoningMode,
  artifacts,
  environments,
  onArtifactChange,
  onEnvironmentChange,
  onReasoningChange,
}: {
  title: string;
  artifactId: string;
  environmentId: string;
  reasoningMode: string;
  artifacts: ModelArtifact[];
  environments: ExecutionEnvironment[];
  onArtifactChange: (value: string) => void;
  onEnvironmentChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
}) {
  return (
    <div className="churn-variant-card">
      <h3>{title}</h3>
      <label>
        Model artifact
        <select className="input" value={artifactId} onChange={(e) => onArtifactChange(e.target.value)}>
          <option value="">Select artifact…</option>
          {artifacts.map((item) => (
            <option key={item.id} value={item.id}>{item.displayName} · {item.quantization ?? "unknown"}</option>
          ))}
        </select>
      </label>
      <label>
        Execution environment
        <select className="input" value={environmentId} onChange={(e) => onEnvironmentChange(e.target.value)}>
          <option value="">Select environment…</option>
          {environments.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>
      <label>
        Reasoning mode
        <input className="input" value={reasoningMode} onChange={(e) => onReasoningChange(e.target.value)} placeholder="off / low / high / think" />
      </label>
    </div>
  );
}

function ComparisonView({
  comparison,
  caseFilter,
  setCaseFilter,
  cases,
}: {
  comparison: Comparison;
  caseFilter: string;
  setCaseFilter: (value: string) => void;
  cases: CaseDiff[];
}) {
  const churn = comparison.summary.churn;
  const determinism = comparison.summary.determinism;
  const snr =
    determinism.signalToNoiseRatio === null
      ? "—"
      : Number.isFinite(determinism.signalToNoiseRatio)
        ? `${determinism.signalToNoiseRatio.toFixed(2)}×`
        : "∞";

  return (
    <div className="churn-comparison">
      <div className="churn-metric-grid">
        <Metric label="Churn" value={pct(churn.churnRate)} sub={`${churn.changed}/${churn.totalPairs} changed`} />
        <Metric label="Agreement" value={pct(churn.agreementRate)} sub={`95% CI ${pct(churn.churnRate95Ci.low)}–${pct(churn.churnRate95Ci.high)} churn`} />
        <Metric label="Lost" value={String(churn.lostSuccesses)} tone="danger" sub="pass → fail" />
        <Metric label="Gained" value={String(churn.gainedSuccesses)} tone="success" sub="fail → pass" />
        <Metric label="Net success" value={churn.netSuccessDelta > 0 ? `+${churn.netSuccessDelta}` : String(churn.netSuccessDelta)} sub={`McNemar p=${churn.exactMcNemarPValue?.toFixed(4) ?? "—"}`} />
        <Metric label="Intrinsic churn" value={pct(determinism.intrinsicChurnRate)} sub={`threshold ${pct(determinism.threshold)}`} />
        <Metric label="Excess churn" value={pct(determinism.excessChurnRate)} sub="variant minus intrinsic noise" />
        <Metric label="Signal / noise" value={snr} sub={determinism.validity} />
      </div>

      <div className="churn-success-strip">
        <span>Baseline success <strong>{pct(churn.baselineSuccessRate)}</strong></span>
        <span>Variant success <strong>{pct(churn.variantSuccessRate)}</strong></span>
        <span>Neutral changes <strong>{churn.neutralChanged}</strong></span>
      </div>

      <div className="churn-case-toolbar">
        {["changed", "all", "LOST", "GAINED", "CHANGED_NEUTRAL", "BASELINE_ONLY", "VARIANT_ONLY"].map((filter) => (
          <button key={filter} type="button" className={caseFilter === filter ? "active" : ""} onClick={() => setCaseFilter(filter)}>
            {filter.replaceAll("_", " ")}
          </button>
        ))}
      </div>

      <div className="churn-case-table">
        <div className="churn-case-row head">
          <span>Case</span><span>Status</span><span>Baseline</span><span>Variant</span><span>Repeat</span>
        </div>
        {cases.length === 0 ? (
          <p className="churn-empty">No cases match this filter.</p>
        ) : (
          cases.map((item) => (
            <div className="churn-case-row" key={item.caseId}>
              <code>{item.caseId}</code>
              <span className={`churn-case-status ${item.status.toLowerCase()}`}>{item.status.replaceAll("_", " ")}</span>
              <span title={item.baselineValue ?? ""}>{item.baselineValue ?? "—"} <Outcome value={item.baselineSuccess} /></span>
              <span title={item.variantValue ?? ""}>{item.variantValue ?? "—"} <Outcome value={item.variantSuccess} /></span>
              <span className={item.repeatChanged ? "churn-repeat-noisy" : ""}>{item.repeatValue ?? "—"}{item.repeatChanged ? " ⚠" : ""}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Outcome({ value }: { value: boolean | null }) {
  return value === null ? null : <small className={value ? "churn-outcome-pass" : "churn-outcome-fail"}>{value ? "PASS" : "FAIL"}</small>;
}

function Metric({ label, value, sub, tone = "" }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className={`churn-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}
