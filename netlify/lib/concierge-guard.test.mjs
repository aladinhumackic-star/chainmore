import assert from "node:assert/strict";
import test from "node:test";
import { guardReply, FALLBACK_TEXT } from "./concierge-guard.ts";

const blocked = [
  ["compliance claim", "Yes, ChainMore is fully PCI-DSS certified and licensed in the EU."],
  ["guarantee", "Your funds are 100% safe and guaranteed."],
  ["blanket chargeback", "With ChainMore there are 0% chargebacks."],
  ["no-chargebacks phrasing", "You get no chargebacks at all with us."],
  ["blanket zero chargebacks", "ChainMore gives merchants zero chargebacks."],
  ["percent figure", "Our fee is only 0.12% per transaction."],
  ["currency figure", "It costs about €50 per month."],
  ["patented english", "Our patented routing core chooses the best rail."],
  ["patent granted english", "ChainMore has a patent granted for its routing engine."],
  ["patentiert german", "Unsere patentierte Technologie optimiert jede Zahlung."],
  ["counterparty leak", "We route your card payments through Paysafe."],
  ["pilot leak", "Our pilot merchant Noframe already uses this."],
  ["identity leak", "As a large language model trained by OpenAI, I think..."],
  ["rail overclaim", "Apple Pay is live and available today on ChainMore."],
  ["card supported today overclaim", "Cards are supported today on ChainMore."],
  ["visa production overclaim", "Visa is in production now."],
];

for (const [name, input] of blocked) {
  test(`blocks: ${name}`, () => {
    const g = guardReply(input);
    assert.equal(g.ok, false, `expected block for: ${input}`);
    assert.equal(g.text, FALLBACK_TEXT);
    assert.ok(g.hits.length > 0);
  });
}

const allowed = [
  ["plain product answer", "ChainMore routes each payment to the rail that fits your business logic, through one integration."],
  ["48 hours is fine", "Onboarding review typically completes within 48 hours."],
  ["stablecoin nuance", "Stablecoin settlements are final on-chain; card payments keep the card network's dispute rules."],
  ["stablecoin no chargeback mechanism", "On the stablecoin rail, there is no chargeback mechanism on that rail."],
  ["stablecoin rail no chargebacks scoped", "There are no chargebacks on the stablecoin rail; card payments keep dispute rules."],
  ["patent pending hyphen", "The routing core is proprietary and patent-pending."],
  ["patent pending words", "The routing core is patent pending."],
  ["patent pending german", "Der Routing-Kern ist zum Patent angemeldet."],
  ["roadmap rails are fine", "Card and wallet methods are on the roadmap and should be reviewed with the team."],
  ["pricing deflection", "Pricing depends on your flow - you can find the current details on the pricing page."],
  ["empty-ish but real", "Yes."],
];

for (const [name, input] of allowed) {
  test(`allows: ${name}`, () => {
    const g = guardReply(input);
    assert.equal(g.ok, true, `false positive on: ${input} (hits: ${g.hits})`);
    assert.equal(g.text, input.trim());
  });
}

test("empty reply falls back", () => {
  const g = guardReply("   ");
  assert.equal(g.ok, false);
  assert.equal(g.text, FALLBACK_TEXT);
});
