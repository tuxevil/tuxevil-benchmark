import { PUBLIC_BENCHMARKS } from "@/lib/public-benchmarks";

export function GET() {
  return Response.json({ benchmarks: PUBLIC_BENCHMARKS });
}
