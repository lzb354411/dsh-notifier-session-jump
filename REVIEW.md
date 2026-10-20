# 独立审查报告（只读复核）· dsh-notifier 会话跳转补丁

> 审查员：独立只读复核（未修改任何被审查文件）
> 时间：2026-10-19 19:45（Asia/Shanghai）
> 对象：`<用户目录>\.dsh\profiles\desktop\node_modules\@wingsky-1\dsh-notifier\lib\{index.js,client.js}` + 4 个 `.d.ts`
> 证据分层：**实测**（我亲自跑出输出）> **代码事实**（读官方/插件源码）> **推断**（未跑，标注）

## 结论（一句话）

**机制本身是真的**（官方确实有 `uiWorkspace.openSession(会话ID)` 这个「按 ID 切当前会话」的接口，服务端也真的把会话 ID 一路送到了 SSE 帧，且我按声明的 22 条改动从干净备份重建后与当前产物**逐字节一致、无任何未声明改动**）；**但交付的「双击产物」已经坏了**——`apply.ps1`/`restore.ps1`/`verify.ps1` 三个脚本在本机 Windows PowerShell 5.1 下**直接语法报错、跑不起来**，导致「可重放 / 可还原 / 可复核」这三条最关键的兜底承诺**实际不成立**。

## 分级问题清单

### Critical

- **[C1] 三个 `.ps1` 在 Windows PowerShell 5.1 下无法解析 → 双击入口全部失效**
  - 实测：`powershell -NoProfile -ExecutionPolicy Bypass -File .\verify.ps1` → `Unexpected token '}'`、`The string is missing the terminator` 等，退出码 1。
  - 实测：`[Parser]::ParseFile` 结果 —— `apply.ps1` 4 个错误、`restore.ps1` 11 个、`verify.ps1` 8 个（报错文本里的中文已呈乱码 `琛ヤ竵`、`杩樺師`）。
  - 根因（实测）：三个 `.ps1` 都是 **UTF-8 无 BOM**（`.ps1`: BOM=false），而 `.bat` 里的 `powershell` 是 **Windows PowerShell 5.1**（实测 `PSVersion = 5.1.26100.9711`），5.1 对**无 BOM** 的脚本按 **ANSI(936/GBK)** 解码 → 中文全部乱码 → 引号/花括号失配 → 语法错误。`.bat` 自己带 BOM 没用，它只是启动 `.ps1`。
  - 影响链：`verify.bat`（用户重启后要双击的那个）跑不了 → T10 真机验证的第一步就断；`restore.bat` 跑不了 → 「一键还原」不存在；`apply.bat` 跑不了 → PLAN 风险表第一条的应对「上游升级后一键重放补丁」不存在。
  - 建议：三个 `.ps1` 存成 **UTF-8 带 BOM**（或全 ASCII 化：把中文提示与中文判据改成 ASCII/Unicode 转义）；改完必须在新环境实测 `powershell -File` 解析通过。另建议 `.bat` 里优先探测 `pwsh`（本机实测**没有** `pwsh`，只能走 5.1，所以必须按 5.1 兼容）。

- **[C2] `verify.ps1` 的代码签名判据本身也会被同一个编码问题毒化 → 可能误报「补丁未应用」**
  - 实测：`$marksClient` 里的 `'session-jump.ts（本地补丁新增）'` 被 5.1 读成 `'session-jump.ts锛堟湰鍦拌ˉ涓佹柊澧烇級'`，对真实产物做 `Contains` → **False**（实测输出 `contains=False`；ASCII 对照判据 `function sessionIdOf(agent)` 则为 True）。
  - 后果：**即使补丁在位，verify 的客户端一节也会判「未应用」**，并把用户引向「双击 apply 重打」——而 apply 又是坏的（C1），形成死路。
  - 建议：`.ps1` 里所有用于比对的字面量一律只用 ASCII 子串（如 `session-jump.ts`、`sessionJumper`、`clientContext.current = ctx;`），避免中文判据。

