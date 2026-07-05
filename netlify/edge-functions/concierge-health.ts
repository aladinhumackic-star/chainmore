// ChainMore Concierge — health probe.
//
// Path: /api/concierge/health   (GET)
//
// Returns 200 + {ok, version, env, sessionToken} when the Edge Function is
// deployed, upstream access is wired, and request admission is configured.
//
// Used by:
//   - Operator smoke-test after deploy: `curl https://chainmore.io/api/concierge/health`
//   - CI route-check (future): asserts the function is reachable
//
// This endpoint does not call the paid upstream path. It only issues a short
// browser-session token used by /api/concierge.

import type { Context } from "https://edge.netlify.com";
import { createConciergeSessionToken } from "../lib/concierge-abuse.ts";

const VERSION = 2;

function clientBinding(req: Request, ctx: Context) {
  return {
    ip: ctx.ip || req.headers.get("x-nf-client-connection-ip") || "unknown",
    userAgent: req.headers.get("user-agent") || "unknown",
  };
}

export default async (req: Request, ctx: Context) => {
  const hasApiKey        = !!Deno.env.get("OPENAI_API_KEY");
  const abuseSecret      = Deno.env.get("CONCIERGE_ABUSE_SECRET") || "";
  const hasVectorStoreId = !!Deno.env.get("OPENAI_VECTOR_STORE_ID");
  const hasAbuseSecret   = !!abuseSecret;
  const ok               = hasApiKey && hasAbuseSecret;
  const sessionToken     = ok ? await createConciergeSessionToken(abuseSecret, clientBinding(req, ctx)) : null;
  // Chat now uses inline knowledge — OPENAI_API_KEY is the only hard
  // requirement. The vector store id is reported for diagnostics in
  // case file_search is re-enabled in the future.
  return new Response(
    JSON.stringify({
      ok,
      version: VERSION,
      env: { hasApiKey, hasAbuseSecret, hasVectorStoreId },
      sessionToken,
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
