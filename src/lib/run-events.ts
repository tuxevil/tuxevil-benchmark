import Redis from "ioredis";
import type { RunEvent } from "@/lib/contracts";
import { LEGACY_RUN_EVENT_CHANNEL_PREFIX } from "@/lib/legacy-identifiers";

const channelPrefix = LEGACY_RUN_EVENT_CHANNEL_PREFIX;
let publisher: Redis | null | undefined;

export async function publishRunEvent(event: RunEvent) {
  const client = getPublisher();
  if (!client) return;
  await client.publish(channelName(event.run.id), JSON.stringify(event));
}

export async function subscribeRunEvents(runId: string, onEvent: (event: RunEvent) => void) {
  if (!process.env.REDIS_URL) return () => undefined;
  const subscriber = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const channel = channelName(runId);
  await subscriber.subscribe(channel);
  subscriber.on("message", (_receivedChannel, payload) => {
    try {
      onEvent(JSON.parse(payload) as RunEvent);
    } catch (error) {
      console.error("[tuxevil-benchmark] invalid run event", error);
    }
  });
  subscriber.on("error", (error) => console.error("[tuxevil-benchmark] run event subscriber error", error));

  return async () => {
    await subscriber.unsubscribe(channel).catch(() => undefined);
    await subscriber.quit().catch(() => undefined);
  };
}

function getPublisher() {
  if (publisher !== undefined) return publisher;
  const url = process.env.REDIS_URL;
  if (!url) {
    publisher = null;
    return publisher;
  }
  publisher = new Redis(url, { maxRetriesPerRequest: null });
  publisher.on("error", (error) => console.error("[tuxevil-benchmark] run event publisher error", error));
  return publisher;
}

function channelName(runId: string) {
  return `${channelPrefix}${runId}:events`;
}
