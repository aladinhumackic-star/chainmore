// ChainMore Concierge: is this turn about integrating ChainMore?
//
// The answer only sets the output budget and adds one note to the system
// input. Integration help needs room for steps and code; everything else
// keeps the short sales budget. The model still decides what to answer and
// declines general programming that has nothing to do with ChainMore, so a
// visitor who games these words gains a larger cap, not a different scope.
//
// Pure module: no I/O, fully unit-testable.

export type ConciergeTurn = { role: "user" | "assistant"; content: string };

// Words that only make sense for ChainMore's own API.
const CHAINMORE_SPECIFIC: RegExp[] = [
  /\b(?:api|app|checkout)\.chainmore\.io\b/i,
  /\/v1\/(?:checkout\/links|payments|payment-intents|webhook_endpoints)\b/i,
  /\b(?:checkout_links?|checkout_token|checkout_link_id|merchant_order_id|amount_minor|available_payment_methods|settlement_profile_id|correlation_id|surface_status|public_status)\b/i,
  /\b(?:idempotency_required|wrong_auth_kind|invalid_request)\b/i,
  /\bcm_(?:test|live)_|\bwhsec_|\bx-chainmore-/i,
  /\bpayment(?:_intent)?\.(?:settled|failed|expired|late_payment_received|delivery_delayed)\b/i,
];

const CHAINMORE_NAME = /\bchain\s?more\b/i;

// Integration vocabulary. On chainmore.io these mean ChainMore unless the
// visitor names another provider.
const INTEGRATION_WORDS =
  /\b(?:api|sdk|webhooks?|endpoints?|checkout[- ]?links?|idempotency|signatur\w*|signature|hmac|api[- ]?(?:keys?|schlüssel\w*)|test ?mode|testmodus|sandbox|go[- ]?live|integrat\w*|anbind\w*|anbinden|einbind\w*|einbauen|implement\w*|return[_ ]url|redirect|weiterleit\w*)\b/i;

