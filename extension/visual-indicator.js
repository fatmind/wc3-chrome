// visual-indicator.js — wc3 content script
// Provides visual feedback when the extension operates on page elements:
// - Green pulsing border around target elements (ref_N addressing)
// - Status badge (top-right): loading / completed / error
// - Agent-mode pulsing border (full viewport inner glow)
// - Stop button (bottom-center) to abort ongoing operations
//
// All UI renders inside a shadow DOM at z-index 2147483647 to avoid page interference.
// Message protocol: background.js sends WR_* messages via chrome.tabs.sendMessage.

(function () {
  if (globalThis.__wrVisualIndicator) return;

  let highlightEl = null;
  let statusBadge = null;
  let glowBorder = null;
  let agentActive = false;
  let wasActiveBeforeHide = false;
  let isMcpMode = false;
  let shadowRoot = null;

  // ── Shadow DOM container ──

  function getShadow() {
    if (shadowRoot) return shadowRoot;
    let host = document.getElementById('wr-shadow-container');
    if (host && host.shadowRoot) {
      shadowRoot = host.shadowRoot;
      return shadowRoot;
    }
    host = document.createElement('div');
    host.id = 'wr-shadow-container';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    shadowRoot = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
    return shadowRoot;
  }

  // ── Element highlight (green pulsing border around ref_N target) ──

  function showHighlight(ref) {
    const aria = globalThis.__qoderAccessibilityTree;
    if (!aria) { console.warn('[wc3] a11y tree not available'); return; }
    const el = aria.getElementByRef(ref);
    if (!el) { console.warn('[wc3] element not found:', ref); return; }

    hideHighlight();
    const rect = el.getBoundingClientRect();
    const sx = window.scrollX || window.pageXOffset;
    const sy = window.scrollY || window.pageYOffset;
    const root = getShadow();

    const overlay = document.createElement('div');
    overlay.id = 'wr-highlight-overlay';
    overlay.style.cssText = `
      position:absolute;
      left:${rect.left + sx - 5}px;
      top:${rect.top + sy - 5}px;
      width:${rect.width + 10}px;
      height:${rect.height + 10}px;
      border:3px solid #4CAF50;
      border-radius:4px;
      pointer-events:none;
      animation:wr-pulse 1s ease-in-out infinite;
      box-sizing:border-box;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes wr-pulse {
        0%,100% { border-color:#4CAF50; box-shadow:0 0 5px rgba(76,175,80,0.5); }
        50% { border-color:#81C784; box-shadow:0 0 20px rgba(76,175,80,0.8); }
      }
    `;
    root.appendChild(style);
    root.appendChild(overlay);
    highlightEl = overlay;

    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }

  function hideHighlight() {
    const root = getShadow();
    const overlay = root.getElementById('wr-highlight-overlay');
    if (overlay) overlay.remove();
    highlightEl = null;
  }

  // ── Status badge (top-right corner) ──

  function showStatusBadge(status) {
    const root = getShadow();
    const existing = root.getElementById('wr-status-badge');
    if (existing) existing.remove();

    const badge = document.createElement('div');
    badge.id = 'wr-status-badge';

    const icons = { loading: '⏳', completed: '✅', error: '❌' };
    const colors = { loading: '#2196F3', completed: '#4CAF50', error: '#f44336' };
    const color = colors[status] || colors.loading;
    const icon = icons[status] || icons.loading;

    badge.style.cssText = `
      position:fixed;
      top:20px;right:20px;
      background:${color};
      color:white;
      padding:12px 20px;
      border-radius:8px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      font-size:14px;font-weight:600;
      cursor:pointer;
      box-shadow:0 4px 12px rgba(0,0,0,0.15);
      display:flex;align-items:center;gap:8px;
      transition:all 0.3s ease;
      z-index:2147483647;
    `;
    badge.innerHTML = `${icon} ${status.charAt(0).toUpperCase() + status.slice(1)}`;
    badge.onclick = () => {
      badge.style.opacity = '0';
      setTimeout(() => badge.remove(), 300);
    };
    root.appendChild(badge);
    statusBadge = badge;
  }

  function hideStatusBadge() {
    if (statusBadge) { statusBadge.remove(); statusBadge = null; }
  }

  // ── Agent-mode pulsing border (full viewport inner glow) ──

  function showPulsingBorder(mcp) {
    agentActive = true;
    isMcpMode = !!mcp;
    const root = getShadow();

    // Glow border style
    if (!root.getElementById('wr-glow-styles')) {
      const style = document.createElement('style');
      style.id = 'wr-glow-styles';
      style.textContent = `
        @keyframes wr-agent-pulse {
          0%,100% {
            box-shadow:inset 0 0 4px rgba(74,222,128,0.5),inset 0 0 8px rgba(74,222,128,0.25);
          }
          50% {
            box-shadow:inset 0 0 6px rgba(74,222,128,0.7),inset 0 0 12px rgba(74,222,128,0.35);
          }
        }
      `;
      root.appendChild(style);
    }

    if (glowBorder) {
      glowBorder.style.display = '';
    } else {
      glowBorder = document.createElement('div');
      glowBorder.id = 'wr-agent-glow-border';
      glowBorder.style.cssText = `
        position:fixed;top:0;left:0;right:0;bottom:0;
        pointer-events:none;
        z-index:2147483646;
        opacity:0;
        transition:opacity 0.3s ease-in-out;
        animation:wr-agent-pulse 2s ease-in-out infinite;
        box-shadow:inset 0 0 4px rgba(74,222,128,0.5),inset 0 0 8px rgba(74,222,128,0.25);
      `;
      root.appendChild(glowBorder);
    }

    // Stop button
    if (!stopBtn) {
      stopBtn = createStopButton();
      root.appendChild(stopBtn);
    }

    requestAnimationFrame(() => {
      glowBorder.style.opacity = '1';
      if (stopBtn) { stopBtn.style.opacity = '1'; stopBtn.style.transform = 'translate(-50%, 0)'; }
    });
  }

  function hidePulsingBorder() {
    agentActive = false;
    if (glowBorder) {
      glowBorder.style.opacity = '0';
      setTimeout(() => { if (glowBorder && !agentActive) glowBorder.style.display = 'none'; }, 300);
    }
    if (stopBtn) {
      stopBtn.style.opacity = '0';
      stopBtn.style.transform = 'translate(-50%, 100px)';
      setTimeout(() => { if (stopBtn && !agentActive) { stopBtn.remove(); stopBtn = null; } }, 300);
    }
  }

  // ── Stop button ──

  let stopBtn = null;

  function createStopButton() {
    const container = document.createElement('div');
    container.id = 'wr-stop-container';
    container.style.cssText = `
      position:fixed;
      bottom:16px;left:50%;
      transform:translateX(-50%) translateY(100px);
      pointer-events:none;
      z-index:2147483647;
      opacity:0;
      transition:all 0.3s cubic-bezier(0.4,0,0.2,1);
    `;

    const btn = document.createElement('button');
    btn.id = 'wr-stop-button';
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" style="display:inline-block;vertical-align:middle;margin-right:8px;">
        <path d="M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,192a84,84,0,1,1,84-84A84.09,84.09,0,0,1,128,212Zm40-112v56a12,12,0,0,1-12,12H100a12,12,0,0,1-12-12V100a12,12,0,0,1,12-12h56A12,12,0,0,1,168,100Z"></path>
      </svg>
      <span style="vertical-align:middle">Stop Action</span>
    `;
    btn.style.cssText = `
      position:relative;
      padding:12px 16px;
      background:#FAF9F5;
      color:#141413;
      border:0.5px solid rgba(31,30,29,0.4);
      border-radius:12px;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      font-size:14px;font-weight:600;
      cursor:pointer;
      display:inline-flex;align-items:center;justify-content:center;
      box-shadow:0 40px 80px rgba(74,222,128,0.24),0 4px 14px rgba(74,222,128,0.24);
      transition:all 0.2s ease;
      pointer-events:auto;
    `;
    btn.addEventListener('mouseenter', () => { if (agentActive) btn.style.background = '#F5F4F0'; });
    btn.addEventListener('mouseleave', () => { if (agentActive) btn.style.background = '#FAF9F5'; });
    btn.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'WR_STOP' });
        btn.innerHTML = '<span style="vertical-align:middle">Stopping...</span>';
        btn.disabled = true;
        btn.style.opacity = '0.7';
        setTimeout(() => hidePulsingBorder(), 500);
      } catch (e) {
        console.error('[wc3] Failed to send stop:', e);
      }
    });

    container.appendChild(btn);
    return container;
  }

  // ── Hide / restore (for tool-use transitions) ──

  function hideForToolUse() {
    wasActiveBeforeHide = agentActive;
    if (glowBorder) glowBorder.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'none';
    if (statusBadge) statusBadge.style.display = 'none';
  }

  function showAfterToolUse() {
    if (wasActiveBeforeHide) {
      if (glowBorder) { glowBorder.style.display = ''; requestAnimationFrame(() => { glowBorder.style.opacity = '1'; }); }
      if (stopBtn) { stopBtn.style.display = ''; requestAnimationFrame(() => { stopBtn.style.opacity = '1'; stopBtn.style.transform = 'translate(-50%, 0)'; }); }
    }
    wasActiveBeforeHide = false;
  }

  // ── Hide all / restore all (for QoderWork coexistence) ──

  function hideAll() {
    const host = document.getElementById('wr-shadow-container');
    if (host) { host.style.opacity = '0'; host.style.transition = 'opacity 0.05s ease'; }
  }

  function restoreAll() {
    const host = document.getElementById('wr-shadow-container');
    if (host) { host.style.opacity = '1'; host.style.transition = 'opacity 0.2s ease'; }
  }

  // ── Message handler ──

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'WR_SHOW_HIGHLIGHT':
        showHighlight(msg.ref);
        sendResponse({ success: true });
        break;
      case 'WR_HIDE_HIGHLIGHT':
        hideHighlight();
        sendResponse({ success: true });
        break;
      case 'WR_SHOW_STATUS':
        showStatusBadge(msg.status);
        sendResponse({ success: true });
        break;
      case 'WR_HIDE_STATUS':
        hideStatusBadge();
        sendResponse({ success: true });
        break;
      case 'WR_SHOW_PULSING_BORDER':
        showPulsingBorder(msg.isMcp);
        sendResponse({ success: true });
        break;
      case 'WR_HIDE_PULSING_BORDER':
        hidePulsingBorder();
        sendResponse({ success: true });
        break;
      case 'WR_HIDE_ALL':
        hidePulsingBorder();
        hideStatusBadge();
        sendResponse({ success: true });
        break;
      case 'WR_HIDE_FOR_TOOL_USE':
        hideForToolUse();
        sendResponse({ success: true });
        break;
      case 'WR_SHOW_AFTER_TOOL_USE':
        showAfterToolUse();
        sendResponse({ success: true });
        break;
      case 'WR_HIDE_INDICATOR':
        hideAll();
        sendResponse({ success: true });
        break;
      case 'WR_RESTORE_INDICATOR':
        restoreAll();
        sendResponse({ success: true });
        break;
      default:
        sendResponse({ success: false, error: `Unknown message type: ${msg.type}` });
    }
    return true;
  });

  // ── Public API ──

  globalThis.__wrVisualIndicator = {
    highlightElement: showHighlight,
    clearHighlight: hideHighlight,
    showStatusBadge,
    hideStatusBadge,
    showPulsingBorder,
    hidePulsingBorder,
    get state() {
      return { isPulsingActive: agentActive, isMcp: isMcpMode, wasActiveBeforeHide };
    },
  };

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    hidePulsingBorder();
    hideStatusBadge();
    hideHighlight();
  });

  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    console.log('[wc3] Visual indicator injected');
  }
})();
