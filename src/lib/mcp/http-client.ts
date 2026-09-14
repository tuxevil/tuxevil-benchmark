export class TuxevilBenchmarkApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "TuxevilBenchmarkApiError";
    this.status = status;
    this.details = details;
  }
}

export function getBaseUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `tuxevil Benchmark returned HTTP ${response.status}.`;
  try {
    const body = JSON.parse(text) as { error?: string; message?: string; details?: unknown };
    if (body.error) return body.error;
    if (body.message) return body.message;
    return JSON.stringify(body);
  } catch {
    return text;
  }
}

export async function tuxevilBenchmarkFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (init?.body != null) headers["content-type"] = "application/json";
  if (init?.headers) Object.assign(headers, init.headers);

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error.";
    throw new Error(`Could not reach tuxevil Benchmark at ${url}: ${message}`);
  }

  if (!response.ok) {
    const body = await errorMessage(response);
    throw new TuxevilBenchmarkApiError(response.status, body);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
