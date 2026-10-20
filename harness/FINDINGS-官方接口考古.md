# DSH Web 客户端「把某个会话变成当前显示会话」的官方入口 — 只读代码考古

- 时间：2026-10-19
- 范围：只读。未修改安装目录、未碰 `~/.dsh/`、未联网。
- asar：`<用户目录>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`（内容根 `dsh/`）
- 抽取目录：`<用户目录>\AppData\Local\Temp\dsh-session-recon\`

---

## 结论

**能。走 (a) 服务方法：`ctx.get("uiWorkspace").openSession(sessionId)`（或 `ctx.uiWorkspace.openSession(sessionId)`）。**

- 这是官方唯一「以 sessionId 切换当前显示会话」的服务入口，同步、立即生效，不依赖 DOM。
- 它不是新插件私有的：官方自己就有两个包（`ui-chat`、`ui-subagent`）在**别的包里**调用它，跨包调用是被认可的用法。
- URL 路由通道 **(b) 未找到**：Web 前端主 bundle 里没有任何 URL/query/hash 路由 token。
- 该调用**没有** `remoteAccess` 权限门禁（唯一被门禁的是 `session/fork` 菜单项）。

---

## 证据（分层：实测 > 代码事实 > 推断）

### 代码事实（服务与实现）

- `dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1360` →
  `var UiWorkspaceService = class extends _deepseek_ai_cordis.Service {`
- 同文件 `:1380` → `super(ctx, "uiWorkspace");`
  （服务在 **client root Context** 上以名字 `uiWorkspace` 注册 → 任何拿到 ctx 的客户端插件可 `ctx.get("uiWorkspace")` / `ctx.uiWorkspace`）
- 同文件 `:1470-1472` →
  ```
  openSession(target) {
      this.replaceMain(target, this.lifetime.signal, "reveal");
  }
  ```
- 同文件 `:1651-1674` `replaceMain`（真正的切换动作）→
  ```
  1653: const reference = this.sessions.retain(target, { source: "mainView" });
  1662: this.selection.set({
  1663:     sessionId: reference.sessionId,
  1664:     ...subagentAddress === void 0 ? {} : { subagentAddress }
  1665: });
  1670: const previous = this.mainReference;
  1671: this.mainReference = reference;
  1672: previous?.release();
  1673: if (panel === "reveal") this.ctx.layout.selectPanel(null);
  ```
  即：retain 目标会话为 `mainView` → 写入 selection → 释放上一个 → 让主区域回到 Conversation 面板。
- 同文件 `:1369`（当前会话状态通道，持久化在浏览器本地）→
  `selection = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({}, { persist: { name: "dsh.sessions.current" } });`
- 同文件 `:1661` → `const subagentAddress = typeof target === "string" ? this.sessions.subagentAddress(reference.sessionId) : target;`
  （target 可以是字符串 sessionId，也可以是持久的直接父子 subagent 地址对象）
- 同文件 `:1397` 起公开方法：`connectWorkspace` / `openSession` / `openWorkspace` / `forkSession` / `startSession` / `archiveSession` / `unarchiveSession` / `pinSession` / `unpinSession`
- 官方契约文档 `dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/README.zh.md:74` →
  「`ctx.uiWorkspace.openSession(target)` 会同步替换其拥有的 `mainView` reference，并让主区域返回 Conversation，而不等待 `reference.ready`……目标可以是已知 Session id，也可以是持久的直接父子 subagent 地址」
- 侧栏会话行走的正是这条路（**不是**直接操作 DOM）：同文件
  - `:5063-5065` → `const openSession = (sessionId) => { uiWorkspace.openSession(sessionId); };`
  - `:5179-5184` → `browserInjected = () => ({ startSession: …, open: openSession, searchSessions, … })`
  - 该 inject face 被注册到 `sidebar.workspaces` 的 slot 上（`:5230-5295` 一批 `inject: …` 注册项）

### 代码事实（跨包调用先例 = 第三方插件可用的最有力证据）

- `dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js:13279` →
  `ctx.uiWorkspace.openSession(childId);`
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js:966` →
  `ctx.uiWorkspace.openSession(address);`
  （同文件 `:961` 是标准的等待式注入写法：`ctx.inject(["resources", "sidebarRightTabs"], (scope) => { … })`）
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js:969-972` → 另有「不切换主视图、改在右侧栏打开子会话」的旁路：
  `ctx.sidebarRight.openResource(subagentChatAddress(address), { kind: "subagentchat", preferNewPane: true })`

### 代码事实（访问控制 / 能否 `ctx.get`）

- `ui-workspace` 自己的依赖声明 `:5002-5012` →
  ```
  const inject = [
      "slots", "sessions", "workspaces", "locale", "remote",
      "remote.directoryPicker", "layout", "shortcuts", "remoteAccess"
  ];
  ```
  它 `:5020-5021` 用 `ctx.get("sessions")` / `ctx.get("workspaces")` 取依赖。
- `openSession` → `replaceMain` 内部**没有**任何 `remoteAccess` / `useSessionAccess` 判定（`replaceMain` 全文 1651-1674 无权限分支）。
- 全文件唯一的会话级门禁在 UI 层而非服务层：`:4313-4316` →
  ```
  function ForkSessionMenuItem({ sessionId, useMenuOpenState, useShortcuts, useSessionAccess, forkSession, t }) {
      if (!useSessionAccess(sessionId, "session/fork")) return null;
  ```
  `remoteAccess` 在该包里只用于 `:5041` 的 `workspaceAccess` keyed hook。
- 结论：**服务方法层无权限拦截**；插件能不能拿到服务取决于 Cordis 注入时机，不取决于权限。

### 实测（我跑过的命令与输出要点）

- `node asar-tool.mjs extract "dsh/node_modules/@deepseek-ai/dsh-client-ui-(sidebar-browser|sidebar)/" <recon>` → `extracted 18 files`
- `node asar-tool.mjs extract "dsh/node_modules/@deepseek-ai/dsh-client-ui-(ui-chat|ui-workspace)/" …` → 抽取成功
- 跨包检索 `Select-String 'uiWorkspace\.'` 输出：
  `ui-chat\lib\client.js :13281: ctx.uiWorkspace.openSession(childId);`
  `ui-subagent\lib\client.js :966: ctx.uiWorkspace.openSession(address);`
- URL 路由检索（对 `dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-CN7NIWNw.js`，921,071 字节，UTF-8 全文正则计数）：
  `pushState -> 0 ｜ replaceState -> 0 ｜ URLSearchParams -> 0 ｜ location\.hash -> 0 ｜ [?&]session= -> 0 ｜ #/session -> 0 ｜ /session/ -> 0`
  （该 bundle 为 Web 壳层；`__DSH_BOOT__ -> 1` 命中，证实拿到的是真实前端产物而不是占位文件）

### 推断（明确标注）

- **推断**：第三方插件用 `inject: ['slots','locale','uiWorkspace']`（或 `ctx.inject(['uiWorkspace'], scope => …)`）应能拿到服务；我**没有**在 asar 里找到一个「第三方/外部包」这样声明的样本，u`i`-chat/ui-subagent 是官方包。若注入声明被拒，退路是 `ctx.get("uiWorkspace")`（可能因提供者尚未激活而为 undefined，需自己重试/等待）。
- **推断**：`ctx.get("uiWorkspace")` 调用时机必须晚于 ui-workspace 包的 `apply`（`:5036` 构造服务）。在 slot 的 `inject` factory 里调用是安全的（README 明说 inject factory 可闭包使用插件已声明的 Cordis service）。
- **推断**：URL 路由结论基于**主 bundle** 一个文件的正则计数；`vendor-DcuzkuQH.js`（741,114 字节）**未检索**（工具预算），故「未找到」的强度是「主 bundle 内未找到」，不是「整站绝对不存在」。
- **推断**：DOM 兜底可行但脆弱——侧栏行是 React 按钮、`onClick` 由 React 事件委托处理，`element.click()` 通常能触发，但依赖 DOM 结构与 React 版本，官方明确把行行为放在 inject face 里，未承诺 DOM 稳定。

---

## 三类入口的结论

| 类别 | 结论 | 关键证据 |
|---|---|---|
| **(a) 服务方法** | **可用，推荐**：`ctx.uiWorkspace.openSession(sessionId)` | `ui-workspace/lib/client.js:1380, 1470, 1651-1674`；跨包先例 `ui-chat:13279`、`ui-subagent:966` |
| **(b) URL 路由 / query** | **未找到**：主前端 bundle 无 `pushState/replaceState/URLSearchParams/location.hash`，亦无 `?session=` / `#/session` / `/session/` | 实测正则计数全为 0（`index-CN7NIWNw.js`） |
| **(c) DOM 兜底** | 理论可行但不推荐；官方未把行点击当作公开契约 | 侧栏行 `onClick` 在 `ui-sidebar/lib/client.js:184-185, 478-480`（那是**面板**选择）；会话行点击走 inject face `ui-workspace:5063/5183` |

补充：`ui-sidebar` 里的 `selectPanel(id)` → `ctx.layout.selectPanel(id)` 是**切换主面板**（Conversation/全局面板），不是切换会话；`layout.selectPanel(null)` 恰好是返回 Conversation，故 `openSession` 尾部会调用它。

---

## 给插件作者的具体做法建议

**可行。** 用服务方法，别碰 DOM、别指望 URL。

```js
// ESM，DSH web 客户端插件（client half），运行在 DSH 前端页面里
// 抽取路径示例：
//   @deepseek-ai/dsh-client-ui-workspace/lib/client.js
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client' // 纯类型 import：带上 uiWorkspace 的类型与 SlotMap 声明

export const inject = ['slots', 'locale', 'uiWorkspace'] // 需求推荐写法（推断项，见上）

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('acme.sessionJump', {
    en: { jump: 'Open this session' },
    zh: { jump: '打开这个会话' },
  }), 'acme-session-jump: dictionaries')

  // 在侧栏会话行菜单里加一项：props 直接给到 sessionId + displayTitle
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.menu.item',
    id: 'acme.session-jump',
    order: 600,                     // 官方自带项到 550（复制 Session ID），600 排在其后
    locale: 'acme.sessionJump',
    inject: () => ({
      jumpToSession: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
    }),
  }, function JumpRow({ sessionId, useMenuOpenState, jumpToSession, t }) {
    const [, setOpen] = useMenuOpenState()
    return React.createElement('button', {
      role: 'menuitem',
      onClick: () => { setOpen(false); jumpToSession(sessionId) },
    }, t('jump'))
  }))
}
```

调用序列（切会话）：

1. 拿到 `sessionId`（字符串；或持久 subagent 地址对象）。
2. `ctx.uiWorkspace.openSession(sessionId)`
   → 内部 `replaceMain`：`sessions.retain(target, {source:'mainView'})` → `selection.set({sessionId})`（持久化键 `dsh.sessions.current`）→ release 旧 reference → `layout.selectPanel(null)`（主区域回 Conversation）。
3. 同步返回 `void`，**立即**切换；历史加载会显示在已选中的会话视图内（README:74）。异常路径：目标会话不存在/不合法时 `retain` 抛错（`replaceMain` 的成功分支只保留在无异常时），建议 `try/catch` 并给用户提示。

**要抓的风险（替插件作者想好的）**

- 不要用 URL 方案：官方前端没有会话路由，改 URL 不会切会话（实测为 0 命中），还会污染浏览器历史。
- 不要在 `apply` 顶层同步调用 `ctx.get('uiWorkspace')`：服务由 ui-workspace 的 `apply` 时构造（`client.js:5036`），时机早于它时拿到 undefined；放在 slot 的 `inject` factory 或 `ctx.inject([...], scope => …)` 回调里最稳。
- `openSession` 会**释放**上一个会话的 mainView retain（`previous?.release()`）。若插件的其它功能依赖「某会话仍被主视图保留」，切走会使该假设失效（`retainedBy.mainView` 归零）。
- 归档会话不能打开：官方 `openForkSource` 路径会先拦住并提示（`:5165-5171`）。插件若要跳转，建议先查 `workspaces.list` 的 `archivedSessionIds`，否则可能白跳或报错。

---

## 现成机制记录（问题 4、5）

**已读/未读、行内跳转类机制（代码事实）**

- 会话行有状态标记：`pendingInteraction` / 已完成未查看（done） / idle 点；「待处理交互」优先于共享 ongoing loading（`ui-workspace/README.zh.md` 待处理交互、活动 Schedule 标识两节）。
- 行内已有两个插件扩展 seat：`sidebar.session.row.leading`（仅 idle 时渲染）、`sidebar.session.row.hover`（悬停卡片打开时挂载），两者只接收行的 Session 身份。
- 行菜单 / 行尾悬停按钮是可扩展 slot：`sidebar.workspaces.session.menu.item`、`sidebar.workspaces.session.row.action`；官方自带项 `pin(100/200)`、`rename(300)`、`fork(400)`、`archive(400/100)`、`session-id(550)`。
- **注意**：官方 `session-id` 项（order 550）只做「复制完整 Session ID」，**不导航**（README.zh.md：点击后关闭菜单并直接复制完整 ID，不打开对话框）。即「行内自带跳转」不存在，只有「行内自带复制 ID」。

**把 sessionId 放进通知并跳转的官方先例（问题 5）**

- 有，且是官方的：`ui-workspace/lib/client.js:5160-5172` →
  ```
  registerToasts(ctx, viewStore, {
      undoArchive: unarchiveSession,
      showArchived: () => { viewInstance.actions.setArchivedFilter("show"); },
      openForkSource: (sessionId) => {
          if (workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)) {
              notify({ kind: "archivedNotOpenable" });
              return;
          }
          openSession(sessionId);      // ← 通知里的 action 用 sessionId 跳转
      }
  });
  ```
  且 `:5096-5103` 归档成功的 toast 载荷里就带了 `sessionId`：`notify({ kind: "archived", sessionId })`。
- 另存在 `dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/notifier.js`（3,078 字节）—— **未读取**，无法断言其内容（见「未确认」）。

---

## 未确认 / 未做

1. `dsh-api-session-controller/lib/types/client/sessions/notifier.js` 未读（会话通知器类型），其中是否已有「通知 → 跳会话」的标准载荷字段**未确认**。
2. `dsh-web-frontend/dist/assets/vendor-DcuzkuQH.js`（741 KB）未检索 → URL 路由「未找到」的强度限于主 bundle。
3. 未在 asar 内找到**第三方**插件用 `inject: ['…','uiWorkspace']` 声明注入的样本 → 「第三方能否注入声明成功」是推断，未实测。
4. 未做运行时实测（本任务只读、禁网、不允许改配置，且未启动/连接 Web 前端做 DOM 验证）。
5. 未查 `dsh-notifier` 之外的独立通知插件包：asar 内不存在名为 `dsh-notifier` 的包（`list "notifier"` 仅命中上面那个 types 文件）。

---

## 证据文件清单（绝对路径）

asar 内原始路径（已定位，未修改）：

- `dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/README.zh.md`
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js`
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js`
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js`
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/README.md`
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-session/lib/client.js`、`README.zh.md`
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js`
- `dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-CN7NIWNw.js`（正则计数用）
- `dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/notifier.js`（未读）

本机抽取副本（可复查）：

- `<用户目录>\AppData\Local\Temp\dsh-session-recon\node_modules\@deepseek-ai\dsh-client-ui-workspace\lib\client.js`
- `<用户目录>\AppData\Local\Temp\dsh-session-recon\node_modules\@deepseek-ai\dsh-client-ui-workspace\README.zh.md`
- `<用户目录>\AppData\Local\Temp\dsh-session-recon\node_modules\@deepseek-ai\dsh-client-ui-chat\lib\client.js`
- `<用户目录>\AppData\Local\Temp\dsh-session-recon\x\node_modules\@deepseek-ai\dsh-client-ui-subagent\lib\client.js`
- `<用户目录>\AppData\Local\Temp\dsh-session-recon\node_modules\@deepseek-ai\dsh-client-ui-sidebar\lib\client.js`
- `<用户目录>\AppData\Local\Temp\dsh-session-recon\node_modules\@deepseek-ai\dsh-client-ui-sidebar-browser\lib\client.js`
- `<用户目录>\AppData\Local\Temp\dsh-session-recon\node_modules\@deepseek-ai\dsh-client-ui-layout\lib\client.js`
- `<用户目录>\AppData\Local\Temp\dsh-session-recon\wf\node_modules\@deepseek-ai\dsh-web-frontend\dist\assets\index-CN7NIWNw.js`
- `<用户目录>\AppData\Local\Temp\notifier-recon\node_modules\@deepseek-ai\dsh-client-ui-conversation\lib\client.js`
- `<用户目录>\AppData\Local\Temp\asar-tool.mjs`（读取器）
