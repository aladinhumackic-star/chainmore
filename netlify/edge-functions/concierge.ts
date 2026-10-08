// ChainMore Concierge, chat endpoint (v2).
//
// v2 changes vs. the parked v1:
//   1. DETERMINISTIC GUARD: every reply passes lib/concierge-guard.ts
//      before it reaches the visitor. Prompt rules are advice; the
//      guard is law. A blocked reply is replaced entirely by a safe
//      fallback (no partial redaction).
//   2. BUFFERED REPLY: the upstream call is non-streaming. We cannot
//      guard text we have not fully seen, so we trade progressive
//      rendering for enforceable honesty. Answers are FAQ-short; the
//      widget protocol (SSE delta/done/error) is unchanged.
//   3. PUBLIC VOICE: the shared prompt explains ChainMore's position and
//      complete comparison criteria, with availability and claim boundaries.
//
// Privacy: no user content is logged or stored by this function. The
// only persistence is an in-memory request-admission bucket.

import type { Context } from "https://edge.netlify.com";
import {
  CONCIERGE_MAX_REQUEST_BYTES,
  CONCIERGE_SESSION_HEADER,
  IP_RATE_RULES,
  MEMBER_RATE_RULES,
  SESSION_RATE_RULES,
  consumeRateLimit,
  rateLimitKey,
  verifyConciergeSessionToken,
} from "../lib/concierge-abuse.ts";
import { guardReply } from "../lib/concierge-guard.ts";
import { sseAfter } from "../lib/concierge-sse.ts";
import { MEMBER_ADMISSION_HEADER, redeemMemberAdmission, verifyMemberToken } from "../lib/concierge-member.ts";
import { MEMBER_PROMPT, PUBLIC_INTEGRATION_NOTE, SYSTEM_PROMPT, memberContextNote, memberFallbackText } from "../lib/concierge-prompt.ts";
import { REDACTION_NOTE, redact } from "../lib/concierge-redact.ts";
import { INTEGRATION_TURN_NOTE, codeOutsideScope, isMemberIntegrationTurn, outOfScopeReply } from "../lib/concierge-integration.ts";
import { buildConciergeResponsesPayload, cutOffByBudget, cutOffNote, rejectsTextVerbosity, withoutTextVerbosity } from "../lib/concierge-openai.ts";
import { deterministicConciergeReply } from "../lib/concierge-sales.ts";

const MAX_MESSAGES = 20;
const MAX_USER_CHARS = 2_000;
const MAX_HISTORY_CHARS = 20_000;
// Signed-in merchants paste whole handlers and logs while debugging.
const MEMBER_MAX_USER_CHARS = 20_000;
const MEMBER_MAX_HISTORY_CHARS = 60_000;
const MEMBER_MAX_REQUEST_BYTES = 160 * 1024;
// A long integration answer with medium reasoning can take a few minutes.
const UPSTREAM_TIMEOUT_MS = 180_000;
const ALLOWED_HOSTS = ["chainmore.io", "www.chainmore.io", "localhost:8888", "localhost"];

type ChatMessage = { role: "user" | "assistant"; content: string };

const buckets = new Map<string, Map<string, { count: number; resetAt: number }>>();

function sse(events: Array<Record<string, unknown>>, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      ...extraHeaders,
    },
  });
}

function clientBinding(req: Request, ctx: Context) {
  return {
    ip: ctx.ip || req.headers.get("x-nf-client-connection-ip") || "unknown",
    userAgent: req.headers.get("user-agent") || "unknown",
  };
}

function allowedUrlHost(value: string | null): boolean {
  if (!value) return false;
  try {
    return ALLOWED_HOSTS.includes(new URL(value).host);
  } catch {
    return false;
  }
}

function hasAllowedBrowserSource(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) return allowedUrlHost(origin);
  return allowedUrlHost(req.headers.get("referer"));
}

function rateLimitSSE(retryAfterSeconds: number): Response {
  return sse(
    [{ type: "error", message: "Too many messages right now. Please try again later." }],
    429,
    { "retry-after": String(retryAfterSeconds) },
  );
}

