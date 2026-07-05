// OpenAI Responses payload for the public ChainMore Concierge.
//
// Kept in a small module so CI can enforce the migration contract without
// calling OpenAI: GPT-5.5, no temperature override, low reasoning, concise
// visible output, and enough total output budget for hidden reasoning tokens.

export const CONCIERGE_MODEL = "gpt-5.5";
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
