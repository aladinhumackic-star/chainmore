/*! ChainMore Concierge Widget, vanilla JS, no dependencies.
 *
 *  Responsibilities:
 *    - Render a floating button bottom-right.
 *    - On click, open a slide-up panel with chat UI.
 *    - Stream the assistant reply from /api/concierge via SSE.
 *    - Keep brand discipline: no third-party logos, no model names.
 *
 *  Design notes:
 *    - State lives only in memory. Closing the panel clears history.
 *      No localStorage. Privacy by default; nothing to leak to a future
 *      visitor who shares the same device.
 *    - All DOM is created in JS so the widget can be dropped onto any
 *      page by including this script. No markup edits required beyond
 *      the script tag.
 *    - CSS is a sibling file (assets/concierge-widget.css). The widget
 *      script loads it after DOM-ready so the below-the-fold Concierge
 *      UI does not block the page's first paint.
 *    - Endpoint is hard-pinned to /api/concierge. Same-origin, the
 *      CSP connect-src 'self' covers it.
 */

(function () {
  'use strict';

  // Configuration
  var API_ENDPOINT     = '/api/concierge';
  var MAX_HISTORY      = 20;          // user + assistant turns
  var MAX_INPUT_CHARS  = 2000;        // matches server-side cap
  var CSS_HREF         = '/assets/concierge-widget.css';

  // Welcome / placeholder copy
  // Voice mirrors the system prompt: conversational, concrete, no hype.
  var WELCOME_TEXT =
    'Hi, I can help with ChainMore. Ask me how it works, ' +
    'which payment rails we cover, how it could fit your checkout, ' +
    'or how to start a discovery call.';

  var INPUT_PLACEHOLDER = 'Ask me about ChainMore';

  // State
  var state = {
    open: false,
    sending: false,
    messages: [],        // {role: 'user'|'assistant', content: string}
  };

  // DOM refs (set after mount)
  var els = {};

  // Helpers

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        if (children[i]) node.appendChild(children[i]);
      }
    }
    return node;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Light Markdown: paragraphs, line breaks, bold (**x**), inline links
  // for chainmore.io pages, and bullet lists. Intentionally minimal so
  // there's no surface area for HTML/script injection through model
  // output. Everything is escaped first; only known patterns are
  // turned back into HTML.
  function renderMarkdown(s) {
    var safe = escapeHtml(s);

    // Bold **x**
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Auto-link chainmore.io URLs (no protocol, no surprises).
    safe = safe.replace(
      /(chainmore\.io\/[a-z0-9\/\-\._#?=&]*[a-z0-9\/])/gi,
      function (m) {
        return '<a href="https://' + m + '" target="_blank" rel="noopener noreferrer">' + m + '</a>';
      },
    );

    // Auto-link full http(s) URLs (rare in answers but defensive).
    safe = safe.replace(
      /(https?:\/\/[a-z0-9\.\-_]+\.[a-z]{2,}[a-z0-9\/\-\._#?=&]*[a-z0-9\/]?)/gi,
      function (m) {
        return '<a href="' + m + '" target="_blank" rel="noopener noreferrer">' + m + '</a>';
      },
    );

    // Simple bullet lists (lines beginning with "- ").
    var lines  = safe.split('\n');
    var out    = [];
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var bullet = line.match(/^\s*-\s+(.+)$/);
      if (bullet) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + bullet[1] + '</li>');
      } else {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(line);
      }
    }
    if (inList) out.push('</ul>');

    // Paragraphs.
    var joined = out.join('\n')
      .split(/\n{2,}/)
      .map(function (block) {
        if (/^<(ul|ol|h\d|blockquote|pre)/.test(block)) return block;
        return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
      })
      .join('');

    return joined;
  }

  // Mount

  function ensureStylesheet(done) {
    var existing = document.querySelector('link[data-cm-concierge-css="true"], link[href="' + CSS_HREF + '"]');
    if (existing) {
      done();
      return;
    }

    var link = document.createElement('link');
    var finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      done();
    }

    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    link.setAttribute('data-cm-concierge-css', 'true');
    link.onload = finish;
    link.onerror = finish;

    document.head.appendChild(link);

    // Do not let a transient CSS load issue remove the entry point.
    // The widget is a helper, not the critical page experience.
    setTimeout(finish, 1500);
  }

  function mount() {
    // Container, fixed position and above page content.
    var root = el('div', { id: 'cm-concierge-root', role: 'region', 'aria-label': 'ChainMore Concierge' });

    // Floating button.
    var fab = el('button', {
      class: 'cm-concierge-fab',
      type: 'button',
      'aria-label': 'Ask ChainMore',
      'aria-expanded': 'false',
      onclick: togglePanel,
    }, [
      el('span', { class: 'cm-concierge-fab__icon', 'aria-hidden': 'true', html:
        // Inline SVG, speech-bubble glyph in ChainMore cyan.
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>' +
        '</svg>'
      }),
      el('span', { class: 'cm-concierge-fab__label', text: 'Ask ChainMore' }),
    ]);

    // Panel.
    var panel = el('div', {
      class: 'cm-concierge-panel',
      role: 'dialog',
      'aria-modal': 'false',
      'aria-labelledby': 'cm-concierge-title',
      hidden: 'hidden',
    });

    var header = el('div', { class: 'cm-concierge-header' }, [
      el('div', { class: 'cm-concierge-header__title' }, [
        el('span', { class: 'cm-concierge-header__dot', 'aria-hidden': 'true' }),
        el('span', { id: 'cm-concierge-title', text: 'ChainMore Concierge' }),
      ]),
      el('div', { class: 'cm-concierge-header__actions' }, [
        el('button', {
          class: 'cm-concierge-iconbtn',
          type: 'button',
          'aria-label': 'Reset conversation',
          title: 'Reset',
          onclick: resetConversation,
          html:
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<polyline points="23 4 23 10 17 10"></polyline>' +
              '<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>' +
            '</svg>',
        }),
        el('button', {
          class: 'cm-concierge-iconbtn',
          type: 'button',
          'aria-label': 'Close',
          title: 'Close',
          onclick: closePanel,
          html:
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<line x1="18" y1="6" x2="6" y2="18"></line>' +
              '<line x1="6" y1="6" x2="18" y2="18"></line>' +
            '</svg>',
        }),
      ]),
    ]);

    var messages = el('div', { class: 'cm-concierge-messages', role: 'log', 'aria-live': 'polite' });

    var inputWrap = el('form', {
      class: 'cm-concierge-input',
      onsubmit: function (e) { e.preventDefault(); send(); },
    }, [
      el('textarea', {
        class: 'cm-concierge-input__field',
        rows: '1',
        maxlength: String(MAX_INPUT_CHARS),
        placeholder: INPUT_PLACEHOLDER,
        'aria-label': 'Your question',
        onkeydown: onInputKeydown,
        oninput: autosizeInput,
      }),
      el('button', {
        class: 'cm-concierge-input__send',
        type: 'submit',
        'aria-label': 'Send',
        title: 'Send',
        html:
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="22" y1="2" x2="11" y2="13"></line>' +
            '<polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>' +
          '</svg>',
      }),
    ]);

    var footer = el('div', { class: 'cm-concierge-footer' }, [
      el('span', { text: 'No personal or confidential data here. Sensitive topic? ' }),
      el('a', {
        href: 'mailto:support@chainmore.io?subject=ChainMore%20Concierge%20follow-up',
        text: 'Email support',
      }),
    ]);

    panel.appendChild(header);
    panel.appendChild(messages);
    panel.appendChild(inputWrap);
    panel.appendChild(footer);

    root.appendChild(panel);
    root.appendChild(fab);

    document.body.appendChild(root);

    els = {
      root: root,
      fab: fab,
      panel: panel,
      messages: messages,
      input: inputWrap.querySelector('textarea'),
      send: inputWrap.querySelector('button[type="submit"]'),
    };

    // Defensive close-paths beyond the X button:
    //   - Escape key closes the panel when it's open (every modal users
    //     have ever met responds to Escape; people try it instinctively).
    //   - Event delegation on the header: any click anywhere on the
    //     dark header strip, except on the reset button, closes the
    //     panel. Makes the X "hit area" effectively the entire header
    //     when the visible X is small.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) closePanel();
    });
    header.addEventListener('click', function (e) {
      // Skip if the click landed on the reset button (or its children
      // via event bubbling). Reset has its own handler.
      var t = e.target;
      while (t && t !== header) {
        if (t.getAttribute && t.getAttribute('aria-label') === 'Reset conversation') return;
        t = t.parentNode;
      }
      closePanel();
    });

    renderWelcome();
  }

  // Rendering

  function renderWelcome() {
    els.messages.innerHTML = '';
    var bubble = el('div', { class: 'cm-msg cm-msg--assistant' }, [
      el('div', { class: 'cm-msg__bubble', html: renderMarkdown(WELCOME_TEXT) }),
    ]);
    els.messages.appendChild(bubble);
  }

  function appendUserMessage(text) {
    state.messages.push({ role: 'user', content: text });
    var bubble = el('div', { class: 'cm-msg cm-msg--user' }, [
      el('div', { class: 'cm-msg__bubble', text: text }),
    ]);
    els.messages.appendChild(bubble);
    scrollToBottom();
  }

  function appendAssistantMessage(initialText) {
    var bubble = el('div', { class: 'cm-msg__bubble', text: initialText || '' });
    var typing = el('span', { class: 'cm-msg__typing', 'aria-hidden': 'true', html: '<span></span><span></span><span></span>' });
    if (!initialText) bubble.appendChild(typing);
    var wrap = el('div', { class: 'cm-msg cm-msg--assistant' }, [bubble]);
    els.messages.appendChild(wrap);
    scrollToBottom();
    return { wrap: wrap, bubble: bubble, typing: typing, text: initialText || '' };
  }

  function updateAssistantMessage(ref, addText) {
    ref.text += addText;
    // Keep typing dots until done; render markdown progressively.
    ref.bubble.innerHTML = renderMarkdown(ref.text);
    scrollToBottom();
  }

  function finalizeAssistantMessage(ref) {
    if (ref.typing && ref.typing.parentNode) ref.typing.parentNode.removeChild(ref.typing);
    ref.bubble.innerHTML = renderMarkdown(ref.text);
    state.messages.push({ role: 'assistant', content: ref.text });
    scrollToBottom();
  }

  function showError(message) {
    var bubble = el('div', { class: 'cm-msg cm-msg--error' }, [
      el('div', { class: 'cm-msg__bubble', text: message }),
    ]);
    els.messages.appendChild(bubble);
    scrollToBottom();
  }

  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  // Input handling

  function onInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function autosizeInput() {
    var ta = els.input;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }

  // Network

  function send() {
    if (state.sending) return;
    var raw = (els.input.value || '').trim();
    if (!raw) return;
    if (raw.length > MAX_INPUT_CHARS) raw = raw.slice(0, MAX_INPUT_CHARS);

    appendUserMessage(raw);
    els.input.value = '';
    autosizeInput();

    // Trim history to MAX_HISTORY most recent turns to stay under server cap.
    var historyToSend = state.messages.slice(-MAX_HISTORY);

    state.sending = true;
    setBusy(true);
    var ref = appendAssistantMessage('');

    fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: historyToSend }),
    }).then(function (res) {
      if (res.status === 429) {
        finalizeAssistantMessage(ref);
        // Remove the empty placeholder bubble.
        if (ref.wrap && ref.wrap.parentNode) ref.wrap.parentNode.removeChild(ref.wrap);
        // Pop the failed assistant turn from history.
        state.messages.pop();
        showError('Too many messages right now. Please try again in a few minutes, or email support@chainmore.io.');
        return null;
      }
      if (!res.ok || !res.body) {
        finalizeAssistantMessage(ref);
        if (ref.wrap && ref.wrap.parentNode) ref.wrap.parentNode.removeChild(ref.wrap);
        state.messages.pop();
        showError('Connection issue. Please try again, or email support@chainmore.io.');
        return null;
      }
      return pumpStream(res.body, ref);
    }).catch(function () {
      finalizeAssistantMessage(ref);
      if (ref.wrap && ref.wrap.parentNode) ref.wrap.parentNode.removeChild(ref.wrap);
      if (state.messages.length && state.messages[state.messages.length - 1].role === 'assistant') {
        state.messages.pop();
      }
      showError('Connection issue. Please try again, or email support@chainmore.io.');
    }).finally(function () {
      state.sending = false;
      setBusy(false);
      els.input.focus();
    });
  }

  function pumpStream(body, ref) {
    var reader  = body.getReader();
    var decoder = new TextDecoder();
    var leftover = '';

    function step() {
      return reader.read().then(function (r) {
        if (r.done) {
          finalizeAssistantMessage(ref);
          return;
        }
        leftover += decoder.decode(r.value, { stream: true });
        var idx;
        while ((idx = leftover.indexOf('\n\n')) !== -1) {
          var chunk = leftover.slice(0, idx);
          leftover  = leftover.slice(idx + 2);
          var lines = chunk.split('\n');
          for (var i = 0; i < lines.length; i++) {
            var m = lines[i].match(/^data:\s*(.*)$/);
            if (!m) continue;
            var payload = m[1].trim();
            if (!payload) continue;
            var evt;
            try { evt = JSON.parse(payload); } catch (_) { continue; }
            if (evt.type === 'delta' && typeof evt.text === 'string') {
              updateAssistantMessage(ref, evt.text);
            } else if (evt.type === 'done') {
              finalizeAssistantMessage(ref);
              return;
            } else if (evt.type === 'error') {
              if (ref.text) {
                finalizeAssistantMessage(ref);
              } else {
                if (ref.wrap && ref.wrap.parentNode) ref.wrap.parentNode.removeChild(ref.wrap);
              }
              showError('Something went wrong. Please try again, or email support@chainmore.io.');
              return;
            }
          }
        }
        return step();
      });
    }
    return step();
  }

  // Panel open/close

  function togglePanel() {
    if (state.open) closePanel();
    else openPanel();
  }

  function openPanel() {
    state.open = true;
    els.panel.hidden = false;
    els.fab.setAttribute('aria-expanded', 'true');
    els.root.classList.add('cm-concierge--open');
    setTimeout(function () { els.input.focus(); }, 50);
  }

  function closePanel() {
    state.open = false;
    els.panel.hidden = true;
    els.fab.setAttribute('aria-expanded', 'false');
    els.root.classList.remove('cm-concierge--open');
  }

  function resetConversation() {
    state.messages = [];
    renderWelcome();
    els.input.value = '';
    autosizeInput();
    els.input.focus();
  }

  function setBusy(busy) {
    els.send.disabled  = busy;
    els.input.disabled = busy;
    els.root.classList.toggle('cm-concierge--busy', busy);
  }

  // Bootstrap

  function bootstrap() {
    ensureStylesheet(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