async function readJsonBody(req: Request, maxBytes = CONCIERGE_MAX_REQUEST_BYTES): Promise<{ ok: true; body: { messages?: unknown }; raw: Uint8Array<ArrayBuffer> } | { ok: false; status: number; message: string }> {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > maxBytes) {
    return { ok: false, status: 413, message: "Request too large." };
  }

  if (!req.body) return { ok: false, status: 400, message: "Bad request." };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, status: 413, message: "Request too large." };
    }
    chunks.push(value);
  }

  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(all)), raw: all };
  } catch {
    return { ok: false, status: 400, message: "Bad request." };
  }
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function sanitize(messages: unknown, maxUserChars = MAX_USER_CHARS, maxHistoryChars = MAX_HISTORY_CHARS): ChatMessage[] | null {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return null;
  }
  const out: ChatMessage[] = [];
  let total = 0;
  for (const m of messages) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    if (!role || typeof m?.content !== "string") return null;
    const content = m.content.replace(CONTROL_CHARS, "").trim().slice(0, maxUserChars);
    if (!content) continue;
    total += content.length;
    out.push({ role, content });
  }
  if (out.length === 0) return null;
  if (out[out.length - 1].role !== "user") return null;
  // A long conversation keeps its newest turns instead of failing.
  while (total > maxHistoryChars && out.length > 1) {
    total -= out.shift()!.content.length;
  }
  if (total > maxHistoryChars) return null;
  return out;
}