- **[C3] `restore.ps1` 的「干净备份」守卫同样被毒化（次要但同源）**
  - 实测：`$patchMarks[0] = 'function sessionIdOf(agent)'` 是 ASCII（可用），`$patchMarks[1] = 'session-jump.ts（本地补丁新增）'` 是中文（不可用）。
  - 后果：一份「只打了客户端补丁、服务端干净」的备份会被误判为干净并被选中还原（`index.js` 判据通不过脏检测）。当前 4 份备份恰好是补丁状态整体一致的（见下），所以这次没踩到，但守卫的设计意图（宁可跳过也不用可疑备份）有一半没生效。
  - 建议：把 `$patchMarks[1]` 换成 ASCII 的 `sessionJumper` / `clientContext`。

- **[C4] `<工作区根>\_backup\20261019-191425` 里存的是「已打补丁」的状态 —— 与「备份＝补丁前干净原件」的承诺相矛盾，且没有任何文档记录这件事**
  - 实测哈希：当前 `index.js` = `bb4246a36f44fd49`、`client.js` = `7c2330686f12ddd3`；`20261019-191425` 两份**完全相同**（= 已打补丁）；`185739` / `190735` / `192042` 均为 `ab609b3055f802d2` / `c471acd690a1788b`（= 干净原件）。
  - 实测：同目录 `lib\index.js.bak-20261019-191425`、`lib\client.js.bak-20261019-191425` 也是**补丁后**状态。
  - 后果：备份可控（有 3 份干净副本），但**存在一个「看起来像备份、其实是已打补丁产物」的目录**，任何按「取最新/随便挑一份」逻辑写的还原都会出错；而 `restore.ps1` 自己已因此加了守卫（见 C3，该守卫半失效）。
  - 建议：把 `191425` 明确标注为「补丁后快照，不可用作还原源」，或在 NOTES 里登记；理想做法是把它移出备份根或改名加 `-patched` 后缀。

### Important

- **[I1] 「点通知跳对会话」只在**「一个 id 对应一个会话视图」**的假设下成立；子代理通知这一格没有证据**
  - 代码事实（插件）：`isSubagentOf(agent, agents)` → `kind: "subagent-done"`（`index.js:11849-11850, 11967`），而 `sessionIdOf(agent)` 取的是 **该 agent 自己的** `agent.id`。
  - 代码事实（官方）：`dsh-agent/lib/index.js:513-514` —— `const id = agent.id; if (id !== agent.session.id) throw ...`，所以 `agent.id === agent.session.id` 这个前提**成立**（而且是官方强制的不变量，不是约定）。
  - 但：官方打开子代理用的是 `ctx.uiWorkspace.openSession(address)`（`dsh-client-ui-subagent/lib/client.js:966`），其中 `address` 是**子代理地址对象**（`replaceMain` 里 `subagentAddress` 分支，官方 `ui-workspace/lib/client.js:1661-1664`），**不是裸字符串 id**。
  - 判定：**无法判定**。把子代理的裸 id 传给 `openSession`，会落成「主视图切到该 id」还是落到别的视图，我没有跑过也没有找到官方对「裸 id 是否等价于子代理地址」的保证。
  - 建议：重启后专门造一次「子代理完成任务」的通知，点它，确认落到哪；若不对，则在 `sessionIdOf` 侧对 `subagent-done` 改取父会话 id，或改传地址对象。

- **[I2] 归档会话可能**真的会跳**（与 SPEC F4 写的「只是不跳转」不完全一致）**
  - 代码事实（官方）：`dsh-api-session-controller/lib/client.js` 的 `resolveTarget` —— 未知 id 且无子代理地址时 `throw new Error("sessions.retain: unknown session ...")`；但**归档会话在 `this.summaries` 里有**（同文件 `summaries.some((summary) => summary.sessionId === id)` 分支），因此**不会抛错、会继续 retain 并跳过去**。
  - 判定：这不算坏（跳到自己那条归档会话可能正是用户想要的），但 **SPEC F4 的验收描述（「已归档 → 点通知不跳转」）与实际语义不符**，验收时如果照 F4 原文判，会得到「不符合」的错误结论。
  - 建议：把 SPEC F4 的措辞改成「会话已删除 / 跳转调用抛错时 → 不影响通知」；归档是能跳的，不必当失败。

