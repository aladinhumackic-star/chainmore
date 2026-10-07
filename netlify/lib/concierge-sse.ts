// Server-sent events for the Concierge, with the reply guarded as a whole.
//
// Netlify cancels an edge function that has not returned its response
// headers after 40 seconds, and nginx in front of the dashboard drops a
// proxied response that stays silent for 30 seconds. A long integration
// answer takes longer than that. So the response starts at once, a comment
// line keeps the connection alive every few seconds, and the reply follows
// only after the output guard has seen all of it. Comment lines carry no
// data; both Concierge clients skip them.

export const CONCIERGE_KEEPALIVE_MS = 10_000;

export type ConciergeEvent = Record<string, unknown>;

// no-transform keeps proxies and compression from holding back the small
// keep-alive lines; X-Accel-Buffering does the same for nginx.
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-accel-buffering": "no",
  "x-robots-tag": "noindex",
};

export function sseAfter(
  work: () => Promise<ConciergeEvent[]>,
  failure: ConciergeEvent,
  keepaliveMs = CONCIERGE_KEEPALIVE_MS,
): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The client went away; nothing left to tell it.
        }
      };
      timer = setInterval(() => send(": keep-alive\n\n"), keepaliveMs);
      let events: ConciergeEvent[];
      try {
        events = await work();
      } catch (err) {
        console.error("[concierge] reply failed", err);
        events = [failure];
      } finally {
        clearInterval(timer);
      }
      for (const event of events) send(`data: ${JSON.stringify(event)}\n\n`);
      try {
        controller.close();
      } catch {
        // Already closed by a cancelled client.
      }
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(body, { status: 200, headers: SSE_HEADERS });
}
