// OpenAI Responses payload for the public ChainMore Concierge.
//
// Kept in a small module so CI can enforce the migration contract without
// calling OpenAI: GPT-6.1 Sol, no temperature override, low reasoning, concise
// visible output, and enough total output budget for hidden reasoning tokens.
// The model's documentation (2026-10-07) lists reasoning.effort low but does
// not mention text.verbosity; if the API rejects it, the edge function asks
// once more without it (withoutTextVerbosity).
//
// An integration turn of a signed-in merchant (concierge-integration.ts) gets
// medium reasoning, normal verbosity and room for complete code: debugging a
// pasted handler needs both thought and length. The cap is a ceiling; short
// answers cost what they use. Every other turn keeps the short sales budget.
// Model facts (developers.openai.com, 2026-10-07): reasoning low to max,
// default medium; up to 128,000 output tokens.

export const CONCIERGE_MODEL = "gpt-6.1-sol";
export const CONCIERGE_MAX_OUTPUT_TOKENS = 1_000;
export const CONCIERGE_INTEGRATION_MAX_OUTPUT_TOKENS = 8_000;
export const CONCIERGE_REASONING_EFFORT = "low";
export const CONCIERGE_INTEGRATION_REASONING_EFFORT = "medium";
export const CONCIERGE_TEXT_VERBOSITY = "low";
export const CONCIERGE_INTEGRATION_TEXT_VERBOSITY = "medium";

export function buildConciergeResponsesPayload(input: unknown, opts: { integration?: boolean } = {}) {
  const integration = opts.integration === true;
  return {
    model: CONCIERGE_MODEL,
    input,
    stream: false,
    reasoning: { effort: integration ? CONCIERGE_INTEGRATION_REASONING_EFFORT : CONCIERGE_REASONING_EFFORT },
    text: { verbosity: integration ? CONCIERGE_INTEGRATION_TEXT_VERBOSITY : CONCIERGE_TEXT_VERBOSITY },
    max_output_tokens: integration ? CONCIERGE_INTEGRATION_MAX_OUTPUT_TOKENS : CONCIERGE_MAX_OUTPUT_TOKENS,
  };
}

// True when the provider stopped because the output budget ran out.
export function cutOffByBudget(data: { status?: unknown; incomplete_details?: { reason?: unknown } | null }): boolean {
  return data?.status === "incomplete" && data?.incomplete_details?.reason === "max_output_tokens";
}

export function cutOffNote(latestUserText: string): string {
  const german = /[äöüß]|\b(?:und|ich|wie|wir|ihr|der|die|das|nicht|ist|mit|bitte|kann|muss)\b/i.test(latestUserText);
  return german
    ? "Die Antwort wurde hier abgeschnitten. Schreib „weiter“, dann mache ich an dieser Stelle weiter."
    : "The answer was cut off here. Reply \"continue\" and I will pick up where it stopped.";
}

export function withoutTextVerbosity<T extends { text?: unknown }>(payload: T): Omit<T, "text"> {
  const { text: _text, ...rest } = payload;
  return rest;
}

export function rejectsTextVerbosity(status: number, body: string): boolean {
  return status === 400 && /verbosity/i.test(body);
}

// A provider answer that says "try later" (overloaded, rate limited, a server
// error) is a temporary outage, not a broken question. The Concierge then
// says so and points to the integration guide and support instead of a
// generic snag. Nothing is retried: a second paid call is not made.
export function transientUpstreamStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// Only the provider's error type and code reach the function log: bounded,
// from a fixed alphabet. Never the error message, the prompt or the key.
const UPSTREAM_ERROR_FIELD = /^[a-z0-9_.-]{1,64}$/i;

export function upstreamErrorClass(body: string): string {
  let error: { type?: unknown; code?: unknown } | undefined;
  try {
    const parsed = JSON.parse(body);
    error = parsed && typeof parsed === "object" ? parsed.error : undefined;
  } catch {
    error = undefined;
  }
  const field = (value: unknown) => typeof value === "string" && UPSTREAM_ERROR_FIELD.test(value) ? value : "-";
  return `type=${field(error?.type)} code=${field(error?.code)}`;
}
