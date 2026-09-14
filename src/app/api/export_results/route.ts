import { NextResponse } from "next/server";
import { exportResults, type ExportRow } from "@/lib/database";

const CSV_HEADERS: Array<keyof ExportRow> = [
  "runId",
  "runCreatedAt",
  "runStatus",
  "category",
  "attackType",
  "scenarioId",
  "systemPrompt",
  "userMessages",
  "parameters",
  "selectedModels",
  "ollamaUrl",
  "runError",
  "resultId",
  "modelName",
  "sampleIndex",
  "status",
  "evalStatus",
  "responseText",
  "inputTokens",
  "outputTokens",
  "ttftMs",
  "tokPerSec",
  "totalDurationMs",
  "errorMessage",
  "humanStatus",
  "humanNotes",
  "evaluatorModel",
  "grammarRating",
  "complianceRating",
  "accuracyRating",
  "scoreStars",
  "grammarAnalysis",
  "complianceAnalysis",
  "accuracyAnalysis",
  "feedbackText",
  "securityScore",
  "injectionSuccessful",
  "systemLeakageDetected",
  "vulnerabilityAnalysis",
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows: ExportRow[]): string {
  const lines = [CSV_HEADERS.map((header) => csvCell(header)).join(",")];
  for (const row of rows) {
    lines.push(CSV_HEADERS.map((header) => csvCell(row[header])).join(","));
  }
  return lines.join("\r\n");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = (url.searchParams.get("format")?.trim() || "json").toLowerCase();
  if (format !== "csv" && format !== "json") {
    return NextResponse.json({ error: "format must be 'csv' or 'json'." }, { status: 400 });
  }

  const minScoreRaw = url.searchParams.get("minScore")?.trim();
  let minScore: number | null = null;
  if (minScoreRaw != null && minScoreRaw !== "") {
    minScore = Number(minScoreRaw);
    if (!Number.isInteger(minScore) || minScore < 1 || minScore > 5) {
      return NextResponse.json({ error: "minScore must be an integer between 1 and 5." }, { status: 400 });
    }
  }

  const vulnerableOnly = url.searchParams.get("vulnerableOnly") === "true";

  try {
    const rows = await exportResults({
      scenarioId: url.searchParams.get("scenarioId")?.trim() || null,
      modelName: url.searchParams.get("modelName")?.trim() || null,
      category: url.searchParams.get("category")?.trim() || null,
      status: url.searchParams.get("status")?.trim() || null,
      dateFrom: url.searchParams.get("dateFrom")?.trim() || null,
      dateTo: url.searchParams.get("dateTo")?.trim() || null,
      minScore,
      vulnerableOnly,
    });

    if (format === "csv") {
      const filename = `tuxevil-benchmark-results_${new Date().toISOString().slice(0, 10)}.csv`;
      return new NextResponse("\uFEFF" + toCsv(rows), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({ exportedAt: new Date().toISOString(), count: rows.length, rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
