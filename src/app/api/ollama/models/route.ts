import { requireAdmin } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { httpUrlSchema } from "@/lib/contracts";
import { validateOllamaEndpoint } from "@/lib/endpoints";
import { formatBytes } from "@/lib/format-bytes";
import { sqliteLoadSettings } from "@/lib/sqlite-db";

type OllamaTagsResponse = {
  models?: Array<{ name: string; size?: number }>;
};

type OllamaPsResponse = {
  models?: Array<{ name: string; size_vram?: number }>;
};

async function handleGET(request: NextRequest) {
  let defaultUrl = "http://127.0.0.1:11434";
  try {
    const saved = sqliteLoadSettings();
    if (saved?.ollamaUrl) {
      defaultUrl = saved.ollamaUrl;
    }
  } catch {
    // fallback
  }

  const endpoint =
    request.nextUrl.searchParams.get("url")?.trim() ||
    process.env.OLLAMA_URL ||
    defaultUrl;

  const parsedEndpoint = httpUrlSchema.safeParse(endpoint);
  if (!parsedEndpoint.success) {
    return NextResponse.json({ error: "An Ollama endpoint is required." }, { status: 400 });
  }
  const endpointError = validateOllamaEndpoint(parsedEndpoint.data);
  if (endpointError) return NextResponse.json({ error: endpointError }, { status: 400 });

  const baseUrl = parsedEndpoint.data.replace(/\/$/, "");

  try {
    const [tagsRes, psRes] = await Promise.all([
      fetch(`${baseUrl}/api/tags`, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      }),
      fetch(`${baseUrl}/api/ps`, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(4_000),
      }).catch(() => null),
    ]);

    if (!tagsRes.ok) {
      return NextResponse.json({ error: `Ollama returned HTTP ${tagsRes.status}.` }, { status: 502 });
    }

    const tagsPayload = (await tagsRes.json()) as OllamaTagsResponse;
    const models = (tagsPayload.models ?? []).map((model) => ({
      name: model.name,
      size: model.size ? formatBytes(model.size) : "local",
    }));

    let runningModels: Array<{ name: string; vramFormatted: string }> = [];
    if (psRes && psRes.ok) {
      try {
        const psPayload = (await psRes.json()) as OllamaPsResponse;
        runningModels = (psPayload.models ?? []).map((m) => ({
          name: m.name,
          vramFormatted: m.size_vram ? formatBytes(m.size_vram) : "Active",
        }));
      } catch {
        // Fallback if /api/ps parsing fails
      }
    }

    return NextResponse.json({
      models,
      runningModels,
      activeModel: runningModels.length > 0 ? runningModels[0].name : null,
      activeVram: runningModels.length > 0 ? runningModels[0].vramFormatted : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown connection error.";
    return NextResponse.json({ error: `Could not reach Ollama: ${message}` }, { status: 502 });
  }
}

export async function GET(...args: Parameters<typeof handleGET>) {
 const denied=await requireAdmin("GET"); if(denied)return denied; return handleGET(...args);
}
