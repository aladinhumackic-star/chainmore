// ChainMore Concierge: remove secrets and personal data before the model
// sees a message.
//
// Merchants paste code, logs and error bodies. Those can carry an API key, a
// webhook secret, a password in a connection string, a private key, a card
// number or a customer's e-mail. Each recognisable value is replaced by a
// marker such as "[removed: API key]" before anything leaves for the model
// provider; the prompt tells the Concierge to ask for rotation when it sees
// one. Transaction hashes, addresses, payment ids and order ids stay: they
// are needed to debug and are not secret.
//
// Pure module: no I/O, fully unit-testable.

type Rule = { label: string; re: RegExp; keep?: (match: string, ...groups: string[]) => string | null };

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// IBAN check digits (ISO 13616): move the first four characters to the end,
// letters to numbers, remainder 1 modulo 97.
function ibanValid(raw: string): boolean {
  const iban = raw.replace(/ /g, "").toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const code = ch.charCodeAt(0);
    const value = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const digit of value) rest = (rest * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return rest === 1;
}

// A value that only points at a secret (an environment variable, a config
// lookup, a placeholder, a type name) is code the merchant needs, not a
// secret.
const REFERENCE = /^(?:process\.env|import\.meta\.env|os\.environ|os\.getenv|getenv|env\(|ENV\[|\$|\{|<|config\.|settings\.|self\.|this\.|req\.|request\.|\[removed)/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

function looksSecret(value: string): boolean {
  if (REFERENCE.test(value) || ENV_NAME.test(value) || value.includes("(")) return false;
  return value.length >= 8 && /[^A-Za-z]/.test(value);
}

const marker = (label: string) => `[removed: ${label}]`;

// Order matters: whole blocks first, then labelled values, then shapes.
const RULES: Rule[] = [
  {
    label: "private key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  { label: "API key", re: /\bcm_(?:test|live)_[A-Za-z0-9_-]{8,}/g },
  { label: "webhook secret", re: /\bwhsec_[A-Za-z0-9_+/=-]{8,}/g },
  { label: "token", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { label: "API key", re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { label: "access key", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  // Authorization: Bearer <anything>, keep the scheme so the header stays readable.
  {
    label: "token",
    re: /\b(Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{12,})/g,
    keep: (_m, scheme) => `${scheme} ${marker("token")}`,
  },
  // user:password@ in connection strings and URLs.
  {
    label: "password",
    re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):([^\s@/]+)@/gi,
    keep: (_m, head) => `${head}:${marker("password")}@`,
  },
  // password=..., secret: "...", private_key = ..., mnemonic / seed phrase.
  {
    label: "secret",
    re: /\b((?:[A-Za-z0-9_]*?)(?:password|passwd|pwd|secret|private[_-]?key|api[_-]?key|access[_-]?token|client[_-]?secret|mnemonic|seed[_-]?phrase)[A-Za-z0-9_]*)(\s*[=:]\s*)(["']?)([^\s"'`,;]{6,})\3/gi,
    keep: (_m, name, sep, quote, value) =>
      looksSecret(value) ? `${name}${sep}${quote}${marker("secret")}${quote}` : null,
  },
  // IBAN, only with valid check digits.
  {
    label: "IBAN",
    re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g,
    keep: (m) => (ibanValid(m) ? marker("IBAN") : null),
  },
  // Card numbers: 13 to 19 digits starting 2 to 6 (card networks, not
  // timestamps), spaces or dashes allowed, Luhn-valid.
  {
    label: "card number",
    re: /\b[2-6](?:[ -]?\d){12,18}\b/g,
    keep: (m) => (luhnValid(m.replace(/[ -]/g, "")) ? marker("card number") : null),
  },
  // E-mail addresses, except ChainMore's own.
  {
    label: "e-mail",
    re: /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/g,
    keep: (m, domain) => (/^(?:[a-z0-9-]+\.)*chainmore\.io$/i.test(domain) ? null : marker("e-mail")),
  },
];

export type Redaction = { text: string; removed: string[] };

export function redact(input: string): Redaction {
  let text = String(input ?? "");
  const removed = new Set<string>();
  for (const rule of RULES) {
    text = text.replace(rule.re, (match: string, ...rest: unknown[]) => {
      const groups = rest.slice(0, -2).map((g) => (typeof g === "string" ? g : ""));
      if (rule.keep) {
        const out = rule.keep(match, ...groups);
        if (out === null) return match;
        removed.add(rule.label);
        return out;
      }
      removed.add(rule.label);
      return marker(rule.label);
    });
  }
  return { text, removed: [...removed] };
}

export const REDACTION_NOTE = `Some values in the visitor's messages were replaced by markers such as
"[removed: API key]" before you saw them. Never guess the removed value. If
a key, secret, password, token or private key was removed, say once that it
was taken out of the message and that the merchant should rotate it in the
dashboard (API keys, Webhooks) or wherever it was issued. Never ask for it
again.`;
