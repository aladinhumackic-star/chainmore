// ChainMore Concierge — boot gate (v2).
//
// Loads the chat widget ONLY when /api/concierge/health reports ok,
// i.e. the edge function is deployed and request admission is configured.
// Without the key the site stays exactly as it is today: no widget,
// no dead button, nothing to explain. Safe by default.
//
// This file is the only thing index.html includes. The widget itself
// (concierge-widget.js) is byte-identical to the reviewed build and
// is injected on demand.
(function () {
  'use strict';
  if (window.__chainmoreConciergeBooted) return;
  window.__chainmoreConciergeBooted = true;
  fetch('/api/concierge/health', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || j.ok !== true) return;
      window.__chainmoreConciergeSessionToken = j.sessionToken || '';
      var s = document.createElement('script');
      s.src = '/assets/concierge-widget.js';
      s.defer = true;
      document.head.appendChild(s);
    })
    .catch(function () { /* stay silent — the site works without the widget */ });
})();
