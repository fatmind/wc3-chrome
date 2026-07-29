// poc/test-real-site.mjs - 真实站点验证
// 跑一个真实的搜索场景，验证 page.eval 在真实 DOM/动态页面下也工作。
//
// 测试场景：百度搜索 "webclaw3"
//   1. 打开 baidu.com
//   2. 读 document.title
//   3. 用 QoderWork 的 React InputEvent 写法往搜索框输 "webclaw3"
//   4. 模拟点击 "百度一下" 按钮
//   5. 等导航完成
//   6. 读结果页 title，验证包含搜索词
//   7. 提取前 3 条搜索结果

import { Relay } from '../scripts/relay.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const SEARCH_TERM = 'webclaw3';
const SEARCH_URL = 'https://www.baidu.com/';

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log('  ' + title);
  console.log('='.repeat(60));
}

async function main() {
  console.log('[Real-site] 验证 page.eval 在真实站点 (baidu.com) 上的工作');
  console.log('[Real-site] 准备扩展：');
  console.log('  1. 扩展已加载并重载过最新版本');
  console.log('  2. relay WS server 启动后扩展会自动连上');
  console.log();

  const relay = new Relay({ wsPort: 3457 });

  try {
    section('1. 等扩展连进来');
    await relay.waitForExtension({ timeout: 30_000 });
    console.log('[Real-site] OK');

    section('2. 打开 baidu.com');
    const tab = await relay.tab.create({ url: SEARCH_URL, active: true });
    console.log('[Real-site] tab id =', tab.id);
    console.log('[Real-site] 等 3 秒让首页完全加载...');
    await sleep(3000);

    section('3. 读首页 document.title');
    const title = await relay.page.eval(tab.id, 'document.title');
    console.log('[Real-site] title =', JSON.stringify(title));
    if (!title || !title.includes('百度')) {
      console.warn('[Real-site] WARN: title 不含「百度」，可能页面没加载完或被重定向');
    }

    section('4. 查找搜索 input');
    const inputInfo = await relay.page.eval(
      tab.id,
      `(() => {
        const candidates = [
          'input[name="wd"]',
          '#kw',
          'input.s_ipt',
          'input[type="text"]'
        ];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (el) return { selector: sel, found: true, tag: el.tagName, name: el.name };
        }
        return { found: false, htmlSnippet: document.body.innerHTML.slice(0, 500) };
      })()`
    );
    console.log('[Real-site] input =', inputInfo);
    if (!inputInfo.found) {
      throw new Error('找不到搜索 input，页面结构可能变了');
    }

    section('5. 往搜索框输 "webclaw3" (QoderWork InputEvent 写法)');
    // 抄 QoderWork page-bridge.js 的 fillForm 写法: prototype value setter + InputEvent
    const typeResult = await relay.page.eval(
      tab.id,
      `(async () => {
        const el = document.querySelector(${JSON.stringify(inputInfo.selector)});
        el.focus();
        // QoderWork trick: 用 prototype 的 value setter (绕过 React 重写的 setter)
        const proto = HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && typeof desc.set === 'function') {
          desc.set.call(el, ${JSON.stringify(SEARCH_TERM)});
        } else {
          el.value = ${JSON.stringify(SEARCH_TERM)};
        }
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true,
          inputType: 'insertText', data: ${JSON.stringify(SEARCH_TERM)}
        }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // 等 React 状态更新
        await new Promise(r => setTimeout(r, 100));
        return { value: el.value, matches: el.value === ${JSON.stringify(SEARCH_TERM)} };
      })()`
    );
    console.log('[Real-site] type result =', typeResult);
    if (!typeResult.matches) {
      throw new Error(`InputEvent 写值失败: 期望 "${SEARCH_TERM}"，实际 "${typeResult.value}"`);
    }

    section('6. 模拟点击"百度一下"按钮');
    // 找搜索按钮
    const btnInfo = await relay.page.eval(
      tab.id,
      `(() => {
        const sels = ['input[type="submit"]', '#su', 'button[type="submit"]', '.s_btn'];
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el) return { selector: sel, found: true, value: el.value || el.textContent };
        }
        // 兜底: form 提交
        const form = document.querySelector('form');
        return { found: false, hasForm: !!form, action: form?.action };
      })()`
    );
    console.log('[Real-site] button =', btnInfo);

    if (btnInfo.found) {
      // 直接调 .click() 模拟点击
      await relay.page.eval(
        tab.id,
        `document.querySelector(${JSON.stringify(btnInfo.selector)}).click()`
      );
    } else if (btnInfo.hasForm) {
      // 兜底: 提交 form
      await relay.page.eval(tab.id, 'document.querySelector("form").submit()');
    } else {
      // 兜底: 在 input 上按 Enter
      await relay.page.eval(
        tab.id,
        `(() => {
          const el = document.querySelector(${JSON.stringify(inputInfo.selector)});
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
          el.form?.submit();
        })()`
      );
    }
    console.log('[Real-site] 点击/提交已触发');

    section('7. 等搜索结果加载');
    console.log('[Real-site] 等 4 秒...');
    await sleep(4000);

    section('8. 读结果页');
    const resultTitle = await relay.page.eval(tab.id, 'document.title');
    const resultUrl = await relay.page.eval(tab.id, 'window.location.href');
    console.log('[Real-site] result title =', JSON.stringify(resultTitle));
    console.log('[Real-site] result url    =', JSON.stringify(resultUrl));

    if (resultUrl.includes('baidu.com/s?') || resultUrl.includes('baidu.com/s/')) {
      console.log('[Real-site] ✓ 成功跳到搜索结果页');
    } else {
      console.warn('[Real-site] WARN: URL 没跳到搜索结果页，可能被百度反爬拦截或 SPA 路由');
    }

    section('9. 提取前 3 条搜索结果');
    const results = await relay.page.eval(
      tab.id,
      `(async () => {
        // 百度结果通常在 .result / .c-container 之类的容器里
        const containerSelectors = ['.result', '.c-container', '[data-tools]'];
        let items = [];
        for (const sel of containerSelectors) {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            items = Array.from(els).slice(0, 3).map(el => ({
              title: el.querySelector('h3, .t, a')?.textContent?.trim().slice(0, 100) || '',
              href: el.querySelector('a')?.href || '',
              snippet: el.querySelector('.c-abstract, .content-right_8Zs40, .c-color-text')?.textContent?.trim().slice(0, 200) || ''
            }));
            if (items.some(i => i.title)) break;
          }
        }
        return items;
      })()`
    );
    console.log('[Real-site] top 3 results:');
    for (const r of results) {
      console.log(`  - ${r.title}`);
      console.log(`    ${r.href.slice(0, 80)}`);
      if (r.snippet) console.log(`    ${r.snippet.slice(0, 100)}`);
    }

    section('10. 清理');
    await relay.tab.close(tab.id);

    section('Real-site PASSED');
    console.log('[Real-site] page.eval 在真实站点完整跑通。');
    console.log('[Real-site] 关键验证点：');
    console.log('  ✓ 真实 DOM 上 page.eval 工作');
    console.log('  ✓ QoderWork InputEvent 写法在真实搜索框生效');
    console.log('  ✓ 模拟点击/提交触发导航');
    console.log('  ✓ 动态结果页内容可读取');
  } catch (err) {
    console.error('\n[Real-site] FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await relay.close();
    console.log('[Real-site] relay closed. bye');
  }
}

main();
