import { benchmarkStore } from "@/lib/benchmark-store";
import { subscribeRunEvents } from "@/lib/run-events";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await benchmarkStore.hydrate();
  const { id } = await params;
  const run = benchmarkStore.getRun(id);
  if (!run) return new Response(JSON.stringify({ error: "Run not found." }), { status: 404 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void | Promise<void>) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (pollTimer) clearTimeout(pollTimer);
        void unsubscribe?.();
        controller.close();
      };
      let lastSnapshot = "";
      const send = (event: { id: number; type: string; run: typeof run }) => {
        if (closed) return;
        const serializedRun = JSON.stringify(event.run);
        if (serializedRun === lastSnapshot) return;
        lastSnapshot = serializedRun;
        controller.enqueue(
          encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify({ type: event.type, run: event.run })}\n\n`),
        );
        if (["COMPLETED", "FAILED", "CANCELLED"].includes(event.run.status)) setTimeout(close, 50);
      };

      const localUnsubscribe = benchmarkStore.subscribe(id, (event) => {
        send({ id: event.id, type: event.type, run: event.run });
      });
      unsubscribe = localUnsubscribe;
      void (async () => {
        if (process.env.REDIS_URL) {
          const redisUnsubscribe = await subscribeRunEvents(id, (event) => {
            send({ id: event.id, type: event.type, run: event.run });
          });
          if (closed) {
            await redisUnsubscribe();
            return;
          }
          const previousUnsubscribe = unsubscribe;
          unsubscribe = async () => {
            previousUnsubscribe?.();
            await redisUnsubscribe();
          };
        }
        if (!lastSnapshot) {
          const snapshot = process.env.REDIS_URL ? await benchmarkStore.refreshRun(id) : benchmarkStore.getRun(id);
          if (snapshot) send({ id: 0, type: "run.snapshot", run: snapshot });
        }
      })().catch((error) => {
        if (!closed) console.error("[tuxevil-benchmark] SSE event setup failed", error);
      });
      if (process.env.REDIS_URL) {
        const poll = async () => {
          if (closed) return;
          try {
            const refreshed = await benchmarkStore.refreshRun(id);
            if (refreshed) send({ id: 0, type: "run.refresh", run: refreshed });
          } catch {
            // The local subscription remains usable while a durable store is unavailable.
          } finally {
            if (!closed) pollTimer = setTimeout(() => void poll(), 500);
          }
        };
        void poll();
      }
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      void unsubscribe?.();
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream",
      "x-accel-buffering": "no",
    },
  });
}
