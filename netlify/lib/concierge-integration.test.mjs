import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  codeOutsideScope,
  isChainMoreIntegrationTurn,
  isMemberIntegrationTurn,
  outOfScopeReply,
} from "./concierge-integration.ts";
import { guardReply } from "./concierge-guard.ts";

const user = (content) => ({ role: "user", content });
const assistant = (content) => ({ role: "assistant", content });

test("recognises questions about connecting to ChainMore", () => {
  for (const question of [
    "How do I verify the webhook signature?",
    "Wie prüfe ich die Webhook-Signatur in PHP?",
    "POST /v1/checkout/links returns 400 idempotency_required",
    "I get 401 with my cm_test_ key",
    "Where do I put the whsec_ secret?",
    "Kann ich ChainMore in WooCommerce einbinden?",
    "What does available_payment_methods mean when it is empty?",
    "How do I go live?",
    "Our ChainMore integration throws an error in Node",
  ]) {
    assert.equal(isChainMoreIntegrationTurn([user(question)]), true, question);
  }
});

test("keeps sales questions and other providers out of integration mode", () => {
  for (const question of [
    "What does ChainMore cost?",
    "Warum nicht einfach Stripe?",
    "Write me a Stripe webhook handler in Node",
    "Write a snake game in Python",
    "Erklär mir Quantenphysik",
    "",
  ]) {
    assert.equal(isChainMoreIntegrationTurn([user(question)]), false, question);
  }
});

test("keeps a short follow-up in integration mode, but not a switch to another provider", () => {
  const history = [user("How do I check the X-ChainMore-Signature?"), assistant("Use the raw body ...")];
  assert.equal(isChainMoreIntegrationTurn([...history, user("And in Python?")]), true);
  assert.equal(isChainMoreIntegrationTurn([...history, user("Und mit Laravel?")]), true);
  assert.equal(isChainMoreIntegrationTurn([...history, user("Now do the same for PayPal")]), false);
  const old = [user("How do I check the X-ChainMore-Signature?"), assistant("..."), user("thanks"), assistant("..."),
    user("what about pricing"), assistant("..."), user("and your team"), assistant("...")];
  assert.equal(isChainMoreIntegrationTurn([...old, user("ok")]), false);
});

test("gives signed-in merchants the integration budget for technical messages and pasted logs", () => {
  for (const question of [
    "Error: Request failed with status code 401",
    "Mein Server antwortet mit 500, was tun?",
    "TypeError: Cannot read properties of undefined\n    at handler (/app/server.js:41:17)\n".repeat(8),
    "How do I verify the webhook signature?",
  ]) {
    assert.equal(isMemberIntegrationTurn([user(question)]), true, question.slice(0, 40));
  }
  for (const question of ["Who founded ChainMore?", "Danke!", "Write a Stripe webhook handler in Node", ""]) {
    assert.equal(isMemberIntegrationTurn([user(question)]), false, question);
  }
});

test("lets ChainMore code through and replaces unrelated code", () => {
  const knowledge = readFileSync(new URL("../../../../docs/operations/openai-knowledge-upload/chainmore-concierge-integration-knowledge.md", import.meta.url), "utf8");
  const blocks = [...knowledge.matchAll(/```\w+\n[\s\S]*?```/g)].map((m) => m[0]);
  assert.ok(blocks.length >= 8);
  for (const block of blocks) assert.equal(codeOutsideScope(`Here is the code:\n\n${block}`), false, block.slice(0, 60));

  const idempotentSql = "```sql\nCREATE TABLE processed_events (\n  event_id text PRIMARY KEY,\n  received_at timestamptz NOT NULL DEFAULT now()\n);\nINSERT INTO processed_events (event_id) VALUES ($1)\nON CONFLICT DO NOTHING;\n```";
  assert.equal(codeOutsideScope(idempotentSql), false);
  assert.equal(codeOutsideScope("```bash\nnpm install express\n```"), false);
  assert.equal(codeOutsideScope("Create a checkout link on your server, then send the customer to the checkout page."), false);

  const snake = "Sure:\n```python\nimport random\nboard = [[0] * 10 for _ in range(10)]\ndef move(s):\n    return s\nwhile True:\n    move(board)\n```";
  assert.equal(codeOutsideScope(snake), true);
  const stripe = "```js\nconst stripe = require(\"stripe\")(key);\napp.post(\"/webhook\", (req, res) => {\n  const event = stripe.webhooks.constructEvent(req.body, sig, secret);\n  res.sendStatus(200);\n});\n```";
  assert.equal(codeOutsideScope(stripe), true);
  const unfenced = "def a():\n  return 1\ndef b():\n  return 2\ndef c():\n  return 3\nclass X:\n  pass\nimport os\nfor i in range(3):\n  print(i)";
  assert.equal(codeOutsideScope(unfenced), true);
  const unclosed = "```js\nfunction sort(a) {\n  for (let i = 0; i < a.length; i++) {\n    a.sort();\n  }\n  return a;\n}";
  assert.equal(codeOutsideScope(unclosed), true);
});

test("the scope reply answers in the visitor's language and passes the output guard", () => {
  const en = outOfScopeReply("Write a snake game");
  const de = outOfScopeReply("Schreib mir ein Spiel");
  assert.match(en, /only help with ChainMore/);
  assert.match(de, /nur bei ChainMore/);
  for (const reply of [en, de]) assert.equal(guardReply(reply).ok, true);
});

test("code placeholders pass the price guard only for signed-in merchants", () => {
  const reply = "```sql\nINSERT INTO processed_events (event_id) VALUES ($1);\n```";
  assert.equal(guardReply(reply).ok, false);
  assert.equal(guardReply(reply, { allowCodePlaceholders: true }).ok, true);
  // Prices stay blocked, inside code and outside.
  assert.equal(guardReply("The fee is $1.50 per payment.", { allowCodePlaceholders: true }).ok, false);
  assert.equal(guardReply("```\nfee = \"$25\"\n```", { allowCodePlaceholders: true }).ok, false);
  assert.equal(guardReply("Fees start at $1 per payment.", { allowCodePlaceholders: true }).ok, false);
});
