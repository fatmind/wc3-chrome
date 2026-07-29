// poc/test-relay.mjs - 端到端验证：skill 进程 -> relay.mjs -> Chrome 扩展 -> chrome.* API
// 用法: node wc3-chrome/poc/test-relay.mjs
//
// 验证目标:
//   1. WS 双向通
//   2. tab.list / tab.create / tab.close
//   3. page.eval 唯一路径: chrome.scripting.executeScript (受 page CSP 限制)
//   4. async/await 支持 (IIFE 包装)
//   5. 错误传播

import { Relay } from '../scripts/relay.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const TEST_URL = 'https://example.com';

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log('  ' + title);
  console.log('='.repeat(60));
}

async function main() {
  console.log('[PoC] Starting wc3-chrome relay PoC');
  console.log('[PoC] Make sure the wc3-chrome PoC extension is loaded in Chrome.');
  console.log('[PoC]   chrome://extensions/ -> Developer mode -> Load unpacked -> wc3-chrome/extension/');
  console.log();

  const relay = new Relay({ wsPort: 3457 });

  try {
    section('1. Wait for extension to connect');
    await relay.waitForExtension({ timeout: 30_000 });
    console.log('[PoC] Extension connected');

    section('2. tab.list');
    const tabsBefore = await relay.tab.list();
    console.log(`[PoC] Found ${tabsBefore.length} tabs`);

    section('3. tab.create (open example.com)');
    const newTab = await relay.tab.create({ url: TEST_URL, active: true });
    console.log('[PoC] Created tab id =', newTab.id);
    console.log('[PoC] Waiting 2s for page to load...');
    await sleep(2000);

    section('4. page.eval - sync expression (document.title)');
    const title = await relay.page.eval(newTab.id, 'document.title');
    console.log('[PoC] document.title =', JSON.stringify(title));

    section('5. page.eval - window.location.href');
    const href = await relay.page.eval(newTab.id, 'window.location.href');
    console.log('[PoC] window.location.href =', JSON.stringify(href));

    section('6. page.eval - DOM query (count <a> tags)');
    const aCount = await relay.page.eval(
      newTab.id,
      'document.querySelectorAll("a").length'
    );
    console.log('[PoC] number of <a> =', aCount);

    section('7. page.eval - complex expression (extract first link as object)');
    const firstLink = await relay.page.eval(
      newTab.id,
      `(() => {
        const a = document.querySelector("a");
        return a ? { text: a.textContent.trim(), href: a.getAttribute("href") } : null;
      })()`
    );
    console.log('[PoC] first link =', firstLink);

    section('8. page.eval - async/await (IIFE 包装)');
    const asyncResult = await relay.page.eval(
      newTab.id,
      `(async () => {
        const resp = await fetch("/");
        return { status: resp.status, ok: resp.ok, type: resp.headers.get("content-type") };
      })()`
    );
    console.log('[PoC] async result =', asyncResult);

    section('9. page.eval - string with quotes and newlines');
    const text = await relay.page.eval(
      newTab.id,
      'document.body.innerText.split("\\n").filter(s => s.trim()).slice(0, 3).join(" | ")'
    );
    console.log('[PoC] body text excerpt =', JSON.stringify(text));

    section('10. page.eval - throw to test error propagation (IIFE fallback)');
    try {
      await relay.page.eval(newTab.id, 'throw new Error("intentional test error")');
      console.log('[PoC] FAIL: should have thrown');
    } catch (err) {
      console.log('[PoC] Caught expected error:', err.message);
    }

    section('10b. page.eval - multi-statement with var/if/return');
    const multi = await relay.page.eval(
      newTab.id,
      `let count = 0;
       for (let i = 0; i < 5; i++) { count += i; }
       if (count > 5) { return { ok: true, count }; }
       return { ok: false, count };`
    );
    console.log('[PoC] multi-statement result =', multi);

    section('10c. page.eval - try/catch in statement form');
    const caught = await relay.page.eval(
      newTab.id,
      `try { throw new Error("inner"); } catch (e) { return e.message; }`
    );
    console.log('[PoC] caught =', caught);

    section('11. tab.close');
    const closed = await relay.tab.close(newTab.id);
    console.log('[PoC] Closed tab:', closed);

    section('PoC PASSED');
    console.log('[PoC] All 11 steps succeeded. Extension relay + executeScript eval works.');
  } catch (err) {
    console.error('\n[PoC] FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await relay.close();
    console.log('[PoC] Relay closed. Bye!');
  }
}

main();
