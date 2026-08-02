#!/usr/bin/env node
/**
 * PoC: CSP bypass via declarativeNetRequest
 *
 * 验证: 扩展通过 declarativeNetRequest 移除页面 CSP 头后, page.eval 能正常工作。
 *
 * 测试方法:
 *   1. 启动本地 HTTP server, 通过 HTTP 响应头设置严格 CSP (script-src 'self')
 *   2. 通过 relay 打开该页面
 *   3. 调用 page.eval 执行 eval() — 应成功 (CSP 头已被扩展移除)
 *   4. 对比: 如果扩展没有移除 CSP, eval() 会被拦截
 *
 * 前置: relay 已启动, 扩展已加载 (chrome://extensions → 刷新)
 * 用法: node wc3-chrome/poc/test-csp-bypass.mjs
 */

import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const RELAY_URL = 'http://127.0.0.1:3459';
const TEST_PORT = 9876;

// 严格 CSP: 通过 HTTP 头设置, 禁止 unsafe-eval
// declarativeNetRequest 会在浏览器收到响应前移除这个头
const CSP_STRICT = "default-src 'self'; script-src 'self'";

// HTML 中不放 meta CSP 标签 — 模拟大多数真实站点 (CSP 只通过 HTTP 头下发)
const HTML = `<!DOCTYPE html>
<html>
<head><title>CSP Strict Test Page</title></head>
<body>
  <h1>CSP Strict Page</h1>
  <a href="/skills/hello-world">Hello World</a>
  <a href="/skills/active-agent">Active Agent</a>
  <a href="/skills/文章去AI味工具">中文 Slug Test</a>
  <p>This page is served with a strict CSP header (script-src 'self').</p>
  <p>Without the extension's CSP bypass, eval() would be blocked.</p>
</body>
</html>`;

async function relayCall(op, params = {}, timeout = 30000) {
  const res = await fetch(`${RELAY_URL}/api/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, params, timeout }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log('  ' + title);
  console.log('='.repeat(60));
}

async function main() {
  // Start local HTTP server with strict CSP header
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', CSP_STRICT);
    res.end(HTML);
  });

  await new Promise(r => server.listen(TEST_PORT, '127.0.0.1', r));
  const testUrl = `http://127.0.0.1:${TEST_PORT}/`;

  try {
    // 0. Check relay
    section('0. Check relay');
    const status = await (await fetch(`${RELAY_URL}/api/status`)).json();
    if (!status.extensionConnected) {
      console.log('[FAIL] Extension not connected. Run: node webclaw3/scripts/webclaw3.mjs start');
      process.exit(1);
    }
    console.log('[OK] Extension connected');

    // 1. Open tab to CSP-strict page
    section('1. Open tab to CSP-strict page');
    console.log(`    CSP header: ${CSP_STRICT}`);
    const tab = await relayCall('tab.create', { url: testUrl, active: false });
    console.log(`[OK] Tab created: id=${tab.id}`);
    await sleep(2000);

    // 2. page.eval: basic eval() — would fail without CSP bypass
    section('2. page.eval — eval("2 + 3") on CSP-strict page');
    const evalResult = await relayCall('page.eval', {
      tabId: tab.id,
      code: 'eval("2 + 3")',
    });
    console.log(`[OK] eval("2 + 3") = ${evalResult}`);
    if (evalResult !== 5) {
      console.log('[FAIL] Unexpected result');
      process.exit(1);
    }
    console.log('[OK] CSP bypass working! eval() succeeded on CSP-strict page.');

    // 3. DOM access via eval
    section('3. DOM access via page.eval');
    const title = await relayCall('page.eval', { tabId: tab.id, code: 'document.title' });
    console.log(`[OK] document.title = "${title}"`);

    const linkCount = await relayCall('page.eval', {
      tabId: tab.id,
      code: `document.querySelectorAll('a[href^="/skills/"]').length`,
    });
    console.log(`[OK] Skill links found: ${linkCount}`);

    // 4. Extract slugs from href (the exact skillhub use case)
    section('4. Extract real slugs from DOM (skillhub use case)');
    const slugsJson = await relayCall('page.eval', {
      tabId: tab.id,
      code: `JSON.stringify(
        Array.from(document.querySelectorAll('a[href^="/skills/"]'))
          .map(a => a.getAttribute('href').replace(/^\\/skills\\//, '').split(/[?#]/)[0])
      )`,
    });
    const slugs = JSON.parse(slugsJson);
    console.log(`[OK] Extracted slugs: ${slugs.join(', ')}`);
    const hasChinese = slugs.some(s => /[\u4e00-\u9fff]/.test(s));
    if (hasChinese) {
      console.log('[OK] Chinese slug extracted correctly (no nameToSlug needed!)');
    }

    // 5. Async IIFE
    section('5. Async IIFE via page.eval');
    const asyncResult = await relayCall('page.eval', {
      tabId: tab.id,
      code: `(async () => {
        await new Promise(r => setTimeout(r, 100));
        return { ok: true, ts: Date.now(), href: window.location.href };
      })()`,
    });
    console.log(`[OK] Async result:`, asyncResult);

    // 6. Complex DOM extraction (simulating real skill extraction)
    section('6. Complex DOM extraction (simulating skillhub card extraction)');
    const cardsJson = await relayCall('page.eval', {
      tabId: tab.id,
      code: `JSON.stringify(
        Array.from(document.querySelectorAll('a[href^="/skills/"]')).map(a => ({
          slug: a.getAttribute('href').replace(/^\\/skills\\//, '').split(/[?#]/)[0],
          name: a.textContent.trim(),
          href: a.getAttribute('href'),
        }))
      )`,
    });
    const cards = JSON.parse(cardsJson);
    console.log(`[OK] Extracted ${cards.length} cards:`);
    for (const c of cards) {
      console.log(`    slug="${c.slug}" name="${c.name}"`);
    }

    // Cleanup
    section('Cleanup');
    await relayCall('tab.close', { tabId: tab.id });
    console.log('[OK] Tab closed');

    section('ALL PASSED');
    console.log('[OK] declarativeNetRequest CSP bypass is working.');
    console.log('[OK] page.eval works on CSP-strict pages via ISOLATED world.');

  } catch (err) {
    console.error('\n[FAIL]', err.message);
    try {
      const tabs = await relayCall('tab.list');
      const t = tabs.find(t => t.url === testUrl);
      if (t) await relayCall('tab.close', { tabId: t.id });
    } catch {}
    process.exit(1);
  } finally {
    server.close();
  }
}

main();