- **[I3] PROGRESS.md 的「57 项断言全绿」是**过期数字**，与当前台架产物不符**
  - 实测（我亲自复跑 4 个台架）：`assert-1-load.mjs` **10/10**、`assert-2-click.mjs` **28/28**、`assert-3-server.mjs` **22/22**、`assert-4-wire.mjs` **8/8**，全部 exit code 0 → 实际是 **68 项**。
  - PROGRESS T8 写「三组断言共 57 项全部通过（7 + 28 + 22）」，是 `assert-4-wire.mjs` 存在之前、且 `assert-1` 还是 7 项时的旧口径。
  - 后果：文档里的证据与磁盘上的证据不一致，削弱「可复核」；也让 T8 的「三组」与现有「四组」对不上。
  - 建议：PROGRESS T8 改成 4 组 / 68 项，并注明各文件当前计数。

- **[I4] 台架的「决定性证据」里有**自证成分**，不应单独作为「官方接口存在」的证据**
  - 代码事实：`harness/env.mjs:122-128` 里的 `ctx` 是**手写替身**，`get: (name) => (name === "uiWorkspace" ? uiWorkspace : undefined)` —— 它**预设**了真实宿主会以 `"uiWorkspace"` 这个名字提供服务。因此 `assert-2-click` 证明的是「**当**该服务存在且名为 uiWorkspace 时，补丁会正确调用它」，而不是「真实宿主确实提供了它」。
  - 结论仍然成立，但成立依据是**我独立读的 asar**（见「声称 vs 实际」表），不是这个台架。建议在 PROGRESS 里把这条证据的口径写准，避免后人误读成「台架证明了接口存在」。
  - 另：`env.mjs:51` 把**任何**创建的 `div` 都推进 `banners` 数组（`banners.length >= 0` 恒真），是台架写的糙；本次断言仍能区分真假，但这是个易误报点。

- **[I5] PLAN/交付文档里的文件名与实际产物对不上**
  - 代码事实（实测存在性）：PLAN §二 承诺 `patch/session-jump.patch.json`、`patch/apply-patch.ps1`；实际**都不存在**（实测 `Test-Path` → False）。实际是 `apply-engine.mjs` + `server-edits.mjs` + `client-edits.mjs` + `apply.mjs` + `dry-run.mjs` + `apply.ps1/restore.ps1/verify.ps1`。
  - PROGRESS T7 写「补丁文件与双击产物 ✅（见交付文档）」，但补丁数据文件并不叫那个名字。
  - 建议：把 PLAN §二 的文件表按实际改名重写（或注明「实现时改名」），否则下次会照名字找文件、找不到。

- **[I6] `dry-run.mjs` / `apply.mjs`（node 路径）本次未实测 → 「可重放」只有脚本存在性、没有运行证据**
  - 我只做了只读核对，未运行任何会写盘的脚本（`apply.mjs` 会写）。`dry-run.mjs` 是只读的，但我未运行，**标为未确认**。
  - 建议：重启验证前先跑一次 `dry-run.mjs`（只读），确认 22 条锚点在当前产物上仍各自唯一，再决定是否需要 apply。

### Minor

