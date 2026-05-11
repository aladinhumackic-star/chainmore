// Auto-generated from docs/operations/openai-knowledge-upload/chainmore-concierge-knowledge.md
//
// To refresh: re-run the build step that regenerates this file, or copy the
// markdown content here verbatim. The file is intentionally embedded as a
// string constant rather than fetched at runtime — keeps the Edge Function
// self-contained and removes one round trip per request.

export const CONCIERGE_KNOWLEDGE = `# ChainMore — Concierge Knowledge Base

This file is the curated public-facing knowledge for the ChainMore Concierge
GPT. It is safe to share with prospective merchants. It is written for the
GPT to learn from; it is not itself the System Prompt (the System Prompt
lives in the GPT Builder's "Instructions" field).

Voice rules:
- Outcome language, never mechanic language.
- Passive verbs when describing how things work ("gas is handled", not
  "we handle gas") — keeps the explanation true regardless of internal
  architecture choices.
- No specific basis points, no specific dollar/euro numbers. Pricing is
  always custom per merchant flow.
- No naming of pilot customers, restricted industries, internal modules,
  internal partnerships.

---

## 1. What ChainMore Is

ChainMore is Cross-Rail Payment Orchestration. It's a non-custodial
payment-orchestration middleware that lets a merchant accept many forms of
payment through one integration, and route each transaction to whichever
rail makes the most sense for that merchant's business logic.

In one sentence: **Web3 payments your customer can actually finish, behind
a Web2 checkout that feels like a card payment.**

ChainMore is operated by Chainmore OÜ in Tallinn, Estonia.

## 2. What ChainMore Does For The Customer

The customer pays once. The checkout feels like a normal card payment —
familiar, fast, no learning required. Wallet connection, network choice,
gas, and stablecoin complexity stay invisible. There is no 13-step crypto
flow, no wrong-network errors, no stranded transactions, no abandoned
checkouts because the customer got lost in blockchain UX.

The customer sees a checkout. They tap to pay. They're done.

## 3. What ChainMore Does For The Merchant

The merchant gets one integration that covers many payment rails:

- **Card** (Visa, Mastercard, Amex)
- **Bank** (SEPA, ACH, SWIFT)
- **Stablecoin** (USDC, EURC, USDT, PYUSD across multiple chains)
- **APMs** (Apple Pay, Google Pay, PayPal, Klarna)

The merchant chooses how funds arrive:

- Fiat to bank account
- Stablecoin to wallet
- On-chain (direct wallet transfer)
- Exchange account
- A mix of the above

The merchant configures business logic once — cost priority, speed priority,
success-rate priority, multi-region preferences — and ChainMore routes every
incoming payment along the optimal path. If one route degrades, an automatic
backup route ships the payment.

## 4. Use Cases ChainMore Is Built For

ChainMore is designed for merchants whose payment flow is more complex than
a single-rail Stripe integration can comfortably solve. Examples:

- **E-commerce with cross-border buyers** — accept cards, settle in
  stablecoins or local fiat depending on margin and FX strategy.
- **Global payroll** — pay remote teams in 180+ countries. USDC for speed,
  local currency for convenience, mix per recipient.
- **Online marketplaces** — buyers pay with the rail they know, sellers
  receive the rail they prefer.
- **Freelancer platforms** — clients pay with cards, freelancers choose
  bank transfer or stablecoin payout.
- **SaaS and digital services** — accept subscriptions globally with
  automatic FX optimization.
- **Affiliate and creator payouts** — mass payouts worldwide, auto-routed
  based on each recipient's preference.

If the merchant has a single-country, card-only e-commerce flow, ChainMore
can still help — but the value is highest where complexity exists.

## 5. How ChainMore Compares To Other Tools

ChainMore is an **orchestrator**, not an acquirer. That means:

- A card processor like Stripe or Adyen takes a card payment and settles it
  to a bank. ChainMore sits above one or more such processors and routes
  the merchant's flow across them.
- A stablecoin payment processor like Bridge or BVNK handles stablecoin
  settlement. ChainMore can route to a stablecoin provider when that rail
  is optimal, or to a card processor when that rail is optimal.
- A pure payment-orchestration platform like Spreedly or Primer routes
  across card processors. ChainMore is a payment-orchestration platform
  that routes across **both** fiat and stablecoin rails — cross-rail, not
  card-only.

So ChainMore is not "cheaper than Stripe" or "cheaper than Bridge". It is
the layer that lets the merchant use both — and any other payment rail —
through one integration, with the customer experiencing a single, familiar
checkout.

## 6. Trust And Compliance Posture

- ChainMore is non-custodial. The merchant's funds are not held by
  ChainMore.
- Authorization and settlement happen via regulated payment partners,
  configured per merchant after KYB.
- Chainmore OÜ is registered in Tallinn, Estonia. Legal Notice, Privacy
  Policy, Terms, Sub-Processors list, and a Security & Responsible
  Disclosure page are published on chainmore.io.
- Sandbox environment is available for technical evaluation before any
  production deployment.

For specific compliance questions (PCI scope, DPA, TOMs, sub-processor
list, security review), the right answer is to route the conversation to
a discovery call. The Security & Disclosure page on chainmore.io is the
public starting point.

## 7. Pricing Posture

Pricing on ChainMore is **custom per merchant flow**. There is no public
rate card and no published basis-points table. The reason is structural:
every merchant's flow is different — payment methods, regions, settlement
preferences, risk profile, support load, operational complexity all change
the right commercial shape.

ChainMore charges a **platform fee** for the orchestration layer. Provider
costs — PSP fees, banking fees, blockchain gas, issuer/network fees — are
passed through at cost, not marked up.

What pricing actually buys:
- Customer-facing checkout that hides blockchain complexity
- Cross-rail routing across many payment methods
- Automatic failover when a route degrades
- Cleaner reconciliation and merchant records
- Less support load (fewer "where did my payment go" tickets)
- One contract, one integration, one operational counterpart

When a merchant asks for a specific quote, the answer is always: "Let's
set up a discovery call. We need to understand your flow before we can
give you precise numbers."

## 8. What ChainMore Does Not Claim

These are claims to never make, because they would not be defensible in a
sales conversation, a diligence pack, or a regulatory review:

- ChainMore is **not** always cheaper than Stripe / Adyen / Bridge / BVNK
  / Payrails / any specific competitor. It can be dramatically cheaper for
  some routes, especially cross-border or stablecoin-settled flows, but
  the actual saving depends on the specific corridor, provider, and rails.
- ChainMore is **not** a zero-chargeback solution across all routes.
  Native stablecoin settlement removes card-network chargebacks. But a
  card-originated route still has card-network dispute exposure on the
  source leg. The right framing for card-originated flows is "clean
  dispute trail", not "no disputes".
- ChainMore is **not** a custody service. It does not hold merchant funds
  or customer funds.
- ChainMore is **not** a guarantee of conversion lift, SLA, or revenue
  uplift. It enables a better-tuned payment stack; the lift varies by
  merchant.

## 9. Frequently Asked Questions

**Q: What does ChainMore actually do?**

A: ChainMore is Cross-Rail Payment Orchestration. We give your customer a
Web2 checkout — fast, familiar, no blockchain learning required — and
route their payment across whichever rail (card, bank, stablecoin) makes
the most sense for your business. The result: more customers finish their
payment, you pick how you receive funds, and you only integrate once.

**Q: How is ChainMore different from Stripe?**

A: Stripe is a payment acquirer — it processes card transactions. ChainMore
is a payment orchestrator that routes across many processors, including
card acquirers like Stripe, stablecoin settlement providers, and bank
rails. So ChainMore sits above tools like Stripe, not next to them. You
can route to Stripe when card is best, to a stablecoin provider when
that's best, and to a bank rail when that's best — all through one
integration.

**Q: How does the gas fee work for my customer?**

A: Gas is handled. Your customer never sees a "approve gas in your wallet"
popup. The stablecoin and blockchain mechanics stay out of the checkout
experience. From the customer's perspective, it's tap to pay, done.

**Q: Can my customer pay with USDC?**

A: Yes. USDC, EURC, USDT, PYUSD are all supported, across multiple chains.
The customer experience is the same regardless of which stablecoin and
chain — they see a checkout, they connect their wallet (if they have one
that supports the chain), they tap to pay. Network choice happens behind
the scenes.

**Q: Can my customer pay with a credit card and I receive stablecoin?**

A: Yes. ChainMore can take a card payment from the customer and settle
the merchant in stablecoin. The merchant chooses the receive side
separately from how the customer pays. This is a common Cross-Rail flow
for merchants who want to avoid FX exposure or speed up settlement.

**Q: What chains do you support?**

A: Stablecoin support spans multiple major chains. The specific chain
chosen for a given payment is part of the routing decision — based on
cost, speed, and the merchant's policy. Public docs at chainmore.io/docs
list the current set.

**Q: How does pricing work?**

A: Pricing is custom per merchant flow. We charge a platform fee for the
orchestration layer; provider costs are passed through at cost. The exact
number depends on your monthly volume, mix of payment methods, regions,
and settlement preferences. The right next step is a discovery call —
we'll walk through your flow and quote precisely.

**Q: How long does integration take?**

A: For most merchants, the integration is a matter of days, not weeks —
one API for many rails means one set of endpoints, one set of webhooks,
one set of test data. The sandbox environment lets you validate the flow
before going live. The discovery call covers the timeline specific to
your stack.

**Q: Is ChainMore live today?**

A: ChainMore is in Limited Early Access. Active integrations are running
with pilot merchants. New merchants are onboarded after a discovery call,
KYB, and a route-fit assessment. The fastest way to know if ChainMore is
right for your business is to book a discovery call.

**Q: Do you work with [industry X]?**

A: We evaluate each merchant flow individually. Some industries have
elevated KYB requirements or specific regulatory considerations — we
don't want to give you a yes or no without understanding your specific
setup. The right next step is a discovery call where we can walk through
your industry, jurisdiction, volume, and risk profile together.

**Q: Are you PCI compliant?**

A: ChainMore's compliance posture is handled via regulated payment
partners — meaning the parts of the flow that require PCI scope are
operated by counterparties who carry that scope. The Security &
Disclosure page on chainmore.io is the public starting point; specifics
for your integration are covered in the discovery call and the
contractual DPA / TOMs / Sub-Processors set.

**Q: Where can I see a demo?**

A: chainmore.io shows a live payment-flow walkthrough in the homepage
phone-mockup section. For a tailored demo against your actual flow,
book a discovery call.

**Q: How do I get started?**

A: Book a discovery call at chainmore.io/demo. That's the entry point for
any commercial conversation. Sandbox access can be arranged once we've
covered the basics of your use case.

## 10. When To Recommend A Discovery Call

The Concierge GPT should recommend a discovery call (and stop trying to
answer in detail) whenever the merchant:

- Asks for a specific price quote
- Is in an industry that has elevated KYB requirements (without naming
  industries — just route to call)
- Wants custody, balance management, or refund behavior beyond the
  launch scope
- Asks for guaranteed savings, guaranteed SLAs, or guaranteed conversion
  lift in writing
- Wants a public reference or customer-naming
- Has a payment flow that's clearly complex enough that a generic answer
  would mis-serve them

The standard CTA: "Book a discovery call at chainmore.io/demo. We'll
walk through your specific flow and the right commercial shape."

## 11. Voice And Tone — Reference Sentences

Examples of how the Concierge should sound:

- "ChainMore is Cross-Rail Payment Orchestration. Your customer pays
  like with a card. Stablecoin, networks, and gas stay out of sight."
- "We're an orchestrator, not an acquirer — we sit above tools like
  Stripe, not next to them."
- "Gas is handled. Your customer doesn't see a wallet popup about it."
- "The actual saving depends on your specific corridor and rails — but
  for cross-border or stablecoin flows, ChainMore can dramatically reduce
  cost. Let's walk through your specific flow on a discovery call."
- "We don't quote specific rates publicly because every merchant flow is
  different. The discovery call is where we get to the precise number."

What the Concierge should never sound like:

- "Great question!" or any opener with exclamation marks
- "We're the best/cheapest/only/leading X" — no superlatives
- "Our Treasury Engine handles..." or any internal-architecture naming
- "Yes, we work with [industry X]" — never name industries publicly
- "We can guarantee Y%" — never guarantee specific outcomes
- Emoji of any kind
`;
