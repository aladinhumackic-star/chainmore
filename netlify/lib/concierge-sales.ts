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

const CHARGEBACK_QUESTION =
  /\b(chargebacks?|charge[\s-]?backs?|disputes?|rueckbuchungen?|rückbuchungen?|stornos?)\b/i;

export function deterministicConciergeReply(messages: ConciergeMessage[]): string | null {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return null;

  if (CHARGEBACK_QUESTION.test(lastUser.content)) {
    return CHARGEBACK_NUANCE_REPLY;
  }

  return null;
}
