/* Presentation only. Real checkout snapshots are inert; no payment endpoints. */
(() => {
  "use strict";
  const all = selector => [...document.querySelectorAll(selector)];
  const get = id => document.getElementById(id);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");

  const menu = get("mobile-menu"), menuButton = get("mobile-menu-btn");
  function toggleMenu(open, returnFocus = false) {
    menu.classList.toggle("hidden", !open);
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    document.body.style.overflow = open ? "hidden" : "";
    if (returnFocus) menuButton.focus();
  }
  menuButton.addEventListener("click", () => toggleMenu(menuButton.getAttribute("aria-expanded") !== "true"));
  menu.querySelectorAll("a").forEach(link => link.addEventListener("click", () => toggleMenu(false)));
  window.addEventListener("resize", () => { if (innerWidth >= 1024) toggleMenu(false); });

  const nav = get("primary-nav"), groups = all(".nav-group");
  function closeNav() {
    nav.setAttribute("data-active-menu", "");
    groups.forEach(group => { group.removeAttribute("data-active"); group.querySelector("button")?.setAttribute("aria-expanded", "false"); });
  }
  groups.forEach(group => {
    const trigger = group.querySelector("button");
    if (!trigger) return;
    const open = () => {
      closeNav(); nav.setAttribute("data-active-menu", group.id.replace("-dropdown", ""));
      group.setAttribute("data-active", ""); trigger.setAttribute("aria-expanded", "true");
    };
    trigger.setAttribute("aria-expanded", "false");
    group.addEventListener("mouseenter", open);
    trigger.addEventListener("focus", open);
    trigger.addEventListener("click", open);
  });
  nav.addEventListener("mouseleave", closeNav);
  nav.addEventListener("focusout", e => { if (!nav.contains(e.relatedTarget)) closeNav(); });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (menuButton.getAttribute("aria-expanded") === "true") toggleMenu(false, true);
    closeNav();
  });
  all(".platform-tab").forEach(tab => {
    const select = () => {
      all(".platform-tab").forEach(other => {
        const active = other === tab;
        other.classList.toggle("active", active);
        ["text-cyan-700", "bg-white", "border-cyan-500", "font-semibold"].forEach(name => other.classList.toggle(name, active));
        ["text-slate-600", "border-transparent", "font-medium"].forEach(name => other.classList.toggle(name, !active));
      });
      all(".platform-content").forEach(panel => panel.classList.toggle("hidden", panel.dataset.content !== tab.dataset.tab));
    };
    tab.addEventListener("mouseenter", select); tab.addEventListener("focus", select); tab.addEventListener("click", select);
  });

  const cases = [{input:"card",output:"bank"},{input:"card",output:"usdc"},{input:"usdc",output:"bank"},{input:"usdc",output:"onchain"}];
  let heroIndex = 0, heroTimer = null, heroVisible = true, paused = false;
  const pauseButton = document.querySelector(".motion-toggle");
  function showHero(index) {
    heroIndex = index;
    [[".hero-input-card", cases[index].input], [".hero-output-card", cases[index].output]].forEach(([selector,value]) => {
      all(selector).forEach(card => {
        const visible = card.dataset.value === value;
        card.style.opacity = visible ? "1" : "0"; card.style.pointerEvents = visible ? "auto" : "none";
        card.setAttribute("aria-hidden", String(!visible));
      });
    });
    all(".hero-route-indicator").forEach((button, i) => {
      const active = i === index;
      button.setAttribute("aria-pressed", String(active));
      button.style.background = active ? "linear-gradient(to right,#06b6d4,#0891b2)" : "#f1f5f9";
      button.style.color = active ? "white" : "#64748b";
      button.querySelector("span").style.background = active ? "white" : "#64748b";
    });
  }
  function syncMotion() {
    clearInterval(heroTimer); heroTimer = null;
    const stop = paused || motion.matches || document.hidden;
    document.documentElement.classList.toggle("motion-paused", stop);
    all("svg").forEach(svg => { if (stop) svg.pauseAnimations?.(); else svg.unpauseAnimations?.(); });
    pauseButton.textContent = motion.matches ? "Reduced motion on" : paused ? "Play animation" : "Pause animation";
    pauseButton.disabled = motion.matches;
    pauseButton.setAttribute("aria-pressed", String(stop));
    if (!stop && heroVisible) heroTimer = setInterval(() => showHero((heroIndex + 1) % cases.length), 5000);
  }
  all(".hero-route-indicator").forEach((button, index) => button.addEventListener("click", () => {
    paused = true; showHero(index); syncMotion();
  }));
  pauseButton.addEventListener("click", () => { paused = !paused; syncMotion(); });
  motion.addEventListener("change", syncMotion);
  document.addEventListener("visibilitychange", syncMotion);
  new IntersectionObserver(entries => { heroVisible = entries[0].isIntersecting; syncMotion(); }).observe(get("hero"));
  showHero(0); syncMotion();

  const inputs = {card:["Card","Fiat"],stablecoin:["USDC","Stable"],"bank-wire":["Bank transfer","Fiat"],apm:["Apple Pay","Fiat"]};
  const outputs = {bank:["EUR / Bank account","Fiat"],stablecoin:["USDC / Polygon","Stable"],exchange:["USDC / Exchange account","Exchange"],onchain:["USDC / Your wallet","Wallet"]};
  const paymentExamples = {card:"by card",stablecoin:"with the USDC they hold","bank-wire":"by bank transfer",apm:"with Apple Pay"};
  const settlementExamples = {bank:"EUR in your bank account",stablecoin:"USDC on Polygon",exchange:"USDC in your exchange account",onchain:"USDC in your chosen wallet"};
  const flow = {input:"card",output:"stablecoin"};
  const costBenefits = {
    bank: ["Fewer separate fees", "Bring acceptance and bank payout into one route, with the full cost considered together."],
    stablecoin: ["Less lost in conversion", "Bring acceptance and your USDC payout into one flow, instead of arranging conversion separately."],
    exchange: ["Skip an extra transfer", "Route funds to your exchange account instead of moving them there in a separate paid step."],
    onchain: ["A shorter path to funds", "Receive funds in your chosen wallet without arranging an extra payout transfer yourself."]
  };
  const speedBenefits = {
    bank: ["Less manual waiting", "Move from payment to bank payout in one flow. Bank processing times still apply."],
    stablecoin: ["Fewer waiting steps", "Receive USDC on your chosen network without a separate manual transfer after settlement."],
    exchange: ["Ready where you work", "Your payout goes to the account where you use it. Exchange deposit processing still applies."],
    onchain: ["Straight to your wallet", "No separate withdrawal to arrange after receiving your payout. Network confirmation still applies."]
  };
  function showBenefits() {
    let cost = costBenefits[flow.output];
    if (flow.input === "stablecoin" && flow.output !== "bank") cost = ["Fewer fees on the way", "Use the stablecoins your customer already holds, without adding a card payment to this route."];
    const effort = flow.input === "stablecoin"
      ? ["No network guesswork", "One Stablecoin choice. The customer should not need to move funds between networks or buy a separate fee token."]
      : flow.output === "bank"
        ? ["Familiar for your customer", "They pay " + paymentExamples[flow.input] + ". You receive funds in your bank account through the same integration."]
        : [inputs[flow.input][0] + " in. USDC out.", "Your customer pays " + paymentExamples[flow.input] + ". They do not need a wallet for you to receive stablecoins."];
    [["cost",cost],["speed",speedBenefits[flow.output]],["effort",effort]].forEach(([key,copy]) => {
      get("benefit-" + key + "-title").textContent = copy[0];
      get("benefit-" + key + "-copy").textContent = copy[1];
    });
    get("comparison-route").textContent = inputs[flow.input][0] + " → " + outputs[flow.output][0];
  }
  // This calculator uses visitor-editable assumptions, never rates or route quotes.
  const comparisonFields = ["current-cost","scenario-cost","current-time","scenario-time","volume"].map(name => get("compare-" + name));
  const number = value => new Intl.NumberFormat("en-GB", {maximumFractionDigits:2}).format(value);
  const euros = value => new Intl.NumberFormat("en-GB", {style:"currency",currency:"EUR",maximumFractionDigits:2}).format(value);
  function calculateComparison() {
    const valid = comparisonFields.map(field => {
      const ok = field.value.trim() !== "" && Number.isFinite(field.valueAsNumber) && field.validity.valid;
      field.setAttribute("aria-invalid", String(!ok)); return ok;
    });
    const target = get("comparison-results");
    target.replaceChildren();
    if (valid.includes(false)) {
      const error = document.createElement("p");
      error.textContent = "Enter valid non-negative costs (up to €1,000,000) and hours (up to 87,600), and 1 to 1,000,000 whole payments. No result is calculated from incomplete inputs.";
      target.append(error); return;
    }
    const [currentCost, scenarioCost, currentTime, scenarioTime, volume] = comparisonFields.map(field => field.valueAsNumber);
    // Work in cents and hundredths of an hour to avoid negative-zero / equality drift.
    const costDelta = Math.round(currentCost * 100) - Math.round(scenarioCost * 100);
    const timeDelta = Math.round(currentTime * 100) - Math.round(scenarioTime * 100);
    function percentage(delta, baseline) {
      if (baseline === 0) return "No percentage comparison against a zero baseline.";
      const percent = Math.abs(delta) / Math.round(baseline * 100) * 100;
      return number(percent) + "% " + (delta >= 0 ? "less" : "more") + " in this example.";
    }
    function result(metric, label, calculation, worse) {
      const box = document.createElement("div"), strong = document.createElement("strong"), name = document.createElement("span"), detail = document.createElement("small");
      strong.textContent = metric; strong.dataset.direction = worse ? "worse" : "better";
      name.textContent = label; detail.textContent = calculation;
      box.append(strong,name,detail); target.append(box);
    }
    result(euros(Math.abs(costDelta) * volume / 100), costDelta > 0 ? "Illustrative monthly saving" : costDelta < 0 ? "Additional monthly cost" : "No cost difference",
      "(" + euros(currentCost) + " − " + euros(scenarioCost) + ") × " + number(volume) + " payments. " + percentage(costDelta,currentCost), costDelta < 0);
    result(number(Math.abs(timeDelta) / 100) + " hours", timeDelta > 0 ? "Less waiting per payment" : timeDelta < 0 ? "More waiting per payment" : "No time difference",
      number(currentTime) + " − " + number(scenarioTime) + " hours. " + percentage(timeDelta,currentTime), timeDelta < 0);
  }
  comparisonFields.forEach(field => field.addEventListener("input", calculateComparison));
  calculateComparison();
  function setFlow(kind, value) {
    flow[kind] = value;
    all(".flow-" + kind).forEach(card => {
      const active = card.getAttribute("data-flow-" + kind) === value;
      card.dataset.selected = String(active); card.setAttribute("aria-pressed", String(active));
      const color = kind === "input" ? "cyan" : "green";
      card.classList.toggle("border-2", active);
      card.classList.toggle("border-" + color + "-500", active);
      card.classList.toggle("bg-" + color + "-50", active);
      card.classList.toggle("border", !active); card.classList.toggle("border-slate-200", !active);
    });
    get("route-input-label").textContent = inputs[flow.input][0];
    get("route-output-label").textContent = outputs[flow.output][0];
    get("route-types-label").textContent = inputs[flow.input][1] + " to " + outputs[flow.output][1];
    const benefit = flow.input === "stablecoin" && flow.output === "stablecoin"
      ? "No manual network transfer for either side."
      : inputs[flow.input][1] !== outputs[flow.output][1] && ["bank", "stablecoin"].includes(flow.output)
        ? "No separate conversion to arrange."
        : "Acceptance and settlement through one integration.";
    get("flow-benefit").textContent = "Your customer pays " + paymentExamples[flow.input] + ". You receive " + settlementExamples[flow.output] + ". " + benefit;
    showBenefits();
  }
  ["input","output"].forEach(kind => {
    all(".flow-" + kind).forEach(card => {
      const select = () => setFlow(kind, card.getAttribute("data-flow-" + kind));
      card.addEventListener("click", select);
      card.addEventListener("keydown", e => { if (["Enter"," "].includes(e.key)) { e.preventDefault(); select(); } });
    });
  });
  setFlow("input","card"); setFlow("output","stablecoin");

  const preview = get("checkout-preview"), stage = document.querySelector(".checkout-stage");
  const previewImage = preview.querySelector("img"), previewSource = preview.querySelector("source");
  const states = ["wallet","qr","approve","payment_review","confirming","completed"];
  const captions = {
    wallet: "Choose Stablecoin, just as you would choose Card. USDC and USDT share one entry.",
    qr: "Connect your wallet. This preview code cannot connect a real wallet.",
    approve: "Approve the required permission in your wallet. An approval is not a completed payment.",
    payment_review: "Review the payment in your wallet. It has not been confirmed yet.",
    confirming: "The payment is being confirmed. The checkout clearly shows that it is still in progress.",
    completed: "The completed state, with a clear result for the customer. This tour has not moved any money.",
    failed: "A clear failure message and a next step, without pretending that a payment succeeded.",
    expired: "An expired session is explained clearly. No ambiguous success screen."
  };
  let current = "wallet";
  function showCheckoutImage() {
    const path = "/assets/checkout-preview/" + current;
    previewSource.srcset = path + "-mobile.png";
    previewImage.src = path + (stage.dataset.size === "mobile" ? "-mobile.png" : "-desktop.png");
    previewImage.alt = "ChainMore checkout product preview with example data. " + captions[current];
  }
  function selectCheckout(state) {
    if (!(state in captions)) return;
    current = state;
    all("[data-checkout-state]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.checkoutState === state)));
    showCheckoutImage();
    get("checkout-caption").textContent = captions[state];
    get("checkout-back").disabled = state === states[0];
    get("checkout-next").textContent = state === "completed" ? "Start again ↻" : "Next step →";
  }
  all("[data-checkout-state]").forEach(button => button.addEventListener("click", () => selectCheckout(button.dataset.checkoutState)));
  get("checkout-back").addEventListener("click", () => selectCheckout(states[Math.max(0,states.indexOf(current)-1)]));
  get("checkout-next").addEventListener("click", () => selectCheckout(states[(states.indexOf(current)+1)%states.length]));
  all("[data-checkout-size]").forEach(button => button.addEventListener("click", () => {
    stage.dataset.size = button.dataset.checkoutSize;
    all("[data-checkout-size]").forEach(other => other.setAttribute("aria-pressed", String(other === button)));
    showCheckoutImage();
  }));
  document.body.classList.add("js-ready");
})();
