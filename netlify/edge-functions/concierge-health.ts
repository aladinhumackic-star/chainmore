// ChainMore Concierge — health probe.
//
// Path: /api/concierge/health   (GET)
//
// Returns 200 + {ok, version, env: {hasApiKey, hasVectorStoreId}} when
// the Edge Function is deployed and the OpenAI secrets are wired.
//
// Used by:
//   - Operator smoke-test after deploy: `curl https://chainmore.io/api/concierge/health`
//   - CI route-check (future): asserts the function is reachable
//
// This endpoint does NOT call OpenAI — it has zero token cost and
// zero rate-limit so it can be hit freely without consuming budget.

import type { Context } from "https://edge.netlify.com";

const VERSION = 2;

export default async (_req: Request, _ctx: Context) => {
  const hasApiKey        = !!Deno.env.get("OPENAI_API_KEY");
  const hasVectorStoreId = !!Deno.env.get("OPENAI_VECTOR_STORE_ID");
  // Chat now uses inline knowledge — OPENAI_API_KEY is the only hard
  // requirement. The vector store id is reported for diagnostics in
  // case file_search is re-enabled in the future.
  return new Response(
    JSON.stringify({
      ok: hasApiKey,
      version: VERSION,
      env: { hasApiKey, hasVectorStoreId },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
};
