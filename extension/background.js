// background.js - wc3-chrome PoC extension's service worker.
// Connects to relay.mjs (ws://127.0.0.1:3459) and routes JSON-RPC ops to chrome.* APIs.
//
// Eval 唯一路径: chrome.scripting.executeScript + ISOLATED world.
// CSP 绕过: declarativeNetRequest 移除页面 CSP 头 (见 background.js onInstalled).

const RELAY_URL = 'ws://127.0.0.1:3459';
const RECONNECT_DELAY = 3_000;
const PONG_TIMEOUT = 30_000;

let ws = null;
let lastPongAt = 0;
let reconnectTimer = null;

function log(...args) {
  console.log('[wc3 bg]', ...args);
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  log('Connecting to', RELAY_URL);
  ws = new WebSocket(RELAY_URL);

  ws.addEventListener('open', () => {
    log('Connected to relay');
    lastPongAt = Date.now();
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      log('Invalid JSON from relay:', String(event.data).slice(0, 100));
      return;
    }
    handleRequest(msg).then(
      (result) => sendResponse(msg.id, result),
      (err) => sendResponse(msg.id, null, { code: -1, message: err.message || String(err) })
    );
  });

  ws.addEventListener('close', () => {
    log('Disconnected from relay, reconnecting in', RECONNECT_DELAY / 1000, 's');
    ws = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
  });

  ws.addEventListener('error', () => {
    log('WebSocket error (relay probably not running)');
  });
}

function sendResponse(id, result, error) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const response = error ? { id, error } : { id, result };
  ws.send(JSON.stringify(response));
}

// ---- Content script messaging ----

async function sendToContent(tabId, msg) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, msg);
    if (response === undefined) {
      throw new Error('No response from content script. Is the page loaded?');
    }
    return response;
  } catch (e) {
    if (/Could not establish connection|Receiving end does not exist/i.test(e.message)) {
      throw new Error(`Content script not loaded on tab ${tabId}. Navigate to an http(s) page first.`);
    }
    throw e;
  }
}

// ---- Visual indicator helpers ----
// Best-effort: failures are silent (indicator is UX polish, not functional).

function showHighlight(tabId, ref) {
  chrome.tabs.sendMessage(tabId, { type: 'WR_SHOW_HIGHLIGHT', ref }).catch(() => {});
}
function hideHighlight(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'WR_HIDE_HIGHLIGHT' }).catch(() => {});
}
function showStatus(tabId, status) {
  chrome.tabs.sendMessage(tabId, { type: 'WR_SHOW_STATUS', status }).catch(() => {});
}
function hideStatus(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'WR_HIDE_STATUS' }).catch(() => {});
}
function showPulsingBorder(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'WR_SHOW_PULSING_BORDER' }).catch(() => {});
}
function hidePulsingBorder(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'WR_HIDE_PULSING_BORDER' }).catch(() => {});
}

// ---- Tab Group 管理 (照搬 QoderWork) ----
//
// 所有 skill 操作的 tab 收纳进一个折叠的 "wc3" group,
// 用户不点开就看不到。group 标题带状态 emoji:
//   ⏳ wc3 (running) / ✅ wc3 (completed) / ⚪ wc3 (idle)

const GROUP_NAME = 'wc3';
const STATUS_EMOJI = { running: '⏳', completed: '✅', idle: '⚪' };

const tabGroupByWindow = new Map();
const tabToGroup = new Map();
const tabStatus = new Map();

function isWrGroupTitle(title) {
  if (!title) return false;
  return Object.values(STATUS_EMOJI).some(e => title.startsWith(e)) || title === GROUP_NAME;
}

async function findGroup(windowId) {
  const cached = tabGroupByWindow.get(windowId);
  if (cached != null) {
    try {
      const g = await chrome.tabGroups.get(cached);
      if (g && g.windowId === windowId) return cached;
    } catch {}
    tabGroupByWindow.delete(windowId);
  }
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    const found = groups.find(g => isWrGroupTitle(g.title));
    if (found) {
      tabGroupByWindow.set(windowId, found.id);
      return found.id;
    }
  } catch {}
  return null;
}

