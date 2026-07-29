# wc3-chrome extension relay PoC

最小验证：skill 进程 → relay.mjs (WS) → Chrome 扩展 → `chrome.scripting.executeScript`。

`page.eval` 唯一路径：`chrome.scripting.executeScript`（ISOLATED world，受 page CSP 限制）。失败直接抛，不降级、不调 `chrome.debugger`，所以**不显示调试栏**。

## 跑通步骤

### 1. 装扩展

打开 Chrome：

1. 访问 `chrome://extensions/`
2. 右上角打开「**开发者模式**」
3. 点「**加载已解压的扩展程序**」
4. 选 `wc3-chrome/extension/` 目录
5. 记下扩展的 ID

### 2. 跑测试

```bash
cd /Users/bohan.sj/dev/open/webclaw3
node wc3-chrome/poc/test-relay.mjs
```

### 3. 看结果

测试脚本会跑 11 步，每步打日志：

1. 等扩展连进来
2. `tab.list`
3. 开新 tab → `https://example.com`
4. `page.eval('document.title')`
5. `page.eval('window.location.href')`
6. `page.eval('document.querySelectorAll("a").length')`
7. `page.eval` 复杂表达式（IIFE 返回对象）
8. `page.eval` 异步代码（`await fetch`，走 IIFE 包装）
9. `page.eval` 含引号/换行的字符串
10. `page.eval` 主动抛错，验证错误传播
11. `tab.close`

如果 11 步全过 → **PoC 通过**。

## 排错

**扩展连不上**：
- 看扩展「Service Worker」console（`chrome://extensions/` → 扩展卡片 → Service Worker 链接）
- 应看到 `[wc3-chrome bg] Connecting to ws://127.0.0.1:3457`

**eval 失败**：
- 唯一可能是 page CSP 禁了 unsafe-eval（极少见，普通站点都没问题）
- SW console 会打 eval 抛出的 `Refused to evaluate a string as JavaScript` 之类错误
- 真要绕过就调 `chrome.debugger`——但**当前实现不做降级**，需要用户手动加

**端口被占**：
- `lsof -i :3457`

## 文件清单

```
wc3-chrome/
├── extension/
│   ├── manifest.json        # MV3, scripting + storage + tabs + tabGroups + alarms
│   └── background.js        # SW, WS client + executeScript 唯一路径
├── scripts/
│   └── relay.mjs            # WS server + RPC client
└── poc/
    ├── README.md            # 本文件
    └── test-relay.mjs       # 11 步端到端测试
```

## PoC 范围（验证目标）

- ✅ WS 双向通信 + 心跳 + SW 重连
- ✅ `tab.list` / `tab.create` / `tab.close`
- ✅ `page.eval`（chrome.scripting.executeScript，IIFE 包装支持语句/异步）
- ✅ 异步 eval（IIFE 包装）
- ✅ 错误传播

**不在 PoC 范围**（设计里有的，PoC 暂不实现）：

- Aria tree（content script 加 `__qoderAccessibilityTree`）
- React InputEvent（受控组件 input 派发）
- Tab Group 收纳
- `chrome.tabGroups` 状态化标题
- `chrome.storage.session` 状态持久化

跑通 11 步后，下一步可以挑一个真站点（1688 / 小红书 / reddit 之一）跑真实 skill，验证反爬目标。
