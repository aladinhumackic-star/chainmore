// ChainMore Concierge request admission.
//
// Keep this module deterministic and dependency-free: the Edge Function uses it
// before any paid upstream call, and CI can exercise the same checks without
// credentials.

export const CONCIERGE_SESSION_TTL_MS = 30 * 60 * 1000;
export const CONCIERGE_MAX_REQUEST_BYTES = 32 * 1024;
export const CONCIERGE_MAX_RATE_KEYS = 5_000;
export const CONCIERGE_SESSION_HEADER = "x-chainmore-concierge-session";

export interface ClientBinding {
  ip: string;
  userAgent: string;
}

export interface SessionPayload {
  v: 1;
  exp: number;
  nonce: string;
}

export interface SessionValidation {
  ok: boolean;
  payload?: SessionPayload;
  reason?: string;
}

export interface RateRule {
  name: string;
  windowMs: number;
  max: number;
}

export interface RateDecision {
  ok: boolean;
  retryAfterSeconds: number;
  rule?: string;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export const IP_RATE_RULES: RateRule[] = [
  { name: "burst", windowMs: 60 * 1000, max: 6 },
  { name: "hour", windowMs: 60 * 60 * 1000, max: 20 },
  { name: "day", windowMs: 24 * 60 * 60 * 1000, max: 80 },
];

export const SESSION_RATE_RULES: RateRule[] = [
  { name: "burst", windowMs: 60 * 1000, max: 5 },
  { name: "hour", windowMs: 60 * 60 * 1000, max: 16 },
];

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 1) raw += String.fromCharCode(bytes[i]);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function bindingString(binding: ClientBinding): string {
  // IP addresses can change mid-session on mobile networks. The token is a
  // request-admission friction layer, not an identity proof, so bind it to the
  // browser shape and use IP only for rate limiting.
  return binding.userAgent || "unknown";
}

async function sign(secret: string, payloadPart: string, binding: ClientBinding): Promise<string> {
  const key = await importHmacKey(secret);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${payloadPart}.${bindingString(binding)}`));
  return bytesToBase64Url(new Uint8Array(mac));
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function createConciergeSessionToken(
  secret: string,
  binding: ClientBinding,
  now = Date.now(),
): Promise<string> {
  if (!secret) throw new Error("missing concierge abuse secret");
  const payload: SessionPayload = {
    v: 1,
    exp: now + CONCIERGE_SESSION_TTL_MS,
    nonce: randomNonce(),
  };
  const payloadPart = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${payloadPart}.${await sign(secret, payloadPart, binding)}`;
}

export async function verifyConciergeSessionToken(
  token: string | null,
  secret: string,
  binding: ClientBinding,
  now = Date.now(),
): Promise<SessionValidation> {
  if (!secret) return { ok: false, reason: "missing-secret" };
  if (!token || typeof token !== "string") return { ok: false, reason: "missing-token" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed-token" };

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
  } catch {
    return { ok: false, reason: "malformed-payload" };
  }
  if (payload?.v !== 1 || typeof payload.exp !== "number" || typeof payload.nonce !== "string") {
    return { ok: false, reason: "invalid-payload" };
  }
  if (payload.exp <= now) return { ok: false, reason: "expired" };

  const expected = base64UrlToBytes(await sign(secret, parts[0], binding));
  let actual: Uint8Array;
  try {
    actual = base64UrlToBytes(parts[1]);
  } catch {
    return { ok: false, reason: "malformed-signature" };
  }
  if (!timingSafeEqual(expected, actual)) return { ok: false, reason: "bad-signature" };
  return { ok: true, payload };
}

export function consumeRateLimit(
  store: Map<string, Map<string, RateBucket>>,
  key: string,
  rules: RateRule[],
  now = Date.now(),
): RateDecision {
  let buckets = store.get(key);
  if (!buckets) {
    if (store.size >= CONCIERGE_MAX_RATE_KEYS) pruneRateLimitStore(store, now);
    if (store.size >= CONCIERGE_MAX_RATE_KEYS) {
      return { ok: false, retryAfterSeconds: 60, rule: "capacity" };
    }
    buckets = new Map();
    store.set(key, buckets);
  }

  for (const rule of rules) {
    const bucket = buckets.get(rule.name);
    if (bucket && bucket.resetAt > now && bucket.count >= rule.max) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        rule: rule.name,
      };
    }
  }

  for (const rule of rules) {
    const bucket = buckets.get(rule.name);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(rule.name, { count: 1, resetAt: now + rule.windowMs });
    } else {
      bucket.count += 1;
    }
  }

  return { ok: true, retryAfterSeconds: 0 };
}

export function pruneRateLimitStore(store: Map<string, Map<string, RateBucket>>, now = Date.now()): void {
  for (const [key, buckets] of store) {
    for (const [name, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(name);
    }
    if (buckets.size === 0) store.delete(key);
  }
}

export function rateLimitKey(prefix: string, value: string): string {
  return `${prefix}:${value || "unknown"}`;
}