async function ensureGroup(windowId) {
  const existing = await findGroup(windowId);
  if (existing) return existing;

  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
  await chrome.tabGroups.update(groupId, {
    title: `${STATUS_EMOJI.idle} ${GROUP_NAME}`,
    color: 'blue',
    collapsed: true,
  });
  tabGroupByWindow.set(windowId, groupId);
  tabToGroup.set(tab.id, groupId);
  tabStatus.set(tab.id, 'idle');
  return groupId;
}

async function addTabToGroup(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;

  if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    try {
      const g = await chrome.tabGroups.get(tab.groupId);
      if (isWrGroupTitle(g.title)) {
        tabToGroup.set(tabId, tab.groupId);
        return tab.groupId;
      }
    } catch {}
    await chrome.tabs.ungroup(tabId).catch(() => {});
  }

  const groupId = await ensureGroup(windowId);
  try {
    await chrome.tabs.group({ tabIds: [tabId], groupId });
    tabToGroup.set(tabId, groupId);
    tabStatus.set(tabId, 'idle');
    return groupId;
  } catch (e) {
    log('Failed to add tab to group:', e.message);
    return null;
  }
}

async function updateGroupTitle(tabId, status) {
  const groupId = tabToGroup.get(tabId);
  if (!groupId) return;
  if (tabStatus.get(tabId) === status) return;
  try {
    await chrome.tabGroups.update(groupId, { title: `${STATUS_EMOJI[status] || ''} ${GROUP_NAME}` });
    tabStatus.set(tabId, status);
  } catch (e) {
    if (e.message?.includes('No group')) {
      tabToGroup.delete(tabId);
      tabStatus.delete(tabId);
    }
  }
}

// ---- SW 状态持久化 (chrome.storage.session) ----
//
// SW 被杀后重启, 从 session storage 恢复 tab→group 映射.
// 心跳保活时 SW 不会被杀, 但 Chrome 可能因内存压力强制回收.

async function saveState() {
  try {
    const tabs = {};
    for (const [tabId, groupId] of tabToGroup) {
      tabs[tabId] = { groupId, status: tabStatus.get(tabId) || 'idle' };
    }
    await chrome.storage.session.set({ wrTabs: tabs, wrGroupByWindow: Object.fromEntries(tabGroupByWindow) });
  } catch {}
}

async function restoreState() {
  try {
    const data = await chrome.storage.session.get(['wrTabs', 'wrGroupByWindow']);
    if (data.wrGroupByWindow) {
      for (const [wid, gid] of Object.entries(data.wrGroupByWindow)) {
        tabGroupByWindow.set(Number(wid), gid);
      }
    }
    if (data.wrTabs) {
      for (const [tabId, info] of Object.entries(data.wrTabs)) {
        tabToGroup.set(Number(tabId), info.groupId);
        tabStatus.set(Number(tabId), info.status);
      }
    }
    log('State restored:', tabToGroup.size, 'tabs,', tabGroupByWindow.size, 'groups');
  } catch {}
}

// ---- 清理: tab 关闭时清状态 ----

chrome.tabs.onRemoved.addListener((tabId) => {
  tabToGroup.delete(tabId);
  tabStatus.delete(tabId);
  saveState();
});

chrome.tabGroups.onRemoved.addListener((group) => {
  for (const [tabId, gid] of tabToGroup) {
    if (gid === group.id) {
      tabToGroup.delete(tabId);
      tabStatus.delete(tabId);
    }
  }
  for (const [wid, gid] of tabGroupByWindow) {
    if (gid === group.id) tabGroupByWindow.delete(wid);
  }
});

