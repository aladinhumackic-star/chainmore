import assert from "node:assert/strict";
import test from "node:test";
import { CONCIERGE_KEEPALIVE_MS, sseAfter } from "./concierge-sse.ts";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("answers at once and keeps a slow reply alive with comment lines", async () => {
  // Netlify needs response headers within 40 s; nginx drops a response that
  // is silent for 30 s. The keep-alive must come well inside both.
  assert.ok(CONCIERGE_KEEPALIVE_MS <= 15_000);
  let release;
  const response = sseAfter(
    () => new Promise((resolve) => { release = resolve; }),
    { type: "error", message: "snag" },
    10,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const first = await reader.read();
  text += decoder.decode(first.value);
  assert.equal(text, ": keep-alive\n\n");
  await wait(25);
  release([{ type: "delta", text: "Use the raw body." }, { type: "done" }]);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  const data = text.split("\n\n").filter((c) => c.startsWith("data: ")).map((c) => JSON.parse(c.slice(6)));
  assert.deepEqual(data, [{ type: "delta", text: "Use the raw body." }, { type: "done" }]);
  assert.ok(text.indexOf(": keep-alive") < text.indexOf("data: "));
});

test("a failing reply ends the stream with the error event", async (t) => {
  t.mock.method(console, "error", () => {});
  const response = sseAfter(async () => { throw new Error("upstream down"); }, { type: "error", message: "snag" }, 1_000);
  assert.equal(await response.text(), 'data: {"type":"error","message":"snag"}\n\n');
});

test("a fast reply carries no keep-alive at all", async () => {
  const response = sseAfter(async () => [{ type: "delta", text: "hi" }, { type: "done" }], { type: "error" }, 1_000);
  assert.equal(await response.text(), 'data: {"type":"delta","text":"hi"}\n\ndata: {"type":"done"}\n\n');
});
