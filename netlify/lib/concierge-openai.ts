// OpenAI Responses payload for the public ChainMore Concierge.
//
// Kept in a small module so CI can enforce the migration contract without
// calling OpenAI: GPT-6.1 Sol, no temperature override, low reasoning, concise
// visible output, and enough total output budget for hidden reasoning tokens.
// The model's documentation (2026-10-07) lists reasoning.effort low but does
// not mention text.verbosity; if the API rejects it, the edge function asks
// once more without it (withoutTextVerbosity).

export const CONCIERGE_MODEL = "gpt-6.1-sol";
export const CONCIERGE_MAX_OUTPUT_TOKENS = 1_000;
export const CONCIERGE_REASONING_EFFORT = "low";
export const CONCIERGE_TEXT_VERBOSITY = "low";

export function buildConciergeResponsesPayload(input: unknown) {
  return {
    model: CONCIERGE_MODEL,
    input,
    stream: false,
    reasoning: { effort: CONCIERGE_REASONING_EFFORT },
    text: { verbosity: CONCIERGE_TEXT_VERBOSITY },
    max_output_tokens: CONCIERGE_MAX_OUTPUT_TOKENS,
  };
}

export function withoutTextVerbosity<T extends { text?: unknown }>(payload: T): Omit<T, "text"> {
  const { text: _text, ...rest } = payload;
  return rest;
}

export function rejectsTextVerbosity(status: number, body: string): boolean {
  return status === 400 && /verbosity/i.test(body);
}