- **[M1] NOTES.md「待办」一节全部未勾选，但对应事项（SPEC/PLAN/用户三选）已经完成** —— 实测 `SPEC.md`、`PLAN.md` 都在，且 SPEC 变更记录写了「用户三选」。文档自相矛盾，会误导后续会话重复劳动。
- **[M2] NOTES 坑 1 的结论与我的实测不一致（结论表述过头）** —— 我实测该产物是**纯 LF、无 BOM、无 U+2028/2029/NEL**，`split('\n')` 与 `split(/[\n\u2028\u2029\u0085]/)` 都给出同样的行数。所以「行号偏移」更可能来自读取工具的显示口径（如软换行/宽度截断），把它归因为「行终结符切分口径不同」是**推断而非实测**。补丁引擎用文本锚点确实规避了这个坑，这部分结论没问题。
- **[M3] `verify.ps1` 第 3 节说「双击 restore.bat 可从最新一份还原」，但按目录名倒序的「最新」未必是干净那份** —— 本次恰好最新（192042）是干净的；若哪天按最新一份是 191425（已打补丁），这句话就会把人带偏（虽然 restore 自己有守卫，但守卫半失效，见 C3）。
- **[M4] `patch/restore.ps1` 里 `exit $failed` 用「失败文件数」当退出码，语义含糊**（0 表示全成功，>0 表示失败数）；配合 `.bat` 的 `pause` 无实际危害，但不利于自动化。

## 声称 vs 实际（逐条核对表）

