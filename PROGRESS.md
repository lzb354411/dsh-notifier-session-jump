# PROGRESS（逐任务留痕）

> 对应 `PLAN.md` 的 T1–T10。每完成一步追加一行：做了什么 → 怎么验的 → 结果原文要点。
> 证据分层：**实测 > 代码事实 > 推断**。没跑过的绝不写成跑过。

## T1 备份 ✅

- 做了什么：把 6 个待改文件拷进 `<工作区根>\_backup\20261019-185739\`（保留原路径层次），并在原目录留 `*.bak-20261019-185739` 单文件快回滚。
- 怎么验的：列目录 + 逐个比对。
- 结果：备份目录 6 个文件全在（`lib/index.js` 514109、`lib/client.js` 249150、4 个 `.d.ts`）；同目录 6 个 `.bak` 同时存在，大小一致。
- 另一次（应用补丁时引擎自动做）：`<工作区根>\_backup\20261019-190735\`（同一组 6 个文件的「补丁前」状态）。

## T2/T3 服务端改动 ✅

- 做了什么：`lib/index.js` 10 处改动 —— 新增 `sessionIdOf()` 取值口径；`render()` 条件写键；5 个事件翻译点注入会话 ID；`finalizeRequest()`、`buildFrame()`、SSE `publish()` 逐层透传。
- 怎么验的：`dry-run.mjs` 逐条校验锚点唯一性 → `apply.mjs` 应用 → `node --check` → 反向还原比对 → 单测驱动真实函数。
- 结果：
  - 锚点：10/10 各自**恰好命中 1 次**（首次跑出 2 处 `.d.ts` 锚点失配，已定位为抄漏了一行注释并修正；证据见 NOTES「踩坑」）。
  - `node --check lib/index.js` → exit 0。
  - 反向还原：`493667 → 492350` 字节，与备份**完全一致**（除补丁外零改动）。
  - `node --input-type=module -e "import(...)"` → 导入成功，导出键 `apply, inject, name` 未变。
  - 单测：`assert-3-server.mjs` **22/22 通过**。

## T4/T5 客户端改动 ✅

- 做了什么：`lib/client.js` 8 处改动 —— 新增 `sessionJumper`（惰性取 `uiWorkspace` + 容错调用 `openSession`）与 `clientContext` 稳定持有；系统通知 `onclick`、横幅 `click` 两处接上跳转；`showNotification`/`showBanner` 增加会话 ID 形参；`handleNotifyFrame` 从帧里取出并透传；`apply` 挂 ctx 并在卸载时清理。
- 怎么验的：`node --check` → 反向还原比对 → 台架真实加载产物并驱动点击。
- 结果：
  - `node --check lib/client.js` → exit 0。
  - 反向还原：`238292 → 235838` 字节，与备份**完全一致**。
  - 台架 `assert-2-click.mjs` **28/28 通过**；`assert-1-load.mjs` **7/7 通过**（含「uiWorkspace 完全缺失时 apply 不抛错」）。
  - 台架首次跑出 3 处失败，**全部是台架自身缺陷**（沙箱未挂全局 `Notification` → 走不到真实路径；帧 `seq` 写死 → 被客户端按序去重；横幅通道用错触发条件）。修正台架后全绿，**产物代码未动**。证据见 NOTES「踩坑」。

## T6 类型文档同步 ✅

- 做了什么：4 个 `.d.ts` 各加一个可选 `sessionId` 字段（`NotifyRequest` / `NotifyMessage` / `NotifyFrame` / `StreamEvent`）。
- 怎么验的：反向还原比对 + 复核脚本逐条判「已应用」。
- 结果：4/4 已应用；反向还原完全一致（+70/+72/+81/+181 字节）。

## T8 离线验证 ✅

- 汇总结论：**四组断言共 68 项全部通过**（10 + 28 + 22 + 8），覆盖 SPEC 的 F1–F5。

| 断言组 | 项数 | 验的是什么 |
|---|---|---|
| `harness\assert-1-load.mjs` | 10 | 产物仍能被前端模块加载器接受；导出契约未变（`inject` 仍只有 `slots`/`locale`）；**官方会话导航服务完全不存在时装载也不报错**；产物仍是单文件、无新增外部依赖（只 `require("react")`） |
| `harness\assert-2-click.mjs` | 28 | **真实加载补丁后的 `client.js`**，驱动「SSE 帧 → 弹通知/横幅 → 点击」全链路：F1 系统通知跳转、F2 横幅跳转、F3 无归属不跳（含空串/非字符串）、F4 服务缺失与抛错时不连累通知、F5 老帧向后兼容、卸载后不留悬挂引用 |
| `harness\assert-3-server.mjs` | 22 | 服务端取值口径与透传：`sessionIdOf` 各分支、`render` 有/无值时键的取舍、审批翻译真的带上 `agent.id`、`finalizeRequest` / `buildFrame` 逐层带上且原有字段一个不少 |
| `harness\assert-4-wire.mjs` | 8 | **补上链路里最后一段**：SSE `publish()` 产出的线协议原文真的含 `sessionId`；无归属时不带该键；`playOnly` 语义未变 |

**证据分层说明（重要，独立审查指出后才写清）**：以上四组均为**实测**（跑的是装在你 DSH 里的那份产物本身）。
但有一条口径必须写准：**`assert-2-click` 不能单独用来证明「官方接口存在」** —— 它的 `ctx` 是台架手写的替身，
里面 `get("uiWorkspace")` 预设了这个服务名。所以它证明的是「**当**该服务存在且如此命名时，补丁会正确调用它」。
「官方确实提供这个服务」的硬证据是**读本机官方 asar**：

- `dsh-client-ui-workspace/lib/client.js:1380` → `super(ctx, "uiWorkspace")`（服务以这个名字注册）
- 同文件 `:1470` `openSession` → `:1651` `replaceMain` → `selection.set({ sessionId, ... })`（写入当前主视图选中项）
- `dsh-web-app/package.json` 依赖 `"@deepseek-ai/dsh-client-ui-workspace": "0.2.1-rc.2"`（与本机 DSH 版本一致）
- `dsh-web-app/cordis.patch.yml` 里 `- id: ui-workspace`（被显式组合进去）

另有一点必须说清：**这些都还没有在真机上跑过** —— 宿主只在启动时组合插件与前端产物，所以「重启 DSH 后真的能跳」这一步仍是**未验证**，见 T10。

## T10 补充：双击产物的 Windows PowerShell 5.1 实测 ✅（独立审查发现 Critical 后补做）

独立审查发现：三个 `.ps1` 原先是 UTF-8 **无 BOM**，而本机 `powershell` 是 **5.1**（`pwsh` 不在 PATH），
5.1 按 GBK 解码中文 → 语法报错 → **三个双击产物全部跑不起来**。我自己做还原演练时用的是 `pwsh`(7)，
所以没暴露 —— 这是「独立审查」救回来的一个真缺陷。

修复后实测：

| 检查 | 结果 |
|---|---|
| 三个 `.ps1` 前 3 字节 | 均为 `EF BB BF`（带 BOM） |
| `ParseFile` 语法解析（5.1 口径） | `apply.ps1` / `restore.ps1` / `verify.ps1` 各 **0 错** |
| `verify.ps1` 实跑 | **exit 0**，中文正常显示，判定「补丁已应用」正确 |
| `restore.ps1` 实跑（回答 y） | 自动**跳过含补丁的备份**、选中干净备份 `20261019-192042`，6 个文件逐个「已还原并校验一致」，**exit 0** |
| `apply.ps1` 实跑 | 先试运行再正式应用，**exit 0**，写入 6 个文件 |
| **往返一致性** | 还原后 `index.js` = `AB609B30…`（干净）；再应用后 = `BB4246A3…`（与演练前的补丁态**完全一致**） |
| 幂等 | 再跑 `apply.ps1` 报「写入文件：（无变化，已应用过）」，关键标记各仍为 **1** 次 |

→ 结论：「**可重放 / 可还原 / 可复核**」这三条承诺，现在是**在 5.1 下真跑过**的，不再只是「脚本存在」。

## 补充取证：`uiWorkspace` 服务在运行时真的存在吗 ✅（这是本方案最大的隐含前提）

- 为什么必须查：如果这个服务根本没被激活，补丁会**静默失效**（通知照常、点了不跳）——功能白做，但不会报错，最难发现。
- 怎么查的（全部只读，读本机官方安装包）：

| 查什么 | 命令 | 结果 |
|---|---|---|
| 是不是本机版本的正式依赖 | `node asar-tool.mjs cat "dsh/node_modules/@deepseek-ai/dsh-web-app/package.json"` | 命中 `"@deepseek-ai/dsh-client-ui-workspace": "0.2.1-rc.2"` —— 与本机 DSH 版本**完全一致** |
| 有没有被组合进去 | `node asar-tool.mjs cat "dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml"` | 命中 `- id: ui-workspace` / `name: '@deepseek-ai/dsh-client-ui-workspace'` —— **在官方组合补丁里被显式激活** |

- 结论：`uiWorkspace` 服务**确实存在**（不是推断，是官方组合配置里写着的）。剩余的唯一不确定性是「DSH 升级后会不会改名」，而那种情况已被容错覆盖（只是不跳，不影响通知）。

## T7 补丁文件与双击产物 ✅

- 做了什么：三个双击产物（`apply` / `restore` / `verify`）+ 引擎 + 改动定义，全部 UTF-8 带 BOM。
- 怎么验的：演练「应用 → 还原 → 再应用」，并逐字节比对；测幂等；测还原脚本的备份挑选逻辑。
- 结果：
  - 还原演练：6 个文件与干净原件**逐字节一致**；还原后 `node --check` 仍 exit 0。
  - **幂等**：连应用两次，`lib/index.js` / `lib/client.js` 的 **SHA256 完全一致**，第二次报告「写入文件：（无变化，已应用过）」，关键标记各出现**恰好 1 次**（修掉坑 3 之前它会重复插入）。
  - 还原脚本的挑备份逻辑：能识别并**跳过**含补丁的备份（实测 `20261019-191425` 被判「含补丁 → 跳过」，其余三份判「干净」）——避免「用含补丁的备份来还原」等于没还原。
  - 三个 `.bat` 前 3 字节均为 `EF BB BF`（UTF-8 BOM，中文不乱码）。

## T9 交付文档 ✅

- 产出 `README.md`（七节，含精确改动清单、设计红线、四个坑、备份与回滚路径）。
- 测试台架已从 `%TEMP%` 拷进项目 `harness\`，**从项目目录可直接复跑**（已实测：10 / 28 / 22 / 8 全绿）。

## T10 独立审查 + 真机验证 ⬜ 待做

- 独立审查：已另起一个 agent 只读复核（不信任我的结论，自行核对官方接口、幂等逻辑、副作用、证据可信度）。
- 真机验证：需要**重启一次 DSH**（宿主在启动时组合插件与前端产物），这会让当前对话中断，故由用户决定时机。

