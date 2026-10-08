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

// What only points at a secret, judged by the expression and never by how a
// value is spelled (F-CONCIERGE-REDACT-2): a value in quotes is a literal
// unless the whole value is an interpolation or a placeholder; a value
// without quotes stays only when it is an environment lookup, an
// interpolation, a function call, a config path, a type name or a word that
// describes the field. A bare word without quotes goes: in YAML and .env
// files it is the secret itself.
const INTERPOLATION = /^(?:\$\{\{[^{}]+\}\}|\$\{[A-Za-z_][A-Za-z0-9_.:-]*\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)$/;
const PLACEHOLDER = /^(?:<[^<>\n]{1,60}>|\[removed: [a-z -]+\]|\*{3,}|x{3,}|X{3,}|\.{3})$/;
// An earlier rule's marker ("[removed: …]") counts as already handled.
const ENV_LOOKUP = /^(?:process\.env\b|import\.meta\.env\b|os\.environ\b|os\.getenv\(|getenv\(|System\.getenv\(|Deno\.env\.get\(|ENV\[|env\(|\$|\{|<|\[removed)/;
const CONFIG_PATH = /^(?:config|settings|self|this|req|request|secrets|ctx|options|opts|params|props)\.[\w$.]+$/;
const CALL = /^[A-Za-z_$][\w$.]*\(/;
const TYPE_NAME = /^(?:string|number|boolean|bool|str|int|bytes|any|unknown|object|String|Buffer|Uint8Array|SecretStr|SecretString|null|undefined|None|nil|true|false)\??$/;
// Words that describe a field in prose rather than fill it.
const DESCRIPTION = /^(?:required|optional|missing|empty|invalid|wrong|incorrect|changed|reset|unset|hidden|redacted|removed|placeholder)$/i;

function isQuotedReference(value: string): boolean {
  return INTERPOLATION.test(value) || PLACEHOLDER.test(value);
}

function isCodeReference(value: string): boolean {
  return ENV_LOOKUP.test(value) || isQuotedReference(value) || CONFIG_PATH.test(value) || CALL.test(value) ||
    TYPE_NAME.test(value) || DESCRIPTION.test(value);
}

// The names that label a secret value: password=..., "client_secret": "...",
// private_key = ..., mnemonic / seed phrase / passphrase.
const SECRET_NAME = String.raw`\b((?:[A-Za-z0-9_]*?)(?:password|passwd|pwd|passphrase|secret|private[ _-]?key|api[ _-]?key|access[ _-]?token|client[ _-]?secret|mnemonic|seed[ _-]?phrase)[A-Za-z0-9_]*)(["']?\s*[=:]\s*)`;
const PHRASE_NAME = String.raw`\b((?:[A-Za-z0-9_]*?)(?:mnemonic|seed[ _-]?phrase|passphrase)[A-Za-z0-9_]*)(["']?\s*[=:]\s*)`;

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
  // A labelled value in quotes is a literal: the whole value goes, whatever
  // its length, case, spaces, dots or brackets, unless the whole value is an
  // interpolation or a placeholder.
  {
    label: "secret",
    re: new RegExp(SECRET_NAME + String.raw`(["'])((?:(?!\3)[^\n\\]|\\.)+)\3`, "gi"),
    keep: (_m, name, sep, quote, value) =>
      isQuotedReference(value) ? null : `${name}${sep}${quote}${marker("secret")}${quote}`,
  },
  // A mnemonic, seed phrase or passphrase written out without quotes: the
  // words up to the end of the line.
  {
    label: "secret",
    re: new RegExp(PHRASE_NAME + String.raw`([A-Za-z]+(?:[ \t]+[A-Za-z]+){2,})`, "gi"),
    keep: (_m, name, sep) => `${name}${sep}${marker("secret")}`,
  },
  // A labelled value without quotes, unless it is code (see isCodeReference).
  {
    label: "secret",
    re: new RegExp(SECRET_NAME + String.raw`([^\s"'\x60,;)}\]]+)`, "gi"),
    keep: (_m, name, sep, value) => {
      // A full stop or similar ending the sentence is not part of the value.
      const [, core, end] = /^(.*?)([.!?:]*)$/.exec(value) ?? ["", value, ""];
      return isCodeReference(core) ? null : `${name}${sep}${marker("secret")}${end}`;
    },
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
