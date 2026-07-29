# wc3 — Chrome Web Store 上架文案（可直接复制到表单）

---

## 1. 名称 / Name（≤45 字符）

wc3 — Browser Automation Endpoint

> 中文商店可用：wc3 浏览器自动化执行器

---

## 2. 简短描述 / Summary（≤132 字符，显示在搜索结果）

Let AI drive your browser: open pages, click, type, reply, chat and scrape.
It runs the repetitive web work while you grab a coffee.

---

## 3. 详细描述 / Detailed description

wc3 turns your browser into an automation endpoint you fully control.

It connects to a small relay service that you run yourself on your own
computer, receives operation commands, and executes them in Chrome using the
standard browser APIs — opening and grouping tabs, clicking elements, typing
and replying, reading page structure, and extracting information.

Because the relay runs locally on your machine (loopback 127.0.0.1), your
browsing data stays with you. wc3 has no analytics, no ads, and sends nothing
to a remote server operated by us.

What you can do with it:
- Automate repetitive web tasks (form filling, posting, replying, chatting)
- Read a page's accessibility structure to reliably locate elements
- Open, focus and organize tabs into groups
- Scrape and collect information from pages you direct it to

wc3 is the L0 execution layer of the webclaw3 project. You need to run the
local relay to use it; the extension by itself is the browser-side executor.

Privacy policy: https://fatmind.github.io/wc3-chrome/privacy-policy.html
Source / docs: https://github.com/fatmind/wc3-chrome

---

## 4. 分类 / Category

Developer Tools （开发者工具）

## 5. 语言 / Language

English（主）；可加 Chinese (Simplified)

---

## 6. 权限逐条理由 / Permission justifications
（Chrome 后台会要求为每个权限填写用途，逐条抄下面）

**tabs**
Required to open, focus, query and organize browser tabs, which is core to
executing browser-automation commands the user requests.

**tabGroups**
Used to group related automation tabs together so the user can visually track
which tabs an automation session is operating on.

**scripting**
Required to inject content scripts that read the page's accessibility structure
and perform actions such as clicking and typing on the user's behalf.

**storage**
Stores local connection settings and extension state (e.g. relay connection
info) in the browser. No personal browsing data is stored.

**alarms**
Keeps the MV3 background service worker responsive and schedules reconnection
attempts to the local relay so automation sessions stay reliable.

**declarativeNetRequest**
Adjusts network request rules where needed to allow the requested automation to
run on target pages. It is not used for tracking or ad blocking.

**host_permissions: <all_urls>**
Browser automation must be able to operate on whatever page the user directs it
to, which cannot be predicted in advance. The extension only reads and acts on
pages the user is actively automating; it does not passively collect data from
other pages.

---

## 7. 数据用途声明 / Data usage disclosures
（Privacy practices 页需勾选/声明）

- Does the extension collect user data? → 只声明实际用到的：
  - "Website content" — used **only** to execute the automation the user
    requests, processed locally, **not** sold or transferred to third parties.
- 勾选三项合规声明：
  - [x] 不出售数据给第三方
  - [x] 不将数据用于与核心功能无关的用途
  - [x] 不用于判断信用/放贷
- Remote code: **No**（所有代码打包在扩展内，不远程加载）

---

## 8. 单一用途说明 / Single purpose（表单必填一句话）

wc3 is a browser-automation execution endpoint: it receives commands from a
user-run local relay and performs browser actions (navigate, click, type,
read, scrape) on the user's behalf.
