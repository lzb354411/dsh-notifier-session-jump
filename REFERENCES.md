# 参考依据（REFERENCES）

> 查证时间：2026-10-19 ｜ 检索词：`dsh-notifier click notification open session`、`uiWorkspace.openSession`、`open-session`、`dsh plugin session navigation toast`、`wingsky-1 dsh-notifier 跳转`
> 用途：本方案每个关键决定都能在下表找到来源；找不到的标「我们的判断（无外部依据）」。
> 目标插件：`@wingsky-1/dsh-notifier@0.2.9`（装在 `~/.dsh/profiles/desktop`，经版本豁免生效）。

## 〇、查证范围（四层都走过了吗）

| 层 | 是否查过 | 结果 |
|---|---|---|
| ① 本机（DSH 官方安装包源码 + 已装插件源码） | ✅ | **命中 S1–S5、S8**，决定性问题全部在这里答完 |
| ② 官方（官方文档站 / 官方示例） | ✅ | 官方 README 已随包提供，即 S2、S8；无独立官方示例仓 |
| ③ 成熟开源（GitHub / npm 同类插件） | ✅ | 命中 S6（同类插件已实现同功能）、S7（上游维护状态） |
| ④ 社区（issue / 讨论） | ✅ | 命中 S7（上游 release 说明 = 事实上的社区结论） |

## 一、结论先给

- **推荐做法**：在本地已安装的 `@wingsky-1/dsh-notifier` 副本上做两处改造——① 服务端让每帧通知**多带一个「会话 ID」字段**；② 客户端在该通知被点击时调用官方接口 **`ctx.uiWorkspace.openSession(会话ID)`** 切到对应会话。补丁另存为可重放文件。
- **关键理由**：
  1. 官方**确实**提供了「用会话 ID 切到该会话」的公开接口，且官方自己的包也在跨包调用它（据 S1、S3）——**不必靠改网址、也不必靠模拟点击**。
  2. 原插件的通知管线（事件→筛选→投递→浏览器弹窗）已完整，只缺「会话 ID 一路带下去」和「点击时切会话」这两步（据 S4）——改造量小，不必另写一个插件。
- **已知风险**：
  - 上游已进入**有限维护**、维护者暂停使用 DSH，新功能暂缓（据 S7）→ **提 PR 基本不会被合并**，只能本地打补丁，插件升级后需重放。
  - 本机官方前端**没有**与会话绑定的网址路由（据 S1 实测计数为 0）→ 网上那个「用 `?session=<id>` 深链」的做法**不适用于本机这个版本**（据 S6 与本机实测的差异，见 §三）。

## 二、来源表

