// ChainMore Concierge — deterministic output guard (v2).
//
// The system prompt asks the model to behave; this module ENFORCES it.
// Every assistant reply passes through guardReply() before it reaches
// the visitor. If a forbidden pattern appears, the entire reply is
// replaced with a safe fallback — no partial redaction, no
// franken-sentences, no way for a jailbreak to leak a claim.
//
// Pure module: no I/O, no env, fully unit-testable without an API key.

export interface GuardResult {
  ok: boolean;
  text: string;
  hits: string[];
}

// Claims the Concierge must never make, no matter what the model says.
const FORBIDDEN: Array<{ name: string; re: RegExp }> = [
  // Compliance / legal status claims (ChainMore makes none publicly).
  { name: "compliance-claim", re: /\b(licen[cs]ed|regulated|PCI[\s-]?DSS|SOC\s?2|ISO\s?27001|insured|FDIC|MiCA[\s-]?licen[cs]ed)\b/i },
  // Guarantees / risk promises.
  { name: "guarantee", re: /\b(guarantee[ds]?|risk[\s-]?free|zero\s+risk|100%\s+(safe|secure))\b/i },
  // Blanket chargeback claims (rail-dependent truth; site demo is rail-aware).
  // Scoped stablecoin-rail nuance is allowed; blanket "no chargebacks" is not.
  {
    name: "chargeback-claim",
    re: /\b(?:0\s?%|zero|no)\s+chargebacks?\b(?![^.\n]{0,80}\b(?:mechanism|rail|stablecoin|on-chain|card|dispute)\b)/i,
  },
  // The filing is patent-pending. Never upgrade that to granted-patent wording.
  { name: "patent-overclaim", re: /\bpatented\b|\bpatentiert\w*\b|\bpatent\s+(?:granted|issued|approved)\b/i },
  // Concrete prices: percentages and currency amounts. Pricing is
  // quoted only by the pricing page, never improvised by a bot.
  { name: "percent-figure", re: /\b\d+(?:[.,]\d+)?\s?(%|bps|basis\s?points)/i },
  { name: "currency-figure", re: /[€$£]\s?\d[\d.,]*/ },
  // Counterparties and pilot customers are not public knowledge.
  { name: "counterparty", re: /\b(paysafe|payrails|triple[\s-]?a\b|noframe|dlocal|adyen|checkout\.com)\b/i },
  // Provider identity leaks.
  { name: "identity-leak", re: /\b(chatgpt|openai|gpt-?[0-9a-z.]*|large\s+language\s+model|\bllm\b|anthropic|claude)\b/i },
  // Live-status overclaims for rails that are roadmap.
  { name: "rail-overclaim", re: /\b(cards?|visa|mastercard|amex|apple\s?pay|google\s?pay|paypal|klarna)\b[^.\n]{0,80}\b(live|available\s+(today|now)|already\s+supported|supported\s+today|in\s+production)\b/i },
];

export const FALLBACK_TEXT =
  "That touches on details I'd rather not state imprecisely. " +
  "You'll find pricing on chainmore.io/pricing and platform facts on chainmore.io/security and /status. " +
  "For anything specific, email support@chainmore.io — a human replies within two business days.";

export function guardReply(raw: string): GuardResult {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, text: FALLBACK_TEXT, hits: ["empty"] };
  const hits: string[] = [];
  for (const rule of FORBIDDEN) {
    if (rule.re.test(text)) hits.push(rule.name);
  }
  if (hits.length > 0) return { ok: false, text: FALLBACK_TEXT, hits };
  return { ok: true, text, hits };
}
