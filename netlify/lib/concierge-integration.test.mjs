import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import {
  codeOutsideScope,
  isChainMoreIntegrationTurn,
  isMemberIntegrationTurn,
  outOfScopeReply,
} from "./concierge-integration.ts";
import { guardReply } from "./concierge-guard.ts";
import { CONCIERGE_INTEGRATION_KNOWLEDGE } from "./concierge-integration-knowledge.ts";
import { CONCIERGE_DASHBOARD_KNOWLEDGE } from "./concierge-dashboard-knowledge.ts";

const knowledgeRoot = new URL("../../../../docs/operations/openai-knowledge-upload/", import.meta.url);
const integrationKnowledge = readFileSync(new URL("chainmore-concierge-integration-knowledge.md", knowledgeRoot), "utf8");

function checkoutExample(language) {
  const blocks = [...integrationKnowledge.matchAll(/```(\w+)\n([\s\S]*?)```/g)];
  const block = blocks.find((m) => m[1] === language && /function createCheckoutLink|def create_checkout_link|function create_checkout_link/.test(m[2]));
  assert.ok(block, `missing ${language} checkout example`);
  return block[2];
}

test("the generated member knowledge exactly matches its canonical sources", () => {
  assert.equal(CONCIERGE_INTEGRATION_KNOWLEDGE, integrationKnowledge);
  assert.equal(CONCIERGE_DASHBOARD_KNOWLEDGE, readFileSync(new URL("chainmore-concierge-dashboard-knowledge.md", knowledgeRoot), "utf8"));
});

test("the documented Node checkout preserves the order and stops a tokenless replay", async () => {
  const source = checkoutExample("js");
  const saved = { merchant_order_id: "order-1042", checkout_link_id: "synthetic-link", url: "https://checkout.chainmore.io/checkout/?token=cl_synthetic" };
  const replay = { checkout_link_id: saved.checkout_link_id };

  async function run(body, { stored, status = 200, persistError, transportError } = {}) {
    const requests = [];
    const writes = [];
    const context = vm.createContext({
      process: { env: { CHAINMORE_API_KEY: "synthetic-only" } },
      fetch: async (url, opts) => {
        requests.push({ url, key: opts.headers["Idempotency-Key"], body: JSON.parse(opts.body) });
        if (transportError) throw transportError;
        return { ok: status >= 200 && status < 300, status, json: async () => body };
      },
    });
    const create = vm.runInContext(`${source}\ncreateCheckoutLink`, context);
    let value, error;
    try {
      value = await create({ id: "1042", amountMinor: 2500, checkoutLink: stored }, async (id, record) => {
        if (persistError) throw persistError;
        writes.push({ id, record });
      });
    } catch (err) { error = err; }
    assert.equal(requests.length, 1, "must not start a replacement request");
    assert.equal(requests[0].key, "order-1042");
    assert.equal(requests[0].body.merchant_order_id, "order-1042");
    return { value, error, writes };
  }

  const first = await run({ ...replay, checkout_token: "cl_synthetic" }, { status: 201 });
  assert.equal(first.error, undefined);
  assert.equal(first.value, saved.url);
  assert.deepEqual(JSON.parse(JSON.stringify(first.writes)), [{ id: "1042", record: saved }]);

  const resumed = await run(replay, { stored: saved });
  assert.equal(resumed.value, saved.url);
  assert.equal(resumed.writes.length, 0);
  for (const stored of [undefined, { ...saved, checkout_link_id: "other-link" }, { ...saved, merchant_order_id: "order-other" }, { ...saved, url: "" }]) {
    const result = await run(replay, { stored });
    assert.equal(result.value, undefined);
    assert.match(result.error?.message ?? "", /stop.*existing link.*Do not create a replacement/);
    assert.equal(result.writes.length, 0);
  }
  for (const token of [undefined, null, "", 123]) {
    const result = await run({ ...replay, checkout_token: token }, { status: 201 });
    assert.equal(result.value, undefined);
    assert.match(result.error?.message ?? "", /Checkout token unavailable/);
  }
  const notSaved = await run({ ...replay, checkout_token: "cl_synthetic" }, { status: 201, persistError: new Error("storage unavailable") });
  assert.equal(notSaved.value, undefined);
  assert.equal(notSaved.error.message, "storage unavailable");
  const rejected = await run({ code: "invalid_request", detail: "different facts", correlation_id: "synthetic-correlation" }, { status: 400 });
  assert.equal(rejected.value, undefined);
  assert.match(rejected.error.message, /400 invalid_request/);
  const lost = await run(null, { transportError: new Error("first response lost") });
  assert.equal(lost.value, undefined);
  assert.equal(lost.error.message, "first response lost");
});

test("the documented Python checkout stops without a stored URL and persists before returning", () => {
  // Execute the exact documentation block with only the HTTP transport replaced.
  // No request, merchant account or credential is involved.
  const harness = String.raw`
import json, sys, types
source = sys.stdin.read()
requests = types.ModuleType("requests")
sys.modules["requests"] = requests
namespace = {}
exec(source, namespace)
create = namespace["create_checkout_link"]
saved = {"merchant_order_id": "order-1042", "checkout_link_id": "synthetic-link", "url": "https://checkout.chainmore.io/checkout/?token=cl_synthetic"}
replay = {"checkout_link_id": "synthetic-link"}
def run(body, stored=None, status=200, persist_error=False, transport_error=False):
    calls, writes = [], []
    def post(url, **kwargs):
        calls.append(kwargs)
        if transport_error:
            raise RuntimeError("first response lost")
        return types.SimpleNamespace(ok=200 <= status < 300, status_code=status, json=lambda: body)
    requests.post = post
    def save(order_id, record):
        if persist_error:
            raise RuntimeError("storage unavailable")
        writes.append((order_id, record))
    value, error = None, None
    try:
        value = create("1042", 2500, save, stored)
    except Exception as err:
        error = str(err)
    assert len(calls) == 1, "replacement request"
    assert calls[0]["headers"]["Idempotency-Key"] == "order-1042"
    assert calls[0]["json"]["merchant_order_id"] == "order-1042"
    return value, error, writes
value, error, writes = run(dict(replay, checkout_token="cl_synthetic"), status=201)
assert value == saved["url"] and error is None and writes == [("1042", saved)]
value, error, writes = run(replay, saved)
assert value == saved["url"] and error is None and not writes
for stored in [None, dict(saved, checkout_link_id="other-link"), dict(saved, merchant_order_id="order-other"), dict(saved, url="")]:
    value, error, writes = run(replay, stored)
    assert value is None and "Checkout token unavailable" in (error or "") and not writes
for token in [None, "", 123]:
    value, error, writes = run(dict(replay, checkout_token=token), status=201)
    assert value is None and "Checkout token unavailable" in (error or "") and not writes
value, error, writes = run(dict(replay, checkout_token="cl_synthetic"), status=201, persist_error=True)
assert value is None and error == "storage unavailable" and not writes
value, error, writes = run({"code": "invalid_request", "detail": "different facts", "correlation_id": "synthetic-correlation"}, status=400)
assert value is None and "400 invalid_request" in error and not writes
value, error, writes = run(None, transport_error=True)
assert value is None and error == "first response lost" and not writes
print("documented Python checkout cases passed")
`;
  const result = spawnSync("python3", ["-c", harness], {
    input: checkoutExample("python"), encoding: "utf8",
    env: { PATH: process.env.PATH, CHAINMORE_API_KEY: "synthetic-only" },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /documented Python checkout cases passed/);
});

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
