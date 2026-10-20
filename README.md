> 本目录规则：`~/.dsh/AGENTS.md`（全局）+ `../AGENTS.md`（分类）；看不到分类规则时以本 README 与全局规则为准。

# dsh-notifier-session-jump

> 给 DSH 插件 `@wingsky-1/dsh-notifier` 的一个补丁：**点击通知 → 直接切到那条通知所属的会话**。

## 〇、源自上游 · 致谢

**本项目是基于 [`wingsky-1/dsh-plugin-hub`](https://github.com/wingsky-1/dsh-plugin-hub) 里
`packages/dsh-notifier`（即 npm 包 [`@wingsky-1/dsh-notifier`](https://www.npmjs.com/package/@wingsky-1/dsh-notifier)）
所做的改造／补丁，不是从零写的独立插件。**

- **原插件的一切功劳归原作者 wingsky-1**：事件采集、筛选裁决、多通道投递（浏览器通知 / 系统 toast / Bark / Webhook）、
  设置页、通知历史、降级与容错——这些**全部**是上游做好的；本仓库只是在其之上加了一项增量能力。
- **特别感谢 wingsky-1** 把这个插件做出来并开源（MIT），让「点通知跳会话」这件事有地方可以落脚。
- **本仓库只包含**：那一项增量能力的补丁定义与工具（应用 / 还原 / 复核）、验证台架与过程文档；
  **不包含**上游插件的源码或编译产物，**也不重新分发**它（详见 [`NOTICE.md`](NOTICE.md)）。
- 上游目前处于**有限维护**状态（新功能暂缓），因此这里的做法是**本地补丁**，而不是向上游提交源码改动。
  若上游日后恢复更新并愿意接纳该能力，欢迎把这套改动改写成源码版贡献回去。

> This project is a patch **derived from** the upstream `@wingsky-1/dsh-notifier`
> (part of [`wingsky-1/dsh-plugin-hub`](https://github.com/wingsky-1/dsh-plugin-hub), MIT, by wingsky-1).
> All credit for the original plugin goes to the upstream author. Many thanks to **wingsky-1**.

## 一、项目说明

给已装的第三方插件 `@wingsky-1/dsh-notifier` 加一个能力：**点击通知，界面直接切到那条通知所属的会话**（过去点击只把窗口拉到前台）。

为什么要改插件而不是另写一个插件：通知的点击处理，只有**弹出它的那段代码**能设置。所以新插件接管不了已有通知的点击，只能改原插件。

- 覆盖范围：**浏览器系统通知** + **页面内横幅**两条通道。
- 明确不做：Windows 系统托盘通知（那条由独立 PowerShell 脚本弹出，见 SPEC「不做什么」）。

**它改的是「已编译的插件产物」，不是插件的源码** —— 所以：
- 插件**升级会覆盖补丁**，需要用 `patch\apply.bat` 重放（已做成幂等，重放不会重复插入）；
- 它也**不能**当成上游的源码改动提交 PR（上游源码版实现是另一件事）。

**路径不写死**：`paths.mjs` 与三个 `.ps1` 都按「环境变量优先、否则从用户目录推导」取路径，
所以在别人的机器上也能用。可用这两个环境变量覆盖：

| 环境变量 | 默认值 |
|---|---|
| `DSH_NOTIFIER_PLUGIN_DIR` | `~/.dsh/profiles/desktop/node_modules/@wingsky-1/dsh-notifier` |
| `DSH_NOTIFIER_BACKUP_ROOT` | `<项目目录>\..\..\_backup` |

## 二、怎么跑

前提：本机装了 DSH，且 `@wingsky-1/dsh-notifier` 已装在该 profile 下；需要 `node`（脚本用它做锚点校验）。
没有要构建的东西。三个双击产物都在 `patch\` 下（UTF-8 带 BOM，中文不会乱码）：

| 双击 | 作用 | 什么时候用 |
|---|---|---|
| `patch\verify.bat` | **只读复核**：补丁在不在位、备份还在不在、DSH 要不要重启、通知是否正常 | 随时可跑，不改任何东西 |
| `patch\apply.bat` | 重新打上补丁（先试运行校验锚点 → 自动备份 → 写入） | 插件升级导致补丁被覆盖之后 |
| `patch\restore.bat` | 一键还原成打补丁前的样子（会先确认 DSH 已退出） | 想撤销改动时 |

**验证真的跑通了**（无外网、无额外依赖，用本机 node 跑；台架已放在项目 `harness\` 下）：

```powershell
cd "<项目目录>\harness"
node assert-1-load.mjs      # 10 项：产物能被前端模块加载器接受、导出契约未变、服务缺失时装不坏
node assert-2-click.mjs     # 28 项：真实加载产物，驱动「弹通知 → 点它」全链路
node assert-3-server.mjs    # 22 项：服务端取值口径与逐层透传
node assert-4-wire.mjs      #  8 项：SSE 线协议原文真的带上会话 ID
```

四组共 **68 项全部通过**。**但请注意**：这些都还没在真机上跑过 —— 宿主只在启动时组合插件与前端产物，所以「重启后真的能跳」这一步仍属**未验证**（见第五节第一步）。

## 三、开发计划与阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0.5 | 找依据：确认官方「切会话」接口、确认会话 ID 是否可得 | 完成 |
| 1 | 需求：`SPEC.md`（3 个选择题定范围与落地方式） | 完成 |
| 2 | 方案：`PLAN.md`（选型 + 10 步 + 风险） | 完成 |
| 3 | 实现：备份 → 服务端 10 处 → 客户端 8 处 → 4 个类型文档 → 补丁与三个双击产物 | 完成 |
| 3.5 | 离线验证：语法 + 反向还原比对 + 四组断言 68 项 | 完成 |
| 4 | 独立审查（另起一个 agent 复核）→ 21 条建议全部闭环，其中 1 条 Critical 是我漏掉的真缺陷 | 完成 |
| 5 | 验收：`ACCEPTANCE.md`（F1–F5 逐条勾，F1/F2/F5 标注为「待真机」） | 完成（待真机项除外） |
| 6 | 真机验证：**重启一次 DSH** 后实际点一次通知 | **待用户决定时机** |

## 四、Agent 须知

**改了什么（精确清单）** —— 全部通过 `patch\apply.mjs` 应用，共 22 条改动：

- `lib/index.js`（10 条）：新增 `sessionIdOf(agent)` 作为会话 ID 的**唯一取值口径**；`render()` 有值才写键；5 个事件翻译点（审批/提问/完成/轮次完成/出错）注入会话 ID；`finalizeRequest()`、`buildFrame()`、SSE `publish()` 逐层透传。
- `lib/client.js`（8 条）：新增 `sessionJumper`（**惰性**取 `uiWorkspace` + 容错调用 `openSession`）与 `clientContext`；系统通知 `onclick`、横幅 `click` 两处接上跳转；`showNotification`/`showBanner` 增加会话 ID 形参；`handleNotifyFrame` 从帧里取出透传；`apply` 挂 ctx 并在卸载时清理。
- 4 个 `.d.ts`：各加一个可选 `sessionId`（纯类型文档，**不参与运行**）。

**设计红线（改动必须守住这几条）**

1. **宁可不动，不可跳错**：归属只从 `agent.id` 取，**不做任何猜测**；取不到就不跳。跳错到别的会话比不跳更糟。
2. **跳转失败不得连累通知**：全链路 `try/catch`，取服务失败/会话已归档/`openSession` 抛错，一律只写控制台告警，通知的弹出、聚焦、关闭三件事一个都不能少。
3. **不把 `uiWorkspace` 写进 `inject` 声明**：那样服务缺失会导致**整个通知插件装载失败**，远比「不跳转」严重。契约上 `inject` 至今仍是 `['slots','locale']`（有断言守着）。
4. **新增字段一律可选、缺省不写键**：没有归属的通知（`test` 类、无 agent 的事件）在请求/消息/帧/线协议四个层面的形状与改动前**逐字一致**。

**踩过的坑（都在 `NOTES.md` 有完整记录，别重踩）**

- 坑 1：PowerShell 的行号与读取工具**不一致**（实测差约 24 行）。改产物前一律用 Node 定位锚点，别信行号。本补丁基于**唯一文本锚点**而非行号，故不受影响。
- 坑 2：锚点抄漏一行注释 → 静默失配。**锚点必须从文件重新读**，别从滚动过的屏幕内容抄。
- 坑 3（最严重）：补丁**最初不可重复运行** —— 幂等判据用「原文消失」，对**插入式**改动永远失效，重放一次就把 `sessionIdOf`/`createSessionJumper` 各多定义一遍（实测：各出现 2 次）。已改为「新文已在即视为已应用」并追加事后自检（新文必须**恰好出现 1 次**）。**验证**：两次应用后 `lib/index.js` SHA256 一致、三处标记各 1 次。
- 坑 4：台架自身 3 处缺陷被误当产物缺陷（沙箱缺全局 `Notification` → 走不到真实路径；帧 `seq` 写死 → 被客户端去重；横幅通道触发条件用错）。**台架失败先怀疑台架** —— 修台架后全绿，产物一字未动。

**别做的事**

- **别用不带 BOM 的编辑器改这三个 `.ps1`**（头号坑，见下）。改完必须重新存成 **UTF-8 带 BOM**，否则 `.bat` 一跑就语法报错。
- 别用「改网址 `?session=<id>`」这条路：官方前端产物里**没有**会话路由（实测 `pushState`/`replaceState`/`URLSearchParams`/`location.hash`/`?session=`/`#/session`/`/session/` 计数**全为 0**）。
- 别抄 npm 上 `@terricsh/dsh-notify` 的做法（它用 `<base>/open-session?session=` 深链 + `sessions.open(id)`）：**本机这个版本没有 `sessions.open` / 那条路由**，照抄必失败。它的价值只在于证明「这个功能在生态里被实现过」。
- 别把 `uiWorkspace` 加进 `inject`（见红线 3）。
- 别手改 `~/.dsh/profiles/desktop/package.json`（权威来源是 `dsh.profile.bundles`，且本机 `pnpm install` 跑不通）。
- 本插件目前靠**版本豁免**（`compatibility.json`）才能在 DSH `0.2.1-rc.2` 上加载，**别删豁免**。历史见 `../2026-10-17-dsh-notifier-repair/`。

**头号坑：三个 `.ps1` 必须带 UTF-8 BOM（独立审查发现的 Critical）**

本机只有 **Windows PowerShell 5.1**（实测 `5.1.26100.9711`；`pwsh` **不在 PATH** 上），而 `.bat` 调的就是
`powershell`。5.1 对**无 BOM** 的脚本按 **GBK** 解码 → 脚本里的中文全变乱码 → 引号/花括号失配 →
**双击产物直接语法报错、跑不起来**（实测 `verify.ps1` exit 1 + `Unexpected token`）。

- **改完 `.ps1` 的规矩**：`[System.IO.File]::WriteAllText($p, $text, [System.Text.UTF8Encoding]::new($true))`；
  改完用 `Parser::ParseFile` 在 5.1 下验一遍（应为 0 错）。
- **判据只用 ASCII**：脚本里凡是「拿来做字符串比对」的字面量（补丁特征、文件名）**一律用 ASCII**。
  中文判据会被 GBK 解码毒化 → 即使补丁在位也会误报「未应用」，把用户引向死路。
  当前用的是 `function sessionIdOf(agent)` / `sessionJumper` / `clientContext.current = ctx;` / `session-jump.ts`。
- 我最初没发现这个坑，是因为自己做还原演练时用的是 `pwsh`(7) —— **换一双眼睛（独立审查）救回来的**。

**影响范围**

- 只有已装插件这一份产物；`~/.dsh/profiles/desktop/` 下的其它配置**未改动**。
- 插件升级（`pnpm`/市场更新）会**覆盖补丁** → 双击 `patch\apply.bat` 重放即可。

## 五、下一步工作

**当前状态：组件级验证全部通过（68/68），真机（实际点击）部分用户已明确选择延后。**
→ 所以 F1 / F2 / F5 在 `ACCEPTANCE.md` 里记的是 **⚠️ 未验**，不是「通过」。补验只需三步：

1. 双击 `patch\verify.bat` → 第 2 节应显示「**补丁已应用**」（若显示未应用，双击 `patch\apply.bat`）
2. 完全退出 DSH 再启动 → 启动后按 **Ctrl+F5** 强制刷新一次页面
3. 让 DSH 在后台干活（切走页面让它弹**系统通知**；页面可见时走**横幅**）→ **点它** → 看是否切到**那条通知所属**的会话
   - 反目标检查：跳过去的会话内容应与通知里的任务名**是同一个会话**
   - 可选复核「**子代理完成**」通知：独立审查起初列为「无法判定」，续查官方代码后已有依据证明受支持
     （`replaceMain` 对字符串目标会调 `subagentAddress()` 自行反推子代理地址，见 `NOTES.md`「I1 补证」）

其余待办：

- [ ] 真机确认后，在 `ACCEPTANCE.md` 第五节勾「验收通过」并写你的确认原话（那时我会把 `.meta/INDEX.md` 的状态改成「完成」）
- [ ] 上游恢复更新后，可考虑把这套改动整理成 PR 提给上游（**当前上游处于有限维护、新功能暂缓**，故本版只做本地补丁）

## 六、Git 仓库约定

- 远程：`git@github.com:lzb354411/dsh-notifier-session-jump.git`（公开），远端名 `origin`
- 默认分支：`main`
- 提交信息：中文，形如 `feat(dsh-notifier): <一句话>`
- 本仓库是**只读快照式**的成果归档：改在本机工作副本上做，改完提交并推送。
- 不向上游提 PR（本补丁改的是编译产物，不是上游源码；上游亦处于有限维护）。

## 七、相关信息

**依据（详见 `REFERENCES.md`）**

- 官方「切会话」接口：`ctx.uiWorkspace.openSession(会话ID)` —— `dsh-client-ui-workspace/lib/client.js` 的 `:1380`（`super(ctx, "uiWorkspace")`）、`:1470`（`openSession`）、`:1651-1674`（`replaceMain`）；官方跨包调用先例：`ui-chat/lib/client.js:13279`、`ui-subagent/lib/client.js:966`。
- 会话 ID 来源：官方在 `dsh-agent/lib/index.js` 的 `enter()` 里强制 `agent.id === agent.session.id`。
- 上游状态（共 10 条来源）：https://github.com/wingsky-1/dsh-plugin-hub/releases/tag/v0.2.9 （进入有限维护、新功能暂缓）。
- 同类实现参考：https://www.npmjs.com/package/@terricsh/dsh-notify （只借鉴思路，不抄代码）。

**许可与来源**：本项目自身为 MIT（见 `LICENSE`）；补丁数据里引用了上游插件的少量代码片段作为匹配锚点，
来源与边界说明见 `NOTICE.md`。

**本项目的文件**

| 文件 | 作用 |
|---|---|
| `paths.mjs` | **路径唯一来源**（环境变量优先、否则按用户目录推导），所有脚本都从这里取路径 |
| `SPEC.md` | 需求（F1–F5 + 不做什么 + 反目标） |
| `PLAN.md` | 选型、10 步任务、风险登记 |
| `REFERENCES.md` | 10 条依据来源与适用性 |
| `NOTES.md` | 讨论记录、裁决、四个坑 |
| `PROGRESS.md` | 逐任务留痕与验证结果 |
| `REVIEW.md` | 独立审查报告（21 条问题 + 「声称 vs 实际」核对表 + 未证明部分） |
| `ACCEPTANCE.md` | 验收记录（F1–F5 逐条 + 人话说明书草稿 + 收尾产物清单） |
| `NOTICE.md` / `LICENSE` | 来源与许可 |
| `patch\server-edits.mjs` / `client-edits.mjs` | 22 条改动的定义（锚点 + 新文 + 为什么） |
| `patch\apply-engine.mjs` | 补丁引擎：锚点唯一校验 + 自动备份 + 幂等 + 事后自检 |
| `patch\apply.mjs` / `dry-run.mjs` / `edits.mjs` | 应用入口、试运行、改动归组 |
| `patch\{apply,restore,verify}\.{bat,ps1}` | 三个双击产物 |

**备份与回滚**

- 备份（保留原路径层次）：`<备份根>\<时间戳>\Users\<你>\.dsh\profiles\desktop\node_modules\@wingsky-1\dsh-notifier\`。
  其中 `20261019-185739` 是**打补丁前的干净原件**；`191425` 那次存的是补丁后状态（内含醒目标记「不可用作还原源」），还原脚本会自动跳过它。
- 同目录单文件快回滚：`<插件目录>\lib\*.bak-<时间戳>`。
- 一键还原：双击 `patch\restore.bat`（**会先确认 DSH 已退出**）；已演练过 —— 还原后 6 个文件与原件**逐字节一致**。

**验证台架（已放进项目，可直接复跑）**

- `harness\env.mjs`：最小浏览器环境（模拟 Notification / EventSource / 文档节点 / 坐席）
- `harness\assert-{1-load,2-click,3-server,4-wire}.mjs`：四组断言，共 68 项
- `harness\FINDINGS-官方接口考古.md`：子代理对官方「切会话」接口的独立考古结论（含三类入口对比与权限核对）

> 台架是**自包含**的：临时目录删掉后仍可跑（已实测四组全绿）。