// ---- executeScript (MAIN world) ----
//
// CSP 由 declarativeNetRequest 在 HTTP 层移除; MAIN world 不受 extension 合并 CSP 约束.
// 两者配合, eval 可在页面 JS 上下文中正常执行.
// 包装策略: 先表达式, SyntaxError 降级到 IIFE.
async function evalViaExecuteScript(tabId, code) {
  // 路径 1: 表达式
  let r1 = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (c) => {
      try {
        const v = (0, eval)(c);
        return { ok: true, value: v };
      } catch (e) {
        return { ok: false, error: e.message || String(e), name: e.name || 'Error' };
      }
    },
    args: [`(${code})`],
  });
  if (!r1 || r1.length === 0) throw new Error('executeScript returned no result');
  const inner1 = r1[0].result;
  if (inner1 && inner1.ok) return inner1.value;
  // 失败: 是 SyntaxError 才降级, 其他错误直接抛
  if (inner1 && inner1.name !== 'SyntaxError' && !/SyntaxError/.test(inner1.error || '')) {
    throw new Error(inner1.error);
  }

  // 路径 2: IIFE 包装
  const wrapped = `(async function __qw_exec__() {\n${code}\n})()`;
  const r2 = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (c) => {
      try {
        const v = (0, eval)(c);
        return { ok: true, value: v };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    },
    args: [wrapped],
  });
  if (!r2 || r2.length === 0) throw new Error('executeScript IIFE path returned no result');
  const inner2 = r2[0].result;
  if (!inner2) throw new Error('executeScript IIFE path returned null');
  if (!inner2.ok) throw new Error(inner2.error);
  return inner2.value;
}

// ---- Op 路由 ----