export default async (req: Request, ctx: Context) => {
  if (req.method !== "POST") {
    return sse([{ type: "error", message: "Method not allowed." }], 405);
  }

  // A request without a member token must come from the public site.
  if (!req.headers.has("authorization") && !hasAllowedBrowserSource(req)) {
    return sse([{ type: "error", message: "Request not allowed." }], 403);
  }

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return sse([{ type: "error", message: "Unsupported content type." }], 415);
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const abuseSecret = Deno.env.get("CONCIERGE_ABUSE_SECRET") || "";
  if (!abuseSecret) {
    console.error("[concierge] Missing CONCIERGE_ABUSE_SECRET");
    return sse(
      [{ type: "error", message: "The Concierge is offline right now. Email support@chainmore.io instead." }],
      503,
    );
  }
  if (!apiKey) {
    console.error("[concierge] Missing OPENAI_API_KEY");
    return sse(
      [{ type: "error", message: "The Concierge is offline right now. Email support@chainmore.io instead." }],
      503,
    );
  }

  // Two ways in. The dashboard server forwards the signed-in merchant's ID
  // token together with a single-use admission for this request
  // (Integration Concierge, concierge-member.ts); the public widget on
  // chainmore.io uses the browser origin plus the short-lived anonymous
  // session token.
  let member = false;
  let memberSubject = "";
  if (req.headers.has("authorization")) {
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "")?.[1];
    const check = await verifyMemberToken(bearer);
    if (!check.ok) {
      console.warn("[concierge] member token refused", check.reason);
      return sse([{ type: "error", message: "Your sign-in has expired. Reload the dashboard and try again." }], 401);
    }
    const memberLimit = consumeRateLimit(buckets, rateLimitKey("member", check.subject), MEMBER_RATE_RULES);
    if (!memberLimit.ok) return rateLimitSSE(memberLimit.retryAfterSeconds);
    member = true;
    memberSubject = check.subject;
  } else {
    const binding = clientBinding(req, ctx);
    const session = await verifyConciergeSessionToken(req.headers.get(CONCIERGE_SESSION_HEADER), abuseSecret, binding);
    if (!session.ok || !session.payload) {
      return sse([{ type: "error", message: "Session expired. Please refresh this page and try again." }], 403);
    }

    const ipLimit = consumeRateLimit(buckets, rateLimitKey("ip", binding.ip), IP_RATE_RULES);
    if (!ipLimit.ok) return rateLimitSSE(ipLimit.retryAfterSeconds);

    const sessionLimit = consumeRateLimit(buckets, rateLimitKey("session", session.payload.nonce), SESSION_RATE_RULES);
    if (!sessionLimit.ok) return rateLimitSSE(sessionLimit.retryAfterSeconds);
  }

  const body = await readJsonBody(req, member ? MEMBER_MAX_REQUEST_BYTES : CONCIERGE_MAX_REQUEST_BYTES);
  if (!body.ok) {
    return sse([{ type: "error", message: body.message }], body.status);
  }
  // The dashboard admits this exact request once, after its merchant and
  // budget checks; the member context comes back with the admission.
  let memberContext: { role: unknown; mode: unknown; ui_locale: unknown } | null = null;
  if (member) {
    const admitted = await redeemMemberAdmission(req.headers.get(MEMBER_ADMISSION_HEADER), memberSubject, body.raw);
    if (!admitted.ok) {
      console.warn("[concierge] member request not admitted", admitted.reason);
      return sse([{ type: "error", message: "This question was not admitted. Reload the dashboard and try again." }], 403);
    }
    memberContext = { role: admitted.role, mode: admitted.mode, ui_locale: admitted.uiLocale };
  }
  const messages = member
    ? sanitize(body.body.messages, MEMBER_MAX_USER_CHARS, MEMBER_MAX_HISTORY_CHARS)
    : sanitize(body.body.messages);
  if (!messages) return sse([{ type: "error", message: "Bad request." }], 400);

  const deterministicReply = deterministicConciergeReply(messages);
  if (deterministicReply) {
    const guarded = guardReply(deterministicReply);
    if (!guarded.ok) console.warn("[concierge] guard blocked deterministic reply", guarded.hits);
    return sse([{ type: "delta", text: guarded.text }, { type: "done" }]);
  }

  // Secrets and personal data never reach the model provider
  // (concierge-redact.ts). The scope check below still reads the cleaned text.
  const removed = new Set<string>();
  for (const m of messages) {
    const cleaned = redact(m.content);
    m.content = cleaned.text;
    cleaned.removed.forEach((label) => removed.add(label));
  }
  if (removed.size) console.warn("[concierge] removed from messages", [...removed]);

  // Only signed-in merchants get the integration knowledge and the larger
  // budget, and only for turns about connecting to ChainMore.
  const integration = member && isMemberIntegrationTurn(messages);
  const systemContent = [{ type: "input_text", text: SYSTEM_PROMPT }];
  systemContent.push({ type: "input_text", text: member ? MEMBER_PROMPT : PUBLIC_INTEGRATION_NOTE });
  const context = memberContext ? memberContextNote(memberContext) : null;
  if (context) systemContent.push({ type: "input_text", text: context });
  if (removed.size) systemContent.push({ type: "input_text", text: REDACTION_NOTE });
  if (integration) systemContent.push({ type: "input_text", text: INTEGRATION_TURN_NOTE });
  const input = [
    { role: "system", content: systemContent },
    ...messages.map((m) => ({
      role: m.role,
      content: [{ type: m.role === "user" ? "input_text" : "output_text", text: m.content }],
    })),
  ];

  // The response starts now and keeps the connection alive; the reply
  // follows once the guard has seen all of it (concierge-sse.ts).
  const snag = { type: "error", message: "The Concierge hit a snag. Please try again." };
  return sseAfter(async () => {
    const call = (payload: unknown) => fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const payload = buildConciergeResponsesPayload(input, { integration });
    let upstream = await call(payload);
    if (!upstream.ok && upstream.status === 400) {
      const detail = await upstream.text();
      if (rejectsTextVerbosity(upstream.status, detail)) {
        console.warn("[concierge] model rejected text.verbosity; asking once without it");
        upstream = await call(withoutTextVerbosity(payload));
      }
    }
    if (!upstream.ok) {
      console.error("[concierge] upstream status", upstream.status);
      return [snag];
    }
    const data = await upstream.json();
    let reply = typeof data.output_text === "string" && data.output_text
      ? data.output_text
      : (data.output ?? [])
        .flatMap((o: { content?: Array<{ type?: string; text?: string }> }) => o?.content ?? [])
        .filter((c: { type?: string }) => c?.type === "output_text")
        .map((c: { text?: string }) => c?.text ?? "")
        .join("");
    if (reply.trim() && cutOffByBudget(data)) {
      console.warn("[concierge] reply cut off by output budget", { integration });
      reply = `${reply.trimEnd()}\n\n${cutOffNote(messages[messages.length - 1].content)}`;
    }

    // Scope is law too: no unrelated code leaves this function.
    if (codeOutsideScope(reply)) {
      console.warn("[concierge] reply blocked: code outside ChainMore scope", { member, integration });
      reply = outOfScopeReply(messages[messages.length - 1].content);
    }

    // The law, not the advice: deterministic guard on the full reply.
    const guarded = guardReply(reply, { allowCodePlaceholders: member });
    if (!guarded.ok) console.warn("[concierge] guard blocked reply", guarded.hits);
    const text = !guarded.ok && member ? memberFallbackText(messages[messages.length - 1].content) : guarded.text;
    return [{ type: "delta", text }, { type: "done" }];
  }, snag);
};
