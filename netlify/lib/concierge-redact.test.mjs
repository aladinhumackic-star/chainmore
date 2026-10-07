import assert from "node:assert/strict";
import test from "node:test";
import { REDACTION_NOTE, redact } from "./concierge-redact.ts";
import { guardReply } from "./concierge-guard.ts";

test("removes keys, secrets, tokens, passwords and private keys", () => {
  const cases = [
    ["key cm_live_9f8e7d6c5b4a3f2e1d0c and whsec_AbCdEf123456789xyz", "key [removed: API key] and [removed: webhook secret]"],
    ['-H "Authorization: Bearer cm_test_abcdef1234567890"', '-H "Authorization: Bearer [removed: API key]"'],
    ["Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjE3OTEzNzQ2ODZ9.abcdefghijklmnop", "Authorization: Bearer [removed: token]"],
    ["Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==", "Authorization: Basic [removed: token]"],
    ["DATABASE_URL=postgres://shop:Sup3rS3cret!@db.internal:5432/shop", "DATABASE_URL=postgres://shop:[removed: password]@db.internal:5432/shop"],
    ['password = "Sommer2024!"', 'password = "[removed: secret]"'],
    ["CHAINMORE_WEBHOOK_SECRET=whsec_live_k3y_v4lu3_here", "CHAINMORE_WEBHOOK_SECRET=[removed: webhook secret]"],
    ["OPENAI=sk-proj-abcdefghijklmnopqrstuvwx", "OPENAI=[removed: API key]"],
    ["-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----", "[removed: private key]"],  // chainmore-secret-scan: allow (made-up test value)
  ];
  for (const [input, want] of cases) assert.equal(redact(input).text, want, input);
});

test("removes card numbers, IBANs and customer e-mails, but keeps ChainMore's own address", () => {
  assert.equal(redact("Card 4242 4242 4242 4242 failed").text, "Card [removed: card number] failed");
  assert.equal(redact("IBAN DE89 3704 0044 0532 0130 00").text, "IBAN [removed: IBAN]");
  assert.equal(redact("anna.schmidt@example.com wrote to support@chainmore.io").text, "[removed: e-mail] wrote to support@chainmore.io");
});

test("keeps what a merchant needs for debugging", () => {
  const keep = [
    "headers: { Authorization: `Bearer ${process.env.CHAINMORE_API_KEY}` }",
    "const apiKey = process.env.CHAINMORE_API_KEY;",
    "api_key = os.environ['CHAINMORE_API_KEY']",
    "password: string",
    "Authorization: Bearer <api key>",
    "timestamp 1791374292705, tx 0x" + "ab".repeat(32),
    "order CM12ABCDEFGHIJKL, event 9b2f0c3e-1d2a-4f5b-8c7d-0e1f2a3b4c5d",
    '{"usdc_atomic":"25000000","merchant_order_id":"order-1042","checkout_token":"cl_' + "a1".repeat(16) + '"}',
    "POST https://api.chainmore.io/v1/checkout/links returned 400 invalid_request",
    "eip155:42161:0x2222222222222222222222222222222222222222 and TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
  ];
  for (const input of keep) assert.deepEqual(redact(input), { text: input, removed: [] }, input);
});

test("reports what it removed and the note passes the output guard", () => {
  assert.deepEqual(redact("cm_test_abcdef1234567890 and a@b.de").removed.sort(), ["API key", "e-mail"]);
  assert.equal(guardReply(REDACTION_NOTE).ok, true);
});