| 声称 | 我的独立验证 | 判定 |
|---|---|---|
| `ctx.get("uiWorkspace").openSession(会话ID)` 是官方「按会话 ID 切当前会话」的接口 | 官方 `dsh-client-ui-workspace/lib/client.js`：`UiWorkspaceService ... super(ctx, "uiWorkspace")`（1360/1380）→ 服务名就是 `uiWorkspace`；`openSession(target){ this.replaceMain(target, this.lifetime.signal, "reveal"); }`（1470-1472）；`replaceMain`（1651-1674）执行 `this.selection.set({ sessionId: reference.sessionId, ... })`，即**写入当前主视图选中项** | **成立**（实测读官方产物） |
| 官方自己的 `ui-chat` / `ui-subagent` 也在跨包调用它 | 官方产物实测调用点：`ui-chat/lib/client.js:13281 ctx.uiWorkspace.openSession(childId)`、`ui-subagent/lib/client.js:966 ctx.uiWorkspace.openSession(address)`；另 `ui-conversation/lib/client.js:19497 ctx.get("uiWorkspace")`、`ui-sidebar/lib/client.js:447 ctx.get("uiWorkspace")` —— **两种写法（`ctx.uiWorkspace` 与 `ctx.get("uiWorkspace")`）官方都在用** | **成立** |
| 服务端真的把会话 ID 放进了 SSE 帧 | 我按链路逐段读：`render()`（`index.js:12224`，条件写 `request.sessionId`）→ `finalizeRequest()`（12588，条件写 `base.sessionId`）→ `buildFrame()`（8974，条件写 `frame.sessionId`）→ `publish()`（8355 附近，条件写 `event.sessionId`）→ **同一只 `event` 被 `this.replay.push` 且 `this.hub.broadcast(encode(event))`**；真实 `encode(event) = "data: " + JSON.stringify(event) + "\n\n"`（8373）—— 即线上内容确实含该字段 | **成立**（读代码；`assert-4-wire` 实测 8/8 亦支持，但注意其 `encode` 是复刻品，我核对过与原件逐字一致） |
| 官方保证 `agent.id === agent.session.id` | 官方 `dsh-agent/lib/index.js:513-514`：`const id = agent.id; if (id !== agent.session.id) throw new Error('agent id "..." does not match session id "..."')` —— **是官方强制的运行时不变量** | **成立** |
| 22 条改动与实际产物一致，没有偷偷多改 | 我用 `patch/server-edits.mjs` + `patch/client-edits.mjs` 的 22 条 `find/replace`，从干净备份 `20261019-192042` 逐条重建：`lib/index.js` 492350→493667 **逐字节等同当前**；`lib/client.js` 235838→238292 **逐字节等同当前**；4 个 `.d.ts` 亦逐字节等同。且每条 `replace` 在当前产物中**恰好出现 1 次**；`sessionIdOf`/`createSessionJumper`/`clientContext` 各只有 1 处定义 | **成立**（这是我给的最强一条正面结论） |
| 4 个 `.d.ts` 只多了一个可选字段，且是纯类型、不参与运行 | 逐行比对：确实只在接口里**插入**可选字段与注释，未删除/改写任何既有成员（browser/deliver/stream/service 各一处） | **成立** |
| 通知历史 `history.jsonl` 格式不变、不写会话 ID | 读 `NotificationPipeline.archive()`（`index.js:12877-12890`）：entry 只由 `ts/kind/title/message` + `suppressed`/`channels` 组成，**完全不读 `sessionId`**；`publish()` 落盘只写序号（`writeTextAtomic(this.file, \`${this.seq}\`)`） | **成立** |
| 不会把会话 ID 外发给第三方（webhook/bark/系统 toast） | 读投递实现：`barkBodyOf(target, message)` 只取 `message.title/body/severity`；`sendWebhook` 的模板变量只喂 `title/message/kind/severity/ts`；系统 toast 只取 `title/body` —— **三条外部通道都不会带出 `sessionId`** | **成立**（正面结论） |
| 无新增外部请求 / 网络行为 / 权限要求 / 凭据读写 | 22 条改动全是「条件加一个已有字符串字段」；未新增 `fetch`/URL/权限调用；`openSession` 是进程内同步调用；`.d.ts` 不参与运行 | **成立**（读代码） |
| `clientContext` 不会造成插件卸载后悬挂引用 | `apply()` 内先 `clientContext.current = ctx`，随即 `stack.own(if(current===ctx) current=null)`（`client.js:4432-4435`）；`stack` 由 `stack.attach(ctx, "dsh-notifier", ...)` 挂在 `host.effect`（说明见 `createDisposerStack` 293-335，`attach` 在 `apply` 的 `finally`，4498-4502）→ 卸载时 `release()` 逆序执行 teardown；且 `enqueue` 在 `released` 后立即执行，不会漏 | **成立**（读代码） |
| 台架「57 项全绿」 | 我复跑 4 个台架：10/10、28/28、22/22、8/8 全绿、exit 0 —— 断言确实全过，但**项数不是 57 而是 68**，且 PROGRESS 只写了 3 组 | **部分成立**（断言真绿；文档数字错） |
| 补丁可重放、可一键还原、可只读复核（双击产物） | 实测：`powershell -File verify.ps1` → **语法报错、退出码 1**；`ParseFile` 报 `apply.ps1` 4 错 / `restore.ps1` 11 错 / `verify.ps1` 8 错。三个 `.ps1` 均为 UTF-8 **无 BOM**，被 5.1 按 GBK 解码 | **不成立**（Critical） |
| 备份完整、按原路径层次留档 | `_backup` 下 4 份含本插件的目录，其中 **185739 / 190735 / 192042 是干净原件**（哈希 `ab609b30…`/`c471acd6…`，与补丁前一致），**191425 是已打补丁状态**（哈希与当前相同）；同目录 `.bak-<stamp>` 也在 | **部分成立**（有干净备份可还原，但混入了一份补丁后快照且未被文档标注） |
| `apply-engine.mjs` 的幂等与事后自检能拦住重复插入 | 读代码：幂等判据 `if (text.includes(edit.replace)) → applied`（52-59）；事后自检对**每条** `edit.replace` 在最终文本中计数，`!== 1` 即整体失败不写盘（96-107）。我用重建实验独立验证了「每条 replace 在产物中恰好 1 次」——**自检所要拦的情况确实存在，且当前产物不触发**。但注意：自检是**在最终文本上**做的，若某条 replace 恰好是另一条 replace 的子串，会误报 0/2 —— 本补丁的 22 条经我计数均各为 1，未触发 | **成立**（读代码 + 我的独立计数） |

## 我认为没被证明的部分（只能算推断）

因为宿主只在**启动时**组合插件与前端产物，而 DSH 至今**没有重启**，以下全部**未实测**：

