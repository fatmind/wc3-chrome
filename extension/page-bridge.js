// page-bridge.js - 6 static page operations + React InputEvent support.
// Runs in ISOLATED world (declared in manifest.json content_scripts).
// Communicates with background.js via chrome.runtime.onMessage.
//
// Modeled after QoderWork's page-bridge.js:
//   - React/controlled component support via prototype value setter
//   - 6 ops: GET_PAGE_TEXT, FILL_FORM, SCROLL_TO_ELEMENT, PREPARE_SCREENSHOT, SEARCH_ELEMENTS, CLICK_ELEMENT
//   - Depends on __qoderAccessibilityTree for ref_N resolution

(function () {
  if (globalThis.__qoderBridge) return;

  function getAriaTree() {
    return globalThis.__qoderAccessibilityTree;
  }

  // ---- GET_PAGE_TEXT ----
  // Smart article text extraction: finds the longest content container.
  function getPageText(maxChars = 50000) {
    const candidates = [
      'article', 'main',
      '[class*="article-body"]', '[class*="articleBody"]',
      '[class*="post-content"]', '[class*="entry-content"]',
      '[class*="content-body"]', '[role="main"]',
      '.content', '#content',
    ];

    let best = null;
    let bestLen = 0;
    for (const sel of candidates) {
      for (const el of document.querySelectorAll(sel)) {
        const len = el.textContent?.length || 0;
        if (len > bestLen) { bestLen = len; best = el; }
      }
    }

    const source = best || document.body;
    let text = (source?.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length > maxChars) text = text.slice(0, maxChars) + '... (truncated)';

    return {
      title: document.title,
      url: window.location.href,
      content: text,
      sourceElement: source?.tagName.toLowerCase() || 'body',
    };
  }

  // ---- Visual indicator helper ----
  function withIndicator(ref, fn) {
    const vi = globalThis.__wrVisualIndicator;
    if (vi) vi.highlightElement(ref);
    try {
      return fn();
    } finally {
      if (vi) setTimeout(() => vi.clearHighlight(), 800);
    }
  }

  // ---- FILL_FORM ----
  // React-safe text input via prototype value setter + InputEvent.
  function fillForm(ref, value) {
    const aria = getAriaTree();
    if (!aria) return { success: false, error: 'Accessibility tree not available' };

    const el = aria.getElementByRef(ref);
    if (!el) return { success: false, error: `Element not found: ${ref}` };

    return withIndicator(ref, () => {
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const tag = el.tagName.toLowerCase();

      if (tag === 'select') {
        let found = false;
        for (const opt of el.options) {
          if (opt.value === String(value) || opt.text === String(value)) {
            el.value = opt.value;
            found = true;
            break;
          }
        }
        if (!found) return { success: false, error: 'No matching option found' };
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (tag === 'input') {
        const type = (el.type || 'text').toLowerCase();
        if (type === 'checkbox' || type === 'radio') {
          el.checked = !!value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (type === 'file') {
          return { success: false, error: 'File uploads not supported via fillForm' };
        } else {
          setInputValue(el, String(value));
        }
      } else if (tag === 'textarea') {
        setInputValue(el, String(value));
      } else if (el.isContentEditable) {
        setContentEditable(el, String(value));
      } else {
        setInputValue(el, String(value));
      }

      if ((tag === 'textarea' || (tag === 'input' &&
          ['text','password','search','tel','url'].includes((el.type || 'text').toLowerCase()))) &&
          el.setSelectionRange) {
        const len = el.value?.length || 0;
        el.setSelectionRange(len, len);
      }

      return { success: true, fieldName: el.name || el.id || ref };
    } catch (e) {
      return { success: false, error: e.message || 'Failed to fill form field' };
    }
    });
  }

  // React/controlled component safe value setter.
  // Uses Object.getOwnPropertyDescriptor on the prototype to bypass React's
  // synthetic event wrapper, then dispatches InputEvent with inputType: 'insertText'.
  function setInputValue(el, text) {
    try {
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) {
        desc.set.call(el, text);
      } else {
        el.value = text;
      }
    } catch {
      el.value = text;
    }
    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text,
      }));
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Contenteditable text setter via execCommand.
  function setContentEditable(el, text) {
    el.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    if (el.textContent !== text) {
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text,
      }));
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text,
      }));
    }
  }

  // ---- SCROLL_TO_ELEMENT ----
  function scrollToElement(ref) {
    const aria = getAriaTree();
    if (!aria) return { success: false, error: 'Accessibility tree not available' };
    const el = aria.getElementByRef(ref);
    if (!el) return { success: false, error: `Element not found: ${ref}` };
    return withIndicator(ref, () => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      return { success: true };
    });
  }

  // ---- PREPARE_SCREENSHOT / RESTORE_SCREENSHOT ----
  function prepareScreenshot() {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.dataset.prevOverflow = prevOverflow;
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
  }

  function restoreScreenshot() {
    document.body.style.overflow = document.body.dataset.prevOverflow || '';
    delete document.body.dataset.prevOverflow;
    return { restored: true };
  }

  // ---- SEARCH_ELEMENTS ----
  // Keyword search with scoring across text/aria-label/title/role.
  function searchElements(query, maxResults = 20) {
    const aria = getAriaTree();
    if (!aria) return [];

    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 0);
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null, false);

    let node;
    while ((node = walker.nextNode())) {
      const role = node.getAttribute('role') || node.tagName.toLowerCase();
      const label = node.getAttribute('aria-label') || node.getAttribute('title') ||
                    node.textContent?.trim().slice(0, 100) || '';
      let score = 0;
      const textLower = label.toLowerCase();
      const roleLower = role.toLowerCase();

      for (const kw of keywords) {
        if (textLower.includes(kw)) score += 3;
        if (roleLower.includes(kw)) score += 2;
        if ((node.textContent?.toLowerCase() || '').includes(kw)) score += 1;
      }

      if (score > 0) {
        const ref = aria.getRefForElement(node);
        results.push({ ref, text: label || role, role, score });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  // ---- CLICK_ELEMENT ----
  function clickElement(ref) {
    const aria = getAriaTree();
    if (!aria) return { success: false, error: 'Accessibility tree not available' };
    const el = aria.getElementByRef(ref);
    if (!el) return { success: false, error: `Element not found: ${ref}` };
    return withIndicator(ref, () => {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message || 'Failed to click element' };
      }
    });
  }

  // ---- Message handler (background.js → content script) ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'GET_ARIA_TREE': {
        const aria = getAriaTree();
        if (!aria) {
          sendResponse({ tree: '[Error] Accessibility tree not available', elementCount: 0 });
        } else {
          sendResponse(aria.generate({
            filter: msg.filter,
            maxDepth: msg.maxDepth,
            maxChars: msg.maxChars,
            refId: msg.refId,
          }));
        }
        break;
      }
      case 'GET_PAGE_TEXT':     sendResponse(getPageText(msg.maxChars)); break;
      case 'FILL_FORM':        sendResponse(fillForm(msg.ref, msg.value)); break;
      case 'SCROLL_TO_ELEMENT': sendResponse(scrollToElement(msg.ref)); break;
      case 'PREPARE_SCREENSHOT': sendResponse(prepareScreenshot()); break;
      case 'RESTORE_SCREENSHOT': sendResponse(restoreScreenshot()); break;
      case 'SEARCH_ELEMENTS':  sendResponse(searchElements(msg.query, msg.maxResults)); break;
      case 'CLICK_ELEMENT':    sendResponse(clickElement(msg.ref)); break;
      case 'WAIT_FOR_ELEMENT': waitForElement(msg).then(sendResponse); break;
    }
    return true;
  });

  // ---- WAIT_FOR_ELEMENT ----
  // Poll for a CSS selector to appear. Fast mode: 100ms interval, slow: 500ms.
  function waitForElement({ selector, timeout = 30000, fast = false }) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) {
        const aria = getAriaTree();
        const ref = aria ? aria.getRefForElement(el) : null;
        return resolve({ found: true, ref, selector });
      }

      const interval = fast ? 100 : 500;
      const startTime = Date.now();
      const timer = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(timer);
          const aria = getAriaTree();
          const ref = aria ? aria.getRefForElement(el) : null;
          resolve({ found: true, ref, selector });
          return;
        }
        if (Date.now() - startTime > timeout) {
          clearInterval(timer);
          resolve({ found: false, selector, elapsed: timeout });
        }
      }, interval);
    });
  }

  globalThis.__qoderBridge = {
    getPageText,
    fillForm,
    scrollToElement,
    prepareScreenshot,
    restoreScreenshot,
    searchElements,
    clickElement,
  };
})();
