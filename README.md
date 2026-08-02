# wc3-chrome

> webclaw3 平台的 L0 浏览器插件，浏览器操作的执行端：通过 WebSocket 接受 relay 转发的 op 指令，调 `chrome.*` API 操作真实 Chrome。

---

## 角色

`wc3-chrome` 是 webclaw3 架构的 L0 层——**浏览器插件本身**。它被 `webclaw3`（L1 skill）以及 dist 出的业务 skill 经 relay 调用。

它只是 Chrome 扩展，**不含 relay、不含任何 Node 进程**。连接它（HTTP↔WS 桥接 relay、CDP 代理、启停脚本）的连接层住在 `webclaw3/scripts/`，属于 webclaw3 的组成部分。二者关系：**插件在 wc3-chrome，连接插件的手臂在 webclaw3**。

架构位置与分层关系见 [webclaw3 主设计文档](https://github.com/fatmind/webclaw3/blob/main/spec/webclaw3_design.md) 的「分层」节。

> **发布状态**（2026-07）：本目录目前作为 webclaw3 主仓的**普通子目录**存在，内容 = 纯扩展（`extension/` + `poc/`）。计划在 GitHub 创建独立仓库 `fatmind/wc3-chrome` 后改为 submodule 引用；发布物就是这个扩展，**不含连接脚本**。本 README 同时作为独立仓库的发布版复用。

---

## 目录结构

```
wc3-chrome/
├── README.md                       本文件
├── package.json
├── extension/                      Chrome 扩展（MV3，v0.6.0）
│   ├── manifest.json
│   ├── background.js               service worker：WS 连接、消息路由、Tab Group、visual indicator
│   ├── accessibility-tree.js       content script：aria tree + ref_N 寻址
│   ├── page-bridge.js              content script：6 个静态 op + React InputEvent
│   ├── visual-indicator.js         content script：shadow DOM UI
│   └── icons/                      icon.png
└── poc/                            验证脚本（relay 连通性、真实站点、CSP 绕过等）
```

> relay / cdp-proxy / webclaw3 等连接进程**不在这里**，在 `webclaw3/scripts/`。

---

## 启动方式

**加载扩展**：Chrome 开发者模式加载 `wc3-chrome/extension/`（一次即可）。

**启动连接它的 relay**：由 webclaw3 的连接层提供，经 `webclaw3`（位于 `webclaw3/scripts/webclaw3.mjs`）启停：

```bash
webclaw3 start     # 后台启动 relay，端口 3459
webclaw3 status    # 检查端口监听 + 扩展 active
webclaw3 stop      # 杀进程
webclaw3 restart   # stop + start
```

---

## API

启动后 relay 监听 `127.0.0.1:3459`：

| Endpoint | Method | 说明 |
|---|---|---|
| `/api/call` | POST | 调扩展操作（tab.create、page.eval、page.click 等），body: `{op, params, timeout}` |
| `/api/status` | GET | 健康检查，body: `{extensionConnected, wsClients, ...}` |

调用方（skill）只通过 HTTP 调 relay，**不**直接连 WebSocket。WebSocket 是 relay ↔ 扩展之间的内部协议。

详细 API 列表见 [spec/extension-relay-design.md](https://github.com/fatmind/webclaw3/blob/main/spec/extension-relay-design.md)（在 webclaw3 主仓库）。

---

## 依赖

- **Node.js 22+**（用原生 WebSocket，HTTP server）
- **Chrome 100+**（MV3 扩展要求）
- **不依赖 npm 包**（只用 Node 内置模块）

---

## 历史

- v0.5.0：从 webclaw3 仓库拆出（2026-07）。原 webclaw3 既含浏览器探索 SKILL.md（L1）又含 Chrome 扩展（L0）。拆出后：**wc3-chrome = 纯扩展（L0）**；webclaw3 = 浏览 skill（L1，SKILL.md）+ 连接层（`scripts/`：relay/cdp-proxy/webclaw3）。连接进程留在 webclaw3，因为它们是 skill 触达浏览器的手臂。

---

## License

MIT
