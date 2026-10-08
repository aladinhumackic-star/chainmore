// ChainMore Concierge: proof that the visitor is a signed-in merchant.
//
// Hands-on integration help is for merchants with an account. The merchant
// dashboard server forwards the Keycloak ID token of the signed-in user; this
// module checks it against the realm's public keys. An ID token carries no
// API power: the gateway accepts only access tokens issued to its own
// audience (internal/merchantauth/jwt.go), so the website never holds a
// credential for the merchant's account.
//
// The token is used for this check only. It is never logged or stored.

export const MEMBER_ISSUER = "https://auth.chainmore.io/realms/merchants";
export const MEMBER_CLIENT_ID = "chainmore-merchant-ui";
export const MEMBER_JWKS_URL = `${MEMBER_ISSUER}/protocol/openid-connect/certs`;

const CLOCK_SKEW_SECONDS = 30;
const KEYS_TTL_MS = 10 * 60 * 1000;
const KEYS_MIN_REFETCH_MS = 60 * 1000;
const MAX_TOKEN_CHARS = 8 * 1024;

type Jwk = { kid?: unknown; kty?: unknown; alg?: unknown; use?: unknown; n?: unknown; e?: unknown };

export type MemberCheck = { ok: true; subject: string } | { ok: false; reason: string };

type KeyCache = { keys: Map<string, CryptoKey>; fetchedAt: number; attemptedAt: number };
let cache: KeyCache = { keys: new Map(), fetchedAt: 0, attemptedAt: -Infinity };

export function resetMemberKeyCache(): void {
  cache = { keys: new Map(), fetchedAt: 0, attemptedAt: -Infinity };
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("not base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> {
  const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
  return parsed as Record<string, unknown>;
}

async function loadKeys(fetchImpl: typeof fetch, now: number): Promise<void> {
  const res = await fetchImpl(MEMBER_JWKS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`jwks status ${res.status}`);
  const body = await res.json() as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
    if (jwk.kty !== "RSA" || typeof jwk.kid !== "string" || typeof jwk.n !== "string" || typeof jwk.e !== "string") continue;
    if (jwk.use !== undefined && jwk.use !== "sig") continue;
    if (jwk.alg !== undefined && jwk.alg !== "RS256") continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    keys.set(jwk.kid, key);
  }
  cache = { keys, fetchedAt: now, attemptedAt: now };
}

async function keyFor(kid: string, fetchImpl: typeof fetch, now: number): Promise<CryptoKey | undefined> {
  const stale = now - cache.fetchedAt > KEYS_TTL_MS;
  const unknownKid = !cache.keys.has(kid);
  // At most one fetch per minute, whatever visitors send.
  if ((stale || unknownKid) && now - cache.attemptedAt > KEYS_MIN_REFETCH_MS) {
    cache.attemptedAt = now;
    try {
      await loadKeys(fetchImpl, now);
    } catch (err) {
      // Keep using known keys while the realm is briefly unreachable.
      if (!cache.keys.has(kid)) throw err;
    }
  }
  return cache.keys.get(kid);
}

export async function verifyMemberToken(
  token: string | null | undefined,
  opts: { now?: number; fetchImpl?: typeof fetch } = {},
): Promise<MemberCheck> {
  const now = opts.now ?? Date.now();
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!token || token.length > MAX_TOKEN_CHARS) return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
    signature = base64UrlToBytes(parts[2]);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "algorithm" };
  if (claims.iss !== MEMBER_ISSUER) return { ok: false, reason: "issuer" };
  const aud = claims.aud;
  const audOk = aud === MEMBER_CLIENT_ID || (Array.isArray(aud) && aud.includes(MEMBER_CLIENT_ID));
  if (!audOk) return { ok: false, reason: "audience" };
  if (claims.azp !== undefined && claims.azp !== MEMBER_CLIENT_ID) return { ok: false, reason: "audience" };
  if (claims.typ !== "ID") return { ok: false, reason: "type" };
  const nowSeconds = Math.floor(now / 1000);
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) return { ok: false, reason: "expired" };
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) return { ok: false, reason: "not-yet-valid" };
  if (typeof claims.sub !== "string" || !claims.sub) return { ok: false, reason: "subject" };

  let key: CryptoKey | undefined;
  try {
    key = await keyFor(header.kid, fetchImpl, now);
  } catch {
    return { ok: false, reason: "keys-unavailable" };
  }
  if (!key) return { ok: false, reason: "unknown-key" };

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
  if (!valid) return { ok: false, reason: "signature" };
  return { ok: true, subject: claims.sub };
}

// A valid ID token alone admits nothing. The dashboard server
// (frontend/merchant-dashboard/src/app/api/concierge/route.ts) checks that the
// user belongs to an active merchant account and takes one question from the
// account's and the overall daily budget. For exactly that request it then
// issues a single-use admission: a random value bound to the user and to the
// SHA-256 of the body it forwards, valid for a minute. This edge function
// redeems the admission at the dashboard before any model call; the dashboard
// forgets it on the first redeem attempt, whatever its outcome. The member's
// role, mode and display language come back with it, never from the request.
export const MEMBER_ADMISSION_HEADER = "x-chainmore-concierge-admission";
export const MEMBER_ADMISSION_URL = "https://app.chainmore.io/api/concierge-admission";
const ADMISSION_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const ADMISSION_TIMEOUT_MS = 5_000;

export type MemberAdmission =
  | { ok: true; role: unknown; mode: unknown; uiLocale: unknown }
  | { ok: false; reason: string };

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function redeemMemberAdmission(
  admission: string | null | undefined,
  subject: string,
  rawBody: Uint8Array<ArrayBuffer>,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<MemberAdmission> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!admission || !ADMISSION_SHAPE.test(admission)) return { ok: false, reason: "admission-missing" };
  const bodySha256 = hex(await crypto.subtle.digest("SHA-256", rawBody));
  let response: Response;
  try {
    response = await fetchImpl(MEMBER_ADMISSION_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ admission, subject, body_sha256: bodySha256 }),
      redirect: "error",
      signal: AbortSignal.timeout(ADMISSION_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "admission-unreachable" };
  }
  if (response.status !== 200) return { ok: false, reason: `admission-${response.status}` };
  let data: { admitted?: unknown; role?: unknown; mode?: unknown; ui_locale?: unknown };
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: "admission-malformed" };
  }
  if (!data || data.admitted !== true) return { ok: false, reason: "admission-refused" };
  return { ok: true, role: data.role, mode: data.mode, uiLocale: data.ui_locale };
}
