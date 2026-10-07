import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const widgetPath = path.join(__dirname, "concierge-widget.js");
const SESSION_HEADER = "x-chainmore-concierge-session";

test("launcher uses the same Concierge name as the panel", () => {
  const source = fs.readFileSync(widgetPath, "utf8");
  assert.match(source, /'aria-label': 'ChainMore Concierge'/);
  assert.match(source, /class: 'cm-concierge-fab__label', text: 'ChainMore Concierge'/);
  assert.doesNotMatch(source, /Ask ChainMore/);
});

function response(status, body = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function loadWidget(fetchImpl) {
  const sandbox = {
    console,
    document: {
      readyState: "loading",
      addEventListener() {},
    },
    fetch: fetchImpl,
    Promise,
    setTimeout,
    window: {
      __chainmoreConciergeTestHooks: {},
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(widgetPath, "utf8"), sandbox, {
    filename: widgetPath,
  });
  return sandbox.window;
}

test("refreshes an expired Concierge session token once and retries the request", async () => {
  const calls = [];
  const win = loadWidget(async (url, init = {}) => {
    calls.push({ url, init });
    if (url === "/api/concierge/health") {
      return response(200, { ok: true, sessionToken: "fresh-token" });
    }
    if (url === "/api/concierge") {
      return calls.filter((c) => c.url === "/api/concierge").length === 1
        ? response(403)
        : response(200);
    }
    throw new Error(`unexpected url: ${url}`);
  });
  win.__chainmoreConciergeSessionToken = "expired-token";

  const res = await win.__chainmoreConciergeTestHooks.postConciergeWithSessionRetry([
    { role: "user", content: "Hi" },
  ]);

  assert.equal(res.status, 200);
  assert.deepEqual(calls.map((c) => c.url), [
    "/api/concierge",
    "/api/concierge/health",
    "/api/concierge",
  ]);
  assert.equal(calls[0].init.headers[SESSION_HEADER], "expired-token");
  assert.equal(calls[2].init.headers[SESSION_HEADER], "fresh-token");
  assert.equal(win.__chainmoreConciergeSessionToken, "fresh-token");
});

test("does not loop when the refreshed Concierge session token is still rejected", async () => {
  const calls = [];
  const win = loadWidget(async (url, init = {}) => {
    calls.push({ url, init });
    if (url === "/api/concierge/health") {
      return response(200, { ok: true, sessionToken: "fresh-token" });
    }
    if (url === "/api/concierge") return response(403);
    throw new Error(`unexpected url: ${url}`);
  });
  win.__chainmoreConciergeSessionToken = "expired-token";

  const res = await win.__chainmoreConciergeTestHooks.postConciergeWithSessionRetry([
    { role: "user", content: "Hi" },
  ]);

  assert.equal(res.status, 403);
  assert.equal(calls.filter((c) => c.url === "/api/concierge").length, 2);
  assert.equal(calls.filter((c) => c.url === "/api/concierge/health").length, 1);
  assert.equal(calls[0].init.headers[SESSION_HEADER], "expired-token");
  assert.equal(calls[2].init.headers[SESSION_HEADER], "fresh-token");
});

test("renders code blocks and inline code safely, without links or bold inside code", () => {
  const { renderMarkdown } = loadWidget(async () => response(200)).__chainmoreConciergeTestHooks;
  const html = renderMarkdown([
    "Use `POST /v1/checkout/links` with **care**.",
    "",
    "```bash",
    "curl -X POST https://api.chainmore.io/v1/checkout/links \\",
    "  -d '{\"a\":\"<b>**x**</b>\"}'",
    "```",
    "",
    "See chainmore.io/docs and https://chainmore.io/errors.",
  ].join("\n"));
  assert.match(html, /<p>Use <code>POST \/v1\/checkout\/links<\/code> with <strong>care<\/strong>\.<\/p>/);
  assert.match(html, /<div class="cm-code"><div class="cm-code__bar"><span class="cm-code__lang">bash<\/span><button type="button" class="cm-code__copy" data-cm-copy="1">Copy<\/button><\/div><pre><code>curl -X POST https:\/\/api\.chainmore\.io/);
  // Inside code: escaped, no link, no bold.
  assert.match(html, /&lt;b&gt;\*\*x\*\*&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<a href="https:\/\/api\.chainmore\.io/);
  // Outside code: links, without the trailing period, and no double link.
  assert.match(html, /<a href="https:\/\/chainmore\.io\/docs" [^>]*>chainmore\.io\/docs<\/a>/);
  assert.match(html, /<a href="https:\/\/chainmore\.io\/errors" [^>]*>https:\/\/chainmore\.io\/errors<\/a>\./);
  assert.doesNotMatch(html, /<script|<b>/);
});

test("renders a code block that is still streaming, and strips placeholder characters", () => {
  const { renderMarkdown } = loadWidget(async () => response(200)).__chainmoreConciergeTestHooks;
  const streaming = renderMarkdown("Here:\n```js\nconst x = 1;");
  assert.match(streaming, /<p>Here:<\/p><div class="cm-code">[\s\S]*<pre><code>const x = 1;<\/code><\/pre><\/div>$/);
  const forged = renderMarkdown("A\u00000\u0000 <script>alert(1)</script>");
  assert.equal(forged, "<p>A0 &lt;script&gt;alert(1)&lt;/script&gt;</p>");
  const indented = renderMarkdown("  ```python\n  print('hi')\n  ```\nafter");
  assert.match(indented, /<pre><code>print\(&#39;hi&#39;\)<\/code><\/pre>/);
});