const OPS = {
  ping: async () => {
    lastPongAt = Date.now();
    return { pong: true };
  },

  'tab.list': async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      active: t.active,
      windowId: t.windowId,
      status: t.status,
    }));
  },

  'tab.create': async ({ url, active = true } = {}) => {
    const tab = await chrome.tabs.create({ url, active });
    await addTabToGroup(tab.id);
    saveState();
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active,
      windowId: tab.windowId,
    };
  },

  'tab.close': async ({ tabId } = {}) => {
    await chrome.tabs.remove(tabId);
    return { closed: tabId };
  },

  // Tab Group 状态: running / completed / idle
  'tab.setStatus': async ({ tabId, status } = {}) => {
    if (!['running', 'completed', 'idle'].includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be running|completed|idle`);
    }
    await updateGroupTitle(tabId, status);
    saveState();
    return { tabId, status };
  },

  // 返回 group 内的 tab 列表
  'tab.groupInfo': async () => {
    const result = [];
    for (const [tabId, groupId] of tabToGroup) {
      try {
        const tab = await chrome.tabs.get(tabId);
        result.push({
          id: tab.id,
          url: tab.url,
          title: tab.title,
          groupId,
          status: tabStatus.get(tabId) || 'idle',
        });
      } catch {
        tabToGroup.delete(tabId);
        tabStatus.delete(tabId);
      }
    }
    return result;
  },

  // 动态 eval: 唯一路径 executeScript (受 page CSP 限制)
  'page.eval': async ({ tabId, code } = {}) => {
    if (typeof tabId !== 'number') {
      throw new Error('page.eval: tabId must be a number');
    }
    if (typeof code !== 'string') {
      throw new Error('page.eval: code must be a string');
    }
    return await evalViaExecuteScript(tabId, code);
  },

  // ---- Page ops via content scripts ----

  // Aria tree: content script 遍历 DOM 自建, 用 ref_N 寻址
  'page.ariaTree': async ({ tabId, filter = 'interactive', maxDepth = 15, maxChars = 50000, refId = null } = {}) => {
    return await sendToContent(tabId, { type: 'GET_ARIA_TREE', filter, maxDepth, maxChars, refId });
  },

  // 提取页面文本 (智能找 article/main 容器)
  'page.getText': async ({ tabId, maxChars = 50000 } = {}) => {
    return await sendToContent(tabId, { type: 'GET_PAGE_TEXT', maxChars });
  },

  // 填写表单 (React/受控组件安全, 走 prototype value setter + InputEvent)
  'page.fillForm': async ({ tabId, ref, value } = {}) => {
    return await sendToContent(tabId, { type: 'FILL_FORM', ref, value });
  },

  // 滚动到元素
  'page.scrollTo': async ({ tabId, ref } = {}) => {
    return await sendToContent(tabId, { type: 'SCROLL_TO_ELEMENT', ref });
  },

  // 截图: prepare (隐藏 overflow) → captureVisibleTab → restore
  'page.screenshot': async ({ tabId } = {}) => {
    await sendToContent(tabId, { type: 'PREPARE_SCREENSHOT' });
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await sendToContent(tabId, { type: 'RESTORE_SCREENSHOT' });
    return { dataUrl };
  },

  // 关键词搜索元素 (评分排序)
  'page.search': async ({ tabId, query, maxResults = 20 } = {}) => {
    return await sendToContent(tabId, { type: 'SEARCH_ELEMENTS', query, maxResults });
  },

  // 点击元素 (scrollIntoView + click)
  'page.click': async ({ tabId, ref } = {}) => {
    return await sendToContent(tabId, { type: 'CLICK_ELEMENT', ref });
  },

  // 等待元素出现 (CSS selector, 支持 timeout 和 fast/slow 轮询)
  'page.waitForElement': async ({ tabId, selector, timeout = 30000, fast = false } = {}) => {
    return await sendToContent(tabId, { type: 'WAIT_FOR_ELEMENT', selector, timeout, fast });
  },
};

async function handleRequest(msg) {
  const { id, op, params } = msg;
  const fn = OPS[op];
  if (!fn) {
    throw new Error(`Unknown op: ${op}`);
  }
  return await fn(params || {});
}

chrome.runtime.onInstalled.addListener(() => {
  log('Extension installed');
  setupCspBypass();
  connect();
});

chrome.runtime.onStartup.addListener(() => {
  log('Chrome started');
  setupCspBypass();
  restoreState();
  connect();
});

// ── CSP bypass: strip Content-Security-Policy headers from page responses ──
// This allows page.eval (executeScript + eval) to work on CSP-strict sites.
// Uses session rules so they don't persist beyond browser session (cleaner for dev tools).
const CSP_RULE_ID = 99001;
async function setupCspBypass() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [CSP_RULE_ID],
      addRules: [{
        id: CSP_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'content-security-policy', operation: 'remove' },
            { header: 'content-security-policy-report-only', operation: 'remove' },
          ],
        },
        condition: {
          urlFilter: '*',
          resourceTypes: ['main_frame', 'sub_frame'],
        },
      }],
    });
    log('CSP bypass: session rule installed');
  } catch (e) {
    log('CSP bypass setup failed: ' + e.message);
  }
}

// Stop button in visual-indicator.js sends WR_STOP to abort ongoing operations.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'WR_STOP') {
    log('Stop requested by user (visual indicator)');
    // Reject all pending relay requests
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.close(1000, 'user stop'); } catch {}
      ws = null;
    }
    sendResponse({ stopped: true });
  }
  return true;
});

restoreState();
connect();

// 心跳 + SW 保活: chrome.alarms 每 20s 唤醒 SW, 检查 pong 超时
const KEEPALIVE_ALARM = 'wr-keepalive';

chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 / 3 }); // 20s

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log('Keepalive: WS not open, reconnecting');
    if (ws) try { ws.close(); } catch {}
    ws = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 500);
    return;
  }
  if (Date.now() - lastPongAt > PONG_TIMEOUT) {
    log('Pong timeout, forcing reconnect');
    try { ws.close(); } catch {}
    ws = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1000);
  }
});