1. **补丁是否真的被加载**：客户端产物是从 `node_modules` 读取并按 mtime/size 派 revision（`dsh-client-modules/README.zh.md` 的说法，我未亲验该 README）→ 「重启后一定会用上被改的文件」是**推断**。
2. **`ctx.get("uiWorkspace")` 在点击那一刻真的返回服务对象**：我确认了服务名与官方跨包用法，但没有在运行中的宿主里求值过。领队补充的 `dsh-web-app` 依赖 + `cordis.patch.yml` 里 `- id: ui-workspace` 与其一致（**我认同**，且我另找到 `super(ctx, "uiWorkspace")` 这个更硬的证据），但「被组合」≠「在第三方插件 ctx 上可 `get` 到」——后者**未实测**。
3. **点击通知真的会切会话**（F1/F2 的最终判据）：台架只证明「调用发生且参数正确」，**没有**证明官方 `openSession` 在真实界面上的观感。属于**推断**。
4. **F5「改动前后通知行为完全一致」**：我只证明了「新增字段全部可选、外部通道不带出、历史不写」这些**代码层面的等价**；真实事件流下的数量/时机/声音/历史一致性**未实测**。
5. **子代理通知的落点**（见 I1）：**无法判定**。
6. **`dry-run.mjs` 在当前产物上的结论**：**未确认**（未运行）。

## 建议的最小验证动作（重启后怎么亲眼确认）

1. **先修 C1/C2/C3**（把 3 个 `.ps1` 转 UTF-8 带 BOM 或 ASCII 化），然后**在改完的当天就用 5.1 实测**：`powershell -NoProfile -ExecutionPolicy Bypass -File verify.ps1` 必须正常输出、不再报语法错。这一步在**不重启**的情况下就能做。
2. 重启 DSH（会中断当前对话）→ **Ctrl+F5 强制刷新页面** → 双击 `verify.bat`：第 2 节应显示「补丁已应用」。
3. 制造一次**提问或审批**通知（页面切走，让系统通知通道生效）→ 点它 → 看界面是否切到**那条通知所属**的会话；对照通知里的任务名与会话内容**是否同一会话**（这就是反目标的正面检查）。
4. **专门做一次「子代理完成」通知**（I1 的唯一验证途径）→ 点它 → 确认落点是否合理。
5. 切到页面可见状态再触发一次 → 走**横幅**通道 → 点横幅 → 同样确认。
6. 开一次 `dry-run.mjs`（只读）确认 22 条锚点仍唯一；再对照 `history.jsonl` 的**行数与字段**与改动前一致（F5）。

---

## 附：本次审查用到的关键实测命令与输出要点

- 重建一致性：`rebuilt === current ? YES`（6/6 文件），每条 `replace` 出现次数 `=1`（22/22）。
- 脚本解析：`apply.ps1: 4 / restore.ps1: 11 / verify.ps1: 8` 个 parse error。
- 双击路径实测：`powershell -File verify.ps1` → `Unexpected token` + `missing the terminator`，exit 1。
- 5.1 解码实测：`PSVersion = 5.1.26100.9711`；`mark=[session-jump.ts锛堟湰鍦拌ˉ涓佹柊澧烇級] contains=False`（ASCII 对照 `contains=True`）。
- 台架复跑：10 / 28 / 22 / 8 全绿，exit 0（合计 68，非文档所称 57）。
- 备份哈希：当前 `index.js=bb4246a3…`；`191425` 相同（已打补丁）；`185739/190735/192042 = ab609b30…`（干净）。
- 官方取证：`ui-workspace/lib/client.js:1380 super(ctx,"uiWorkspace")`、`:1470 openSession`、`:1651 replaceMain`；`ui-chat:13281`、`ui-subagent:966`；`dsh-agent/lib/index.js:513-514`。
- 无外泄取证：`barkBodyOf`（8922）、`sendWebhook` 模板变量（10007）、`archive()`（12877-12890）。