| # | 来源 | 类型 | 位置 / 链接 | 更新 | 它说什么 | 我们怎么用 | 许可证 |
|---|---|---|---|---|---|---|---|
| S1 | DSH 官方包 `@deepseek-ai/dsh-client-ui-workspace` | 官方源码（本机 asar） | `app.asar` → `dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1380`（`super(ctx, "uiWorkspace")`）、`:1470`（`openSession(target)`）、`:1651-1674`（`replaceMain`：retain 目标 → 写 selection → 释放旧引用 → 主区回 Conversation）；`README.zh.md` 有同一段契约文字 | 本机安装版 `0.2.1-rc.2` | **这才是官方「切到某会话」的接口**：`openSession(会话ID)`，同步、立即生效、不走网址 | 客户端点击通知时调用它 | 随 DSH 分发（非独立开源包） |
| S2 | 同上 `README.zh.md` | 官方文档 | asar → `dsh-client-ui-workspace/README.zh.md`（`openSession` 段落） | 同上 | 明确写了 `ctx.uiWorkspace.openSession(target)`「同步替换 mainView reference，让主区域返回 Conversation」，目标可为已知 Session id | 作为接口存在性的文档级背书 | 同上 |
| S3 | DSH 官方包 `ui-chat`、`ui-subagent` | 官方跨包调用先例 | asar → `dsh-client-ui-chat/lib/client.js:13279`（`ctx.uiWorkspace.openSession(childId)`）、`dsh-client-ui-subagent/lib/client.js:966`（`ctx.uiWorkspace.openSession(address)`） | 同上 | 官方自己就在**别的包里**调这个接口 → 第三方插件调用属于合法用法 | 降低「跨包调用是否合规」的不确定性 | 同上 |
| S4 | 目标插件 `@wingsky-1/dsh-notifier@0.2.9` 源码 | 代码事实（本机） | `~/.dsh/profiles/desktop/node_modules/@wingsky-1/dsh-notifier/lib/client.js:3390-3399`（`new Notification(...)`；`onclick` 只有 `window.focus()` + `close()`）、`lib/index.js:8966-8977`（`buildFrame` 只放 `pop/sound/whenVisible/title/body/severity`）、`lib/server/api/impl/stream/type.d.ts`（`StreamEvent` 无会话 ID 字段） | 已装版本 0.2.9 | **通知里根本不带会话 ID**；点击只做「把窗口拉到前台」。这就是「只能通知、不能跳转」的根因 | 改造点 ①：帧里加会话 ID；②点击里加切会话 | MIT |
| S5 | DSH 官方包 `@deepseek-ai/dsh-agent` | 官方源码（本机 asar） | asar → `dsh-agent/lib/index.js` `enter()`：`const id = agent.id; if (id !== agent.session.id) throw ...` | 本机安装版 | **agent 的 id 就是会话 id**（官方自己强制校验二者相等） | 服务端直接拿 `payload.agent.id` 当会话 ID，无需额外查询 | 随 DSH 分发 |
| S6 | npm 插件 `@terricsh/dsh-notify` | 成熟开源（同类实现） | https://www.npmjs.com/package/@terricsh/dsh-notify | 发布 2026-08 | 「点击通知可直接跳转到 Web GUI 里对应的会话」，做法是 **`<base>/open-session?session=<id>` → 宿主写 120 秒 cookie → 客户端读 cookie 后 `sessions.open(id)`** | **只借鉴「这个功能在 DSH 生态里被实现过」这一结论**；其具体路径不照抄（见 §三） | 未标注许可证 → **只借鉴思路，不复制代码** |
| S7 | 上游仓库 release `v0.2.9` | 上游官方公告 | https://github.com/wingsky-1/dsh-plugin-hub/releases/tag/v0.2.9 | 2026-10-11 | 「项目进入**有限维护**阶段，维护者目前暂停使用 DSH……**新功能与全面重写暂缓**」；DSH 适配基线仍为 `0.2.0-rc.2` | 结论：**不提 PR、不等上游**；改动只能落在本地，且必须做成可重放补丁 | 仓库公开（MIT） |
| S8 | DSH 官方包 `@deepseek-ai/dsh-client-modules` | 官方文档（本机 asar） | asar → `dsh-client-modules/README.zh.md` | 本机安装版 | 插件 `lib/client.js` 由宿主扫描后按 `/plugins` 提供；**revision 由文件的 mtime / ctime / 大小派生，不对内容求哈希**；「bundle 内容变更只能通过 `rebuilt()`（HMR 钩子）进入图」 | 决定「改完客户端代码怎么生效」：需让宿主重新扫描（重启最稳），且**不需要担心内容哈希校验** | 随 DSH 分发 |

## 三、没查到 / 查了不可用

- **官方网址路由（`?session=<id>` 之类）**：**未取到**。对官方前端产物 `index-CN7NIWNw.js` 全文检索 `pushState / replaceState / URLSearchParams / location.hash / ?session= / #/session / /session/`，**计数全部为 0**。→ 网上那种「拼网址跳转」的做法在本机这个版本**不成立**（这也是 S6 与本机版本的差异点：它依赖的 `sessions.open(id)` 在本机 `sessions` 服务上**不存在**）。
- **官方是否提供「通知里带会话 ID」的标准字段**：**未取到**。`dsh-api-session-controller` 的 `notifier` 类型定义未读到与会话跳转相关的载荷约定。→ 我们自己加字段，属自定协议。
- **Windows 系统 toast 可点击跳转**：**未取到**权威做法。原插件的 `toast.ps1` 用 `ToastText02` 模板且**未设置任何激活参数**；要让系统 toast 点击后跳转，需要额外的激活配置与窗口唤起逻辑，工作量与风险都显著更高。→ 本版**列为可选、默认不做**（见 SPEC「不做什么」）。
- **`@terricsh/dsh-notify` 的完整源码**：未取到（npm 页面只有 README 摘要）；且未标许可证 → 不复制其代码。
- **`vendor-DcuzkuQH.js`（741 KB）未逐一检索**：故「官方无网址路由」这一结论的强度是「在主前端产物内未找到」，非「绝对不存在」。

## 四、我们的判断（无外部依据，风险自负）

- **补丁落在「已安装副本」而非新插件或 fork**：因为没有外部依据支持「新写一个独立插件还能接管原插件已弹通知的点击事件」——通知的 `onclick` 只有弹出它的那段代码能设置。要么改原插件，要么完全取代它。改原插件代价最小。（若错了，代价是：插件升级后补丁失效，需要重放。）
- **会话 ID 由服务端塞进帧**：官方帧里没有这个字段（S4 事实），所以这是自定协议，且只在本补丁的前后端之间自洽——不保证与上游未来版本兼容。
- **默认只覆盖「浏览器系统通知」与「页面内横幅」两条通道**：这两条都在我们改得到的客户端代码里（S4 所述路径）；Windows 系统 toast 走的是外部 PowerShell 脚本，不在同一改动面上。
