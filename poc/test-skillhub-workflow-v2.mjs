// poc/test-skillhub-workflow-v2.mjs
// 改进版：getText 理解结构 → DOM 位置定位下载量 → 简单 split 处理
// 核心思路：下载量始终在 card 内**最后 1-2 个 span**，直接取 textContent

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
  const status = await (await fetch(`${RELAY_URL}/api/status`)).json();
  if (!status.extensionConnected) throw new Error('Extension not connected');
  console.log('[Test] Relay + Extension OK');

  const tab = await relayCall('tab.create', { url: BASE, active: false });
  await sleep(3000);

  // 点击"下载热榜" tab
  const matches = await relayCall('page.search', { tabId: tab.id, query: '下载热榜' });
  const tabRef = matches.find(e => e.role === 'tab' && e.text.includes('下载热榜'));
  if (!tabRef) throw new Error('Tab not found');
  await relayCall('page.click', { tabId: tab.id, ref: tabRef.ref });
  await sleep(2000);

  // ====================================================================
  // 阶段 1: page.getText 理解结构
  // ====================================================================
  section('阶段 1: page.getText 理解页面结构');
  const text = await relayCall('page.getText', { tabId: tab.id, maxChars: 3000 });
  // 找到下载热榜 tab 内容区域
  const tabContent = text.content.split('为你推荐')[1] || text.content;
  console.log('[getText] 下载热榜区前 600 字符：');
  console.log(tabContent.slice(0, 600));
  console.log('\n[观察] 每条记录格式：name + 数字 + 万/千/次');
  console.log('[观察] 从 getText 看出：下载量是 "X.X 万" 格式，紧跟在 name 后面');

  // ====================================================================
  // 阶段 2: page.eval + DOM 位置定位（核心改进）
  // ====================================================================
  section('阶段 2: page.eval + DOM 位置定位（取最后一个 span）');

  // 思路：下载量 span 始终是 card 内最后一个（或最后两个之一）span
  // 直接拿 textContent，不用 regex
  const EXTRACT_V1 = `
JSON.stringify(
  Array.from(document.querySelectorAll('a[href^="/skills/"]'))
    .filter(a => /\\/skills\\/[^\\/?#]+/.test(a.getAttribute('href') || ''))
    .map(a => {
      const spans = Array.from(a.querySelectorAll('span'));
      const lastSpan = spans[spans.length - 1];
      const lastSpanText = lastSpan ? lastSpan.textContent.trim() : '';

      // 名字：aria-label (去掉"查看"和"详情")
      const ariaLabel = a.getAttribute('aria-label') || '';
      const name = ariaLabel.replace(/^查看\\s*/, '').replace(/\\s*详情$/, '').trim();

      // 描述：第一个长度 > 10 的 p
      const desc = Array.from(a.querySelectorAll('p'))
        .map(p => p.textContent.trim())
        .find(t => t.length > 10) || '';

      return {
        name,
        href: a.getAttribute('href'),
        downloadRaw: lastSpanText,
        desc: desc.slice(0, 80),
        spanCount: spans.length
      };
    })
    .filter(item => item.name && item.href)
    .slice(0, 8)
)
`;

  const r1 = await relayCall('page.eval', { tabId: tab.id, code: EXTRACT_V1 });
  const items1 = JSON.parse(r1);
  console.log('[V1 - 取最后一个 span] 前 8 条：');
  items1.forEach((it, i) => {
    console.log(`  ${i+1}. ${it.name} → 下载量="${it.downloadRaw}" (${it.spanCount} spans)`);
  });

  const allHaveDl = items1.every(it => it.downloadRaw && /\\d/.test(it.downloadRaw));
  console.log(`\n[评估] ${items1.length} 条全部含数字下载量: ${allHaveDl ? '✓' : '✗'}`);

  // ====================================================================
  // 阶段 3: 简单 split 处理（替代 regex）
  // ====================================================================
  section('阶段 3: 简单字符串处理（split，替代 regex）');

  // 拿到 "99.7 万" 后，只需 split(' ') 即可，无 regex
  const EXTRACT_V2 = `
JSON.stringify(
  Array.from(document.querySelectorAll('a[href^="/skills/"]'))
    .filter(a => /\\/skills\\/[^\\/?#]+/.test(a.getAttribute('href') || ''))
    .map(a => {
      const spans = Array.from(a.querySelectorAll('span'));
      const lastSpan = spans[spans.length - 1];
      const raw = lastSpan ? lastSpan.textContent.trim() : '';

      // 分割 "X.X 万" → ["X.X", "万"]
      const parts = raw.split(/\\s+/);
      const value = parts[0] || '';
      const unit = parts[1] || '';

      const ariaLabel = a.getAttribute('aria-label') || '';
      const name = ariaLabel.replace(/^查看\\s*/, '').replace(/\\s*详情$/, '').trim();

      return {
        name,
        href: a.getAttribute('href'),
        dlValue: value,
        dlUnit: unit,
        dlCombined: raw
      };
    })
    .filter(item => item.name && item.href)
    .slice(0, 8)
)
`;

  const r2 = await relayCall('page.eval', { tabId: tab.id, code: EXTRACT_V2 });
  const items2 = JSON.parse(r2);
  console.log('[V2 - split 拆分值和单位] 前 8 条：');
  items2.forEach((it, i) => {
    console.log(`  ${i+1}. ${it.name} → ${it.dlValue} ${it.dlUnit} (原始: "${it.dlCombined}")`);
  });

  // ====================================================================
  // 阶段 4: 健壮性测试 - 切换到"最近上新" tab
  // ====================================================================
  section('阶段 4: 健壮性测试 - 切换到"最近上新" tab');

  const matches2 = await relayCall('page.search', { tabId: tab.id, query: '最近上新' });
  const tab2Ref = matches2.find(e => e.role === 'tab' && e.text.includes('最近上新'));
  await relayCall('page.click', { tabId: tab.id, ref: tab2Ref.ref });
  await sleep(2000);

  const r3 = await relayCall('page.eval', { tabId: tab.id, code: EXTRACT_V1 });
  const items3 = JSON.parse(r3);
  console.log('[最近上新 tab] 前 5 条：');
  items3.forEach((it, i) => {
    console.log(`  ${i+1}. ${it.name} → 下载量="${it.downloadRaw}" (${it.spanCount} spans)`);
  });

  const allHaveDl3 = items3.every(it => it.downloadRaw && /\\d/.test(it.downloadRaw));
  console.log(`\n[评估] "最近上新" ${items3.length} 条全部含下载量: ${allHaveDl3 ? '✓' : '✗'}`);

  // ====================================================================
  // 阶段 5: 兜底方案 - 如果最后一span不是下载量怎么办
  // ====================================================================
  section('阶段 5: 兜底 - 遍历所有 span 找含下载量的那个');

  // 找所有 span，遍历找 textContent 包含 "X.X 万/千/次" 的
  // 这里允许最后用一次 regex，但范围已经缩到单 span
  const EXTRACT_V3 = `
JSON.stringify(
  Array.from(document.querySelectorAll('a[href^="/skills/"]'))
    .filter(a => /\\/skills\\/[^\\/?#]+/.test(a.getAttribute('href') || ''))
    .map(a => {
      const spans = Array.from(a.querySelectorAll('span'));
      // 找包含下载量格式的 span（最后一道防线，允许用 regex）
      let downloadSpan = null;
      for (const sp of spans) {
        const t = sp.textContent.trim();
        // 在单 span 的小范围内用 regex 是健壮的
        if (/^[\\d.]+\\s*[万亿次Kk]$/.test(t)) {
          downloadSpan = sp;
          break;
        }
      }
      const raw = downloadSpan ? downloadSpan.textContent.trim() : '';
      const ariaLabel = a.getAttribute('aria-label') || '';
      const name = ariaLabel.replace(/^查看\\s*/, '').replace(/\\s*详情$/, '').trim();
      return { name, dl: raw, found: !!downloadSpan };
    })
    .filter(item => item.name)
    .slice(0, 8)
)
`;

  // 先切回下载热榜
  await relayCall('page.click', { tabId: tab.id, ref: tabRef.ref });
  await sleep(2000);

  const r4 = await relayCall('page.eval', { tabId: tab.id, code: EXTRACT_V3 });
  const items4 = JSON.parse(r4);
  console.log('[V3 - 兜底+regex 定位下载 span] 下载热榜前 8 条：');
  items4.forEach((it, i) => {
    console.log(`  ${i+1}. ${it.name} → "${it.dl}" ${it.found ? '✓' : '✗ 未找到'}`);
  });

  // 切到最近上新再测
  await relayCall('page.click', { tabId: tab.id, ref: tab2Ref.ref });
  await sleep(2000);
  const r5 = await relayCall('page.eval', { tabId: tab.id, code: EXTRACT_V3 });
  const items5 = JSON.parse(r5);
  console.log('[V3 - 兜底+regex 定位下载 span] 最近上新前 8 条：');
  items5.forEach((it, i) => {
    console.log(`  ${i+1}. ${it.name} → "${it.dl}" ${it.found ? '✓' : '✗ 未找到'}`);
  });

  await relayCall('tab.close', { tabId: tab.id });
  console.log('\n[Test] Done');
}

main().catch(e => {
  console.error('[Test] FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
