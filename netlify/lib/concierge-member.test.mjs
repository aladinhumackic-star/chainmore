import assert from "node:assert/strict";
import test from "node:test";
import {
  MEMBER_CLIENT_ID,
  MEMBER_ISSUER,
  MEMBER_JWKS_URL,
  resetMemberKeyCache,
  verifyMemberToken,
} from "./concierge-member.ts";

// Synthetic realm keys: a fresh RSA pair per run, published the way
// Keycloak publishes /protocol/openid-connect/certs.
const keyPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const otherPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function sign(claims, { kid = "k1", alg = "RS256", key = keyPair.privateKey } = {}) {
  const header = b64url(JSON.stringify({ alg, kid, typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

function idClaims(overrides = {}) {
  const now = Math.floor(NOW / 1000);
  return {
    iss: MEMBER_ISSUER,
    aud: MEMBER_CLIENT_ID,
    azp: MEMBER_CLIENT_ID,
    typ: "ID",
    sub: "user-123",
    iat: now - 60,
    exp: now + 3600,
    ...overrides,
  };
}

function jwksFetch(calls, keys = [{ ...publicJwk, kid: "k1", use: "sig", alg: "RS256" }]) {
  return async (url) => {
    calls.push(url);
    assert.equal(url, MEMBER_JWKS_URL);
    return Response.json({ keys });
  };
}

test("accepts the dashboard's ID token signed by the realm", async () => {
  resetMemberKeyCache();
  const calls = [];
  const result = await verifyMemberToken(await sign(idClaims()), { now: NOW, fetchImpl: jwksFetch(calls) });
  assert.deepEqual(result, { ok: true, subject: "user-123" });
  assert.equal(calls.length, 1);
  // Keys are cached: the next check does not fetch again.
  await verifyMemberToken(await sign(idClaims()), { now: NOW + 1000, fetchImpl: jwksFetch(calls) });
  assert.equal(calls.length, 1);
});

test("refuses tokens that are not a current ID token of the merchant dashboard", async () => {
  const cases = [
    ["missing", null],
    ["malformed", "abc.def"],
    ["issuer", await sign(idClaims({ iss: "https://auth.chainmore.io/realms/other" }))],
    ["audience", await sign(idClaims({ aud: "chainmore-gateway", azp: "chainmore-gateway" }))],
    ["audience", await sign(idClaims({ azp: "someone-else" }))],
    // An access token for the gateway carries typ Bearer; it must not pass.
    ["type", await sign(idClaims({ typ: "Bearer" }))],
    ["expired", await sign(idClaims({ exp: Math.floor(NOW / 1000) - 120 }))],
    ["not-yet-valid", await sign(idClaims({ iat: Math.floor(NOW / 1000) + 600 }))],
    ["subject", await sign(idClaims({ sub: "" }))],
    ["algorithm", await sign(idClaims(), { alg: "none" })],
    ["signature", await sign(idClaims(), { key: otherPair.privateKey })],
  ];
  for (const [reason, token] of cases) {
    resetMemberKeyCache();
    const result = await verifyMemberToken(token, { now: NOW, fetchImpl: jwksFetch([]) });
    assert.deepEqual(result, { ok: false, reason }, reason);
  }
});

test("accepts an audience list that contains the dashboard client", async () => {
  resetMemberKeyCache();
  const token = await sign(idClaims({ aud: [MEMBER_CLIENT_ID, "account"] }));
  assert.equal((await verifyMemberToken(token, { now: NOW, fetchImpl: jwksFetch([]) })).ok, true);
});

test("fetches the realm keys at most once a minute for an unknown key id", async () => {
  resetMemberKeyCache();
  const calls = [];
  const fetchImpl = jwksFetch(calls);
  const unknown = await sign(idClaims(), { kid: "rotated" });
  assert.deepEqual(await verifyMemberToken(unknown, { now: NOW, fetchImpl }), { ok: false, reason: "unknown-key" });
  assert.deepEqual(await verifyMemberToken(unknown, { now: NOW + 10_000, fetchImpl }), { ok: false, reason: "unknown-key" });
  assert.equal(calls.length, 1);
  await verifyMemberToken(unknown, { now: NOW + 61_000, fetchImpl });
  assert.equal(calls.length, 2);
});

test("keeps known keys when the realm is briefly unreachable", async () => {
  resetMemberKeyCache();
  const token = await sign(idClaims());
  assert.equal((await verifyMemberToken(token, { now: NOW, fetchImpl: jwksFetch([]) })).ok, true);
  const down = async () => { throw new Error("network down"); };
  // Eleven minutes later the cache is stale and the fetch fails.
  const later = NOW + 11 * 60 * 1000;
  const laterToken = await sign(idClaims({ iat: Math.floor(later / 1000) - 5, exp: Math.floor(later / 1000) + 600 }));
  assert.equal((await verifyMemberToken(laterToken, { now: later, fetchImpl: down })).ok, true);
  resetMemberKeyCache();
  assert.deepEqual(await verifyMemberToken(token, { now: NOW, fetchImpl: down }), { ok: false, reason: "keys-unavailable" });
});
