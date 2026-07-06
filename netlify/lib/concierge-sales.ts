// Deterministic public sales answers for questions where the bot must be both
// helpful and legally precise. These answers run before the paid model call.

export type ConciergeMessage = {
  role: "user" | "assistant";
  content: string;
};

export const CHARGEBACK_NUANCE_REPLY =
  "Stablecoin payments settle on-chain. That rail does not have a chargeback mechanism. " +
  "Card payments are different. When card rails are used, card network dispute rules still apply. " +
  "So the honest answer is rail by rail, not a blanket promise across every payment method.";

export const CHARGEBACK_NUANCE_REPLY_DE =
  "Bei Stablecoin-Zahlungen ist die Zahlung auf der Blockchain final. " +
  "Auf dieser Schiene gibt es keinen Rückbuchungsmechanismus. " +
  "Bei Kartenzahlungen ist das anders. Sobald Karten-Rails genutzt werden, gelten weiter die Streitfallregeln der Kartennetzwerke. " +
  "Die ehrliche Antwort ist also: Es hängt von der jeweiligen Zahlungsart ab, nicht von einem pauschalen Versprechen.";

const CHARGEBACK_QUESTION =
  /\b(chargebacks?|charge[\s-]?backs?|disputes?|rueckbuchungen?|rückbuchungen?|stornos?)\b/i;

const GERMAN_CHARGEBACK_QUESTION =
  /\b(rueckbuchungen?|rückbuchungen?|stornos?|haendler|händler|heisst|heißt|zahlungen?)\b/i;

export function deterministicConciergeReply(messages: ConciergeMessage[]): string | null {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return null;

  if (CHARGEBACK_QUESTION.test(lastUser.content)) {
    if (GERMAN_CHARGEBACK_QUESTION.test(lastUser.content)) {
      return CHARGEBACK_NUANCE_REPLY_DE;
    }
    return CHARGEBACK_NUANCE_REPLY;
  }

  return null;
}
