// poc/test-skillhub-workflow.mjs
// 验证两阶段工作流：getText 理解结构 → page.eval + DOM 选择器提取
// 测试站点：skillhub.cn 下载热榜

const RELAY_URL = 'http://127.0.0.1:3459';
const BASE = 'https://skillhub.cn';

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log('  ' + title);
  console.log('='.repeat(60));
}

async function main() {
  // 确认 relay 可用
  const status = await (await fetch(`${RELAY_URL}/api/status`)).json();
  if (!status.extensionConnected) {
    throw new Error('Extension not connected to relay');
  }
  console.log('[Test] Relay + Extension OK');

  // 打开 skillhub 下载热榜
  const tab = await relayCall('tab.create', { url: BASE, active: false });
  console.log('[Test] tab id =', tab.id);
  await sleep(3000);

  // 点击"下载热榜" tab
  const matches = await relayCall('page.search', { tabId: tab.id, query: '下载热榜' });
  const tabRef = matches.find(e => e.role === 'tab' && e.text.includes('下载热榜'));
  if (!tabRef) throw new Error('Tab not found');
  await relayCall('page.click', { tabId: tab.id, ref: tabRef.ref });
  await sleep(2000);

  // ====================================================================
  // 阶段 1：page.getText 理解页面结构
  // ====================================================================
  section('阶段 1: page.getText 理解页面结构');
  const text = await relayCall('page.getText', { tabId: tab.id, maxChars: 5000 });
  console.log('[getText] 前 800 字符：');
  console.log(text.content.slice(0, 800));
  console.log('\n[getText] 总长度:', text.content.length, '字符');

  // ====================================================================
  // 阶段 2：page.eval 用 DOM 选择器直接定位元素，拿 textContent
  // ====================================================================
  section('阶段 2: page.eval + DOM 选择器提取（无 regex）');

  // 思路：
  // 1. 找到所有技能卡片 (a[href^="/skills/"])
  // 2. 对每个卡片：用 DOM 位置/结构定位名字、下载量所在元素
  // 3. 直接拿 textContent，不解析
  const EXTRACT_DOM_JS = `
JSON.stringify(
  Array.from(document.querySelectorAll('a[href^="/skills/"]'))
    .filter(a => /\\/skills\\/[^\\/?#]+/.test(a.getAttribute('href') || ''))
    .map(a => {
      // 名字：直接拿 aria-label，不解析
      const ariaLabel = a.getAttribute('aria-label') || '';
      // 名字：也取 link 的 textContent（去掉下载量数字）
      const linkText = a.textContent;

      // 下载量：找 card 内的所有 span，遍历找下载量所在位置
      // 不正则匹配，而是看 span 的 textContent 能否 parseFloat
      const spans = Array.from(a.querySelectorAll('span'));
      let downloadEl = null;
      let downloadValue = '';
      let downloadUnit = '';
      for (const sp of spans) {
        const t = sp.textContent.trim();
        // 找 "X.X" 或 "X" 这种纯数字（可能是下载量数字部分）
        // 跳过 aria-label 等
        if (/^[\\d.]+$/.test(t) && !sp.querySelector('span')) {
          // 检查这个 span 的兄弟或父元素有没有单位
          const parent = sp.parentElement;
          const parentText = parent ? parent.textContent.trim() : '';
          // 父元素文本包含 万/千/次 等单位，说明这是下载量
          if (/[万亿次Kk]/.test(parentText)) {
            downloadEl = sp;
            downloadValue = t;
            // 从父元素文本中找单位
            const unitMatch = parentText.match(/[万亿次Kk]/);
            if (unitMatch) downloadUnit = unitMatch[0];
            break;
          }
        }
      }

      // 描述：找第一个长度 > 10 的 p
      const desc = Array.from(a.querySelectorAll('p'))
        .map(p => p.textContent.trim())
        .find(t => t.length > 10) || '';

      return {
        name: ariaLabel || linkText.slice(0, 50),
        ariaLabel,
        downloadValue,
        downloadUnit,
        downloadCombined: downloadValue + (downloadUnit ? ' ' + downloadUnit : ''),
        href: a.getAttribute('href'),
        desc: desc.slice(0, 100),
        // 调试：前 3 个 span 的 textContent
        firstSpans: spans.slice(0, 5).map(s => s.textContent.trim().slice(0, 30))
      };
    })
    .filter(item => item.name && item.href)
    .slice(0, 5)
)
`;

  const domResult = await relayCall('page.eval', { tabId: tab.id, code: EXTRACT_DOM_JS });
  const items = JSON.parse(domResult);
  console.log('[DOM 提取] 前 5 条结果：');
  for (const it of items) {
    console.log(`\n  名字: ${it.name}`);
    console.log(`  aria-label: ${it.ariaLabel}`);
    console.log(`  下载量: ${it.downloadCombined} (value=${it.downloadValue}, unit=${it.downloadUnit})`);
    console.log(`  href: ${it.href}`);
    console.log(`  描述前 100 字符: ${it.desc.slice(0, 100)}`);
    console.log(`  前 5 个 span: ${JSON.stringify(it.firstSpans)}`);
  }

  // ====================================================================
  // 阶段 3：评估 DOM 提取的健壮性
  // ====================================================================
  section('阶段 3: 评估健壮性');

  const withDownloads = items.filter(i => i.downloadValue).length;
  console.log(`[评估] ${items.length} 条中，${withDownloads} 条成功提取下载量（DOM 位置定位）`);

  if (withDownloads === items.length) {
    console.log('[评估] ✓ DOM 选择器方案工作良好，无需 regex');
  } else if (withDownloads > items.length / 2) {
    console.log('[评估] ⚠ 部分成功，可能需要混合策略');
  } else {
    console.log('[评估] ✗ DOM 方案失败，需要重新理解结构');
  }

  await relayCall('tab.close', { tabId: tab.id });
  console.log('\n[Test] Done');
}

main().catch(e => {
  console.error('[Test] FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
