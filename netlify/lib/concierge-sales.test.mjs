import assert from "node:assert/strict";
import test from "node:test";
import { guardReply } from "./concierge-guard.ts";
import {
  CHARGEBACK_NUANCE_REPLY_DE,
  CHARGEBACK_NUANCE_REPLY,
  deterministicConciergeReply,
} from "./concierge-sales.ts";

test("answers chargeback questions with the rail-scoped nuance", () => {
  const reply = deterministicConciergeReply([
    { role: "user", content: "Is it true that ChainMore means no chargebacks?" },
  ]);

  assert.equal(reply, CHARGEBACK_NUANCE_REPLY);
  assert.match(reply, /stablecoin/i);
  assert.match(reply, /on-chain/i);
  assert.match(reply, /card/i);
  assert.match(reply, /dispute/i);
  assert.equal(/—|–/.test(reply), false);
  assert.equal(guardReply(reply).ok, true);
});

test("answers German reversal wording with the same safe nuance", () => {
  const reply = deterministicConciergeReply([
    { role: "user", content: "Heißt das keine Rückbuchungen für Händler?" },
  ]);

  assert.equal(reply, CHARGEBACK_NUANCE_REPLY_DE);
  assert.match(reply, /Stablecoin-Zahlungen/);
  assert.match(reply, /Rückbuchungsmechanismus/);
  assert.match(reply, /Kartenzahlungen/);
  assert.match(reply, /Streitfallregeln/);
  assert.equal(/—|–/.test(reply), false);
  assert.equal(guardReply(reply).ok, true);
});

test("does not intercept unrelated buying questions", () => {
  const reply = deterministicConciergeReply([
    { role: "user", content: "What do I get compared to Stripe?" },
  ]);

  assert.equal(reply, null);
});
