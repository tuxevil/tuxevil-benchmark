const sensitiveKey = /(?:api[_-]?key|token|password|secret|credential|authorization|endpoint|url|path|prompt|response|raw[_-]?sse|request[_-]?body|user(?:name)?|account|email|login)/i;

/** Remove infrastructure identifiers and credentials from persisted diagnostics. */
export function sanitizeDiagnosticText(value: string, maxLength = 500): string {
  return value
    .replace(/\b(bearer|basic)\s+\S+/gi, "$1 [redacted]")
    .replace(/\b(api[_-]?key|token|password|secret|credential|authorization|user(?:name)?|account|email|login)\b(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/\b[\w.+-]+@[\w.-]+\b/g, "[account redacted]")
    .replace(/\b[\w.-]+\\[\w.$-]+/g, "[account redacted]")
    .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[URL redacted]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[IP redacted]")
    .replace(/(?:[A-Za-z]:\\[^\s"'<>]+|\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)/g, "[path redacted]")
    .slice(0, maxLength);
}

/** Keep runtime option names for comparison while dropping their values. */
export function safeRuntimeFlagNames(flags: string[]): string[] {
  return [...new Set(flags
    .map((flag) => flag.split("=", 1)[0]?.trim())
    .filter((flag): flag is string => Boolean(flag?.startsWith("-")))
    .filter((flag) => !/(?:key|token|password|secret|auth|host|url|path|file)/i.test(flag)))]
    .sort();
}

/** Persist only allowlisted llama.cpp settings whose values help explain runtime differences. */
export function safeRuntimeFlagSettings(flags: string[]): Array<{ flag: string; value: string | boolean }> {
  const numericFlags = new Set([
    "-c", "--ctx-size", "-ngl", "--n-gpu-layers", "-b", "--batch-size", "-ub", "--ubatch-size",
    "-np", "--parallel", "-t", "--threads", "-tb", "--threads-batch", "--main-gpu", "--tensor-split",
    "--rope-scale", "--rope-freq-base", "--rope-freq-scale", "--cache-reuse", "--defrag-thold",
    "--fit-target", "--fit-ctx", "--grp-attn-n", "--grp-attn-w", "--yarn-orig-ctx", "--yarn-ext-factor",
    "--yarn-attn-factor", "--yarn-beta-fast", "--yarn-beta-slow",
  ]);
  const enumFlags = new Set([
    "-ctk", "--cache-type-k", "-ctv", "--cache-type-v", "-sm", "--split-mode", "--rope-scaling",
  ]);
  const booleanFlags = new Set([
    "-fa", "--flash-attn", "--no-kv-offload", "--mlock", "--no-mmap", "--cont-batching",
    "--no-cont-batching", "--context-shift", "--no-context-shift", "--jinja", "--no-warmup", "--no-escape",
  ]);
  const settings: Array<{ flag: string; value: string | boolean }> = [];

  for (let index = 0; index < flags.length; index += 1) {
    const argument = flags[index];
    const equalsIndex = argument.indexOf("=");
    const flag = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
    if (!numericFlags.has(flag) && !enumFlags.has(flag) && !booleanFlags.has(flag)) continue;

    let rawValue: string | undefined = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : undefined;
    if (rawValue === undefined && index + 1 < flags.length) {
      const next = flags[index + 1];
      if (!next.startsWith("-") || /^-\d+(?:\.\d+)?$/.test(next)) {
        rawValue = next;
        index += 1;
      }
    }

    if (booleanFlags.has(flag)) {
      const normalized = rawValue?.toLowerCase();
      if (normalized && !["true", "false", "on", "off", "auto", "1", "0"].includes(normalized)) continue;
      settings.push({ flag, value: normalized ?? true });
      continue;
    }
    if (!rawValue || rawValue.length > 80) continue;
    if (numericFlags.has(flag) && !/^-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?)*$/.test(rawValue)) continue;
    if (enumFlags.has(flag) && !/^[A-Za-z0-9_.:+-]+$/.test(rawValue)) continue;
    settings.push({ flag, value: rawValue });
  }

  return settings;
}

/** Defense in depth for diagnostic payloads assembled by multiple call sites. */
export function sanitizeDiagnosticPayload(value: unknown): unknown {
  if (typeof value === "string") return sanitizeDiagnosticText(value);
  if (Array.isArray(value)) return value.map(sanitizeDiagnosticPayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKey.test(key) ? "[redacted]" : sanitizeDiagnosticPayload(entry),
    ]));
  }
  return value;
}
