import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const widgetPath = path.join(__dirname, "concierge-widget.js");
const SESSION_HEADER = "x-chainmore-concierge-session";

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
