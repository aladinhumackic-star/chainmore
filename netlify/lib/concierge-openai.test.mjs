import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCIERGE_MAX_OUTPUT_TOKENS,
  CONCIERGE_MODEL,
  buildConciergeResponsesPayload,
} from "./concierge-openai.ts";

test("builds GPT-5.5 Responses payload for the public Concierge", () => {
  const input = [
    {
      role: "user",
      content: [{ type: "input_text", text: "What do I get from ChainMore?" }],
    },
  ];

  const payload = buildConciergeResponsesPayload(input);

  assert.equal(payload.model, "gpt-5.5");
  assert.equal(payload.model, CONCIERGE_MODEL);
  assert.equal(payload.input, input);
  assert.equal(payload.stream, false);
  assert.deepEqual(payload.reasoning, { effort: "low" });
  assert.deepEqual(payload.text, { verbosity: "low" });
  assert.equal(payload.max_output_tokens, CONCIERGE_MAX_OUTPUT_TOKENS);
  assert.ok(payload.max_output_tokens >= 800);
});

test("does not send legacy sampling parameters rejected by GPT-5-family models", () => {
  const payload = buildConciergeResponsesPayload([]);

  assert.equal(Object.hasOwn(payload, "temperature"), false);
  assert.equal(Object.hasOwn(payload, "top_p"), false);
  assert.equal(Object.hasOwn(payload, "presence_penalty"), false);
  assert.equal(Object.hasOwn(payload, "frequency_penalty"), false);
});