// Generic technical words that keep a follow-up in integration mode.
const TECH_WORDS =
  /\b(?:code|snippet|beispiel\w*|example|curl|node(?:\.?js)?|typescript|javascript|python|php|laravel|symfony|django|flask|fastapi|express|next\.?js|java|kotlin|ruby|rails|golang|c#|\.net|woocommerce|shopify|magento|plugin|error|fehler|status|header|request|response|json|key|schlüssel|token|401|400|403|404|409|422|429|500|502|503)\b/i;

const OTHER_PROVIDER =
  /\b(?:stripe|paypal|adyen|mollie|klarna|braintree|square|coinbase|bitpay|nowpayments|coingate|moonpay|privy|yuno|checkout\.com|razorpay|paddle|lemon\s?squeezy|shopify\s+payments)\b/i;

const FOLLOW_UP_MAX_CHARS = 160;

function isDirect(text: string): boolean {
  if (CHAINMORE_SPECIFIC.some((re) => re.test(text))) return true;
  if (CHAINMORE_NAME.test(text) && (INTEGRATION_WORDS.test(text) || TECH_WORDS.test(text))) return true;
  return INTEGRATION_WORDS.test(text) && !OTHER_PROVIDER.test(text);
}

export function isChainMoreIntegrationTurn(messages: ConciergeTurn[]): boolean {
  const users = messages.filter((m) => m.role === "user").map((m) => m.content);
  const latest = users.at(-1);
  if (!latest) return false;
  if (isDirect(latest)) return true;
  // A follow-up such as "and in Python?" stays in integration mode when one
  // of the last three visitor messages was clearly about the integration.
  const earlier = users.slice(-4, -1);
  if (!earlier.some(isDirect)) return false;
  if (OTHER_PROVIDER.test(latest) && !CHAINMORE_NAME.test(latest)) return false;
  return TECH_WORDS.test(latest) || latest.length <= FOLLOW_UP_MAX_CHARS;
}

// In the dashboard nearly every question is about the integration, and a
// pasted stack trace may not name ChainMore at all. A signed-in merchant
// therefore gets the integration budget for any technical message or long
// paste, unless it is plainly about another provider. Scope still holds:
// the prompt declines unrelated work and codeOutsideScope() replaces
// unrelated code.
const MEMBER_PASTE_CHARS = 400;

export function isMemberIntegrationTurn(messages: ConciergeTurn[]): boolean {
  if (isChainMoreIntegrationTurn(messages)) return true;
  const latest = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  if (!latest) return false;
  if (OTHER_PROVIDER.test(latest) && !CHAINMORE_NAME.test(latest)) return false;
  return TECH_WORDS.test(latest) || latest.length > MEMBER_PASTE_CHARS;
}

export const INTEGRATION_TURN_NOTE = `This turn is about integrating ChainMore.
Follow "How to answer" in the Dashboard Concierge rules: start short, and
give complete code when the fix needs it; the sales length limits do not
apply. If the request is
in fact general programming or another provider's integration, decline in one
or two sentences and offer help with the ChainMore integration instead.`;

// Hard scope check on every reply. The Concierge helps with ChainMore only,
// so a longer piece of code must be about ChainMore. If the model was talked
// into writing unrelated code, the whole reply is replaced. This holds even
// when the prompt rules fail.
const CHAINMORE_CODE_ANCHOR =
  /chainmore|checkout_link|checkout_token|merchant_order_id|amount_minor|idempotency|cm_(?:test|live)_|whsec_|payment(?:_intent)?\.settled|test_event|correlation_id|available_payment_methods|usdc_atomic|surface_status|public_status/i;
// Words that fit the merchant's own side of the integration (storing the
// event, marking the order paid). They count only when no other payment
// provider appears in the same code.
const MERCHANT_SIDE_ANCHOR = /\b(?:event_id|webhooks?|checkout|payment_id|mark_?order_?paid|markOrderPaid)\b/i;
const MAX_FREE_CODE_LINES = 4;
const MAX_FREE_LOOSE_CODE_LINES = 8;
const LOOSE_CODE_LINE =
  /^\s*(?:(?:def|class|function|import|from|return|const|let|var|public|private|package|func|fn|#include|using|for|while|if|elif|else|try|catch|except|switch|case|echo|print)\b.*|.*[;{}]\s*)$/;

export function codeOutsideScope(reply: string): boolean {
  const fences = reply.match(/```[^\n]*\n[\s\S]*?(?:\n\s*```|$)/g) ?? [];
  for (const block of fences) {
    const lines = block.split("\n").slice(1).filter((l) => l.trim() && !/^\s*```/.test(l));
    if (lines.length > MAX_FREE_CODE_LINES && !aboutChainMore(block)) return true;
  }
  // Code written without fences counts too.
  const outside = fences.reduce((text, block) => text.replace(block, ""), reply);
  const looseLines = outside.split("\n").filter((l) => LOOSE_CODE_LINE.test(l)).length;
  return looseLines > MAX_FREE_LOOSE_CODE_LINES && !aboutChainMore(outside);
}

function aboutChainMore(code: string): boolean {
  if (CHAINMORE_CODE_ANCHOR.test(code)) return true;
  return MERCHANT_SIDE_ANCHOR.test(code) && !OTHER_PROVIDER.test(code);
}

export function outOfScopeReply(latestUserText: string): string {
  const german = /[äöüß]|\b(?:und|ich|wie|wir|ihr|der|die|das|nicht|ist|mit|bitte|kann|muss|schreib\w*)\b/i.test(latestUserText);
  return german
    ? "Ich helfe nur bei ChainMore: Anbindung, Zahlungen, Webhooks und Fehlermeldungen. Woran arbeitest du gerade mit ChainMore?"
    : "I can only help with ChainMore: connecting your shop, payments, webhooks and errors. What are you working on with ChainMore?";
}
