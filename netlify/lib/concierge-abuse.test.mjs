import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCIERGE_MAX_RATE_KEYS,
  CONCIERGE_SESSION_TTL_MS,
  createConciergeSessionToken,
  verifyConciergeSessionToken,
  consumeRateLimit,
} from "./concierge-abuse.ts";

const binding = { ip: "203.0.113.10", userAgent: "UnitTest Browser" };

test("session token survives IP changes but stays tied to browser shape and expiry", async () => {
  const now = 1_700_000_000_000;
  const token = await createConciergeSessionToken("secret-for-tests", binding, now);

  assert.equal((await verifyConciergeSessionToken(token, "secret-for-tests", binding, now + 1_000)).ok, true);

  const changedIp = { ip: "203.0.113.11", userAgent: "UnitTest Browser" };
  assert.equal((await verifyConciergeSessionToken(token, "secret-for-tests", changedIp, now + 1_000)).ok, true);

  const changedUserAgent = { ip: "203.0.113.10", userAgent: "Different Browser" };
  assert.deepEqual(
    await verifyConciergeSessionToken(token, "secret-for-tests", changedUserAgent, now + 1_000),
    { ok: false, reason: "bad-signature" },
  );

  assert.deepEqual(
    await verifyConciergeSessionToken(token, "secret-for-tests", binding, now + CONCIERGE_SESSION_TTL_MS + 1),
    { ok: false, reason: "expired" },
  );
});

test("session token rejects missing, malformed, and wrong-secret values", async () => {
  const now = 1_700_000_000_000;
  const token = await createConciergeSessionToken("secret-for-tests", binding, now);

  assert.deepEqual(await verifyConciergeSessionToken(null, "secret-for-tests", binding, now), {
    ok: false,
    reason: "missing-token",
  });
  assert.deepEqual(await verifyConciergeSessionToken("not-a-token", "secret-for-tests", binding, now), {
    ok: false,
    reason: "malformed-token",
  });
  assert.deepEqual(await verifyConciergeSessionToken(token, "other-secret", binding, now), {
    ok: false,
    reason: "bad-signature",
  });
});

test("rate limiter blocks bursts and resets after the window", () => {
  const store = new Map();
  const rules = [{ name: "burst", windowMs: 1_000, max: 2 }];
  const now = 10_000;

  assert.equal(consumeRateLimit(store, "ip:test", rules, now).ok, true);
  assert.equal(consumeRateLimit(store, "ip:test", rules, now + 100).ok, true);

  const blocked = consumeRateLimit(store, "ip:test", rules, now + 200);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.rule, "burst");
  assert.equal(blocked.retryAfterSeconds, 1);

  assert.equal(consumeRateLimit(store, "ip:test", rules, now + 1_001).ok, true);
});

test("rate limiter evaluates each key independently", () => {
  const store = new Map();
  const rules = [{ name: "hour", windowMs: 60_000, max: 1 }];

  assert.equal(consumeRateLimit(store, "ip:a", rules, 1_000).ok, true);
  assert.equal(consumeRateLimit(store, "ip:a", rules, 1_001).ok, false);
  assert.equal(consumeRateLimit(store, "ip:b", rules, 1_002).ok, true);
});

test("rate limiter prunes expired keys before applying the hard capacity guard", () => {
  const store = new Map();
  const rules = [{ name: "day", windowMs: 60_000, max: 1 }];
  for (let i = 0; i < CONCIERGE_MAX_RATE_KEYS; i += 1) {
    store.set(`expired:${i}`, new Map([["day", { count: 1, resetAt: 1_000 }]]));
  }

  assert.equal(consumeRateLimit(store, "ip:new", rules, 2_000).ok, true);
  assert.equal(store.has("ip:new"), true);
  assert.ok(store.size < CONCIERGE_MAX_RATE_KEYS);
});

test("rate limiter fails closed when the hard key capacity is full of active buckets", () => {
  const store = new Map();
  const rules = [{ name: "day", windowMs: 60_000, max: 1 }];
  for (let i = 0; i < CONCIERGE_MAX_RATE_KEYS; i += 1) {
    store.set(`active:${i}`, new Map([["day", { count: 1, resetAt: 90_000 }]]));
  }

  const blocked = consumeRateLimit(store, "ip:new", rules, 2_000);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.rule, "capacity");
  assert.equal(blocked.retryAfterSeconds, 60);
});
