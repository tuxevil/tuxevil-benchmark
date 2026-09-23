import { deterministicGraderSchema, type DeterministicGrader } from "@/lib/contracts";

export type DeterministicGrade = {
  passed: boolean;
  comparisonKind: "EXACT" | "STRUCTURAL";
  canonicalValue: string;
  reason: string;
  details: Record<string, unknown>;
};

function normalizeText(
  value: string,
  options: { caseSensitive: boolean; collapseWhitespace: boolean },
) {
  let normalized = value.trim();
  if (options.collapseWhitespace) normalized = normalized.replace(/\s+/g, " ");
  if (!options.caseSensitive) normalized = normalized.toLocaleLowerCase("en-US");
  return normalized;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(",")}}`;
}

export function gradeDeterministicResponse(
  responseText: string,
  grader: DeterministicGrader,
): DeterministicGrade {
  if (grader.type === "EXACT_TEXT") {
    const actual = normalizeText(responseText, grader);
    const expected = normalizeText(grader.expected, grader);
    return {
      passed: actual === expected,
      comparisonKind: "EXACT",
      canonicalValue: actual,
      reason: actual === expected ? "Exact normalized text matched." : "Exact normalized text did not match.",
      details: { expected },
    };
  }

  if (grader.type === "JSON_EXACT") {
    const trimmed = responseText.trim();
    let actual: unknown;
    try {
      actual = JSON.parse(trimmed);
    } catch (error) {
      return {
        passed: false,
        comparisonKind: "STRUCTURAL",
        canonicalValue: trimmed,
        reason: "Response is not valid standalone JSON.",
        details: { parseError: error instanceof Error ? error.message : String(error) },
      };
    }
    const actualCanonical = canonicalJson(actual);
    const expectedCanonical = canonicalJson(grader.expected);
    return {
      passed: actualCanonical === expectedCanonical,
      comparisonKind: "STRUCTURAL",
      canonicalValue: actualCanonical,
      reason: actualCanonical === expectedCanonical ? "JSON value matched exactly." : "JSON value differed from expected structure/value.",
      details: { expectedCanonical },
    };
  }

  if (grader.type === "NUMBER") {
    const trimmed = responseText.trim();
    const actual = Number(trimmed);
    const parseable = trimmed.length > 0 && Number.isFinite(actual);
    const delta = parseable ? Math.abs(actual - grader.expected) : null;
    const passed = parseable && delta !== null && delta <= grader.tolerance;
    return {
      passed,
      comparisonKind: "STRUCTURAL",
      canonicalValue: parseable ? String(actual) : trimmed,
      reason: !parseable
        ? "Response is not a standalone finite number."
        : passed
          ? "Numeric answer is within tolerance."
          : "Numeric answer is outside tolerance.",
      details: { expected: grader.expected, tolerance: grader.tolerance, actual: parseable ? actual : null, delta },
    };
  }

  const haystack = grader.caseSensitive ? responseText : responseText.toLocaleLowerCase("en-US");
  const normalizeNeedle = (value: string) => grader.caseSensitive ? value : value.toLocaleLowerCase("en-US");
  const missing = grader.required.filter((value) => !haystack.includes(normalizeNeedle(value)));
  const forbiddenFound = grader.forbidden.filter((value) => haystack.includes(normalizeNeedle(value)));
  const passed = missing.length === 0 && forbiddenFound.length === 0;
  return {
    passed,
    comparisonKind: "STRUCTURAL",
    canonicalValue: responseText.trim(),
    reason: passed ? "All required fragments were present and forbidden fragments absent." : "Required/forbidden fragment constraints were not satisfied.",
    details: { missing, forbiddenFound },
  };
}


export function parseDeterministicGrader(value: unknown): DeterministicGrader | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = deterministicGraderSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
