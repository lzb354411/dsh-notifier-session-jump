# 来源与许可（NOTICE）

## 本仓库包含什么、不包含什么

**包含**：一份「运行时补丁」的**定义与工具** —— 补丁数据（锚点 + 新文）、应用/还原/复核脚本、
验证台架、以及过程文档。全部为本仓库作者所写。

**不包含**：目标插件 `@wingsky-1/dsh-notifier` 本身（既不含其源码，也不含其编译产物）。
本仓库**不重新分发**该插件的任何完整文件。

## 引用到上游的少量片段

补丁数据（`patch/server-edits.mjs`、`patch/client-edits.mjs`）里包含若干**短小代码片段**，
它们取自上游插件的编译产物，仅用作「在这段原文里插入新代码」的**匹配锚点**。

- 上游项目：`wingsky-1/dsh-plugin-hub` 的 `packages/dsh-notifier`
- 包名：`@wingsky-1/dsh-notifier`
- 许可证：MIT（上游 `package.json` 标注 `"license": "MIT"`，随包附 `LICENSE`）
- 用途：仅为定位与匹配；这些片段不构成对该插件的再分发，也不改变其许可

若上游作者对本仓库引用其片段有异议，请提 issue，我会移除相应片段。

## 本项目自身许可

MIT，见 `LICENSE`。

## 第三方依据（非代码引用，仅事实陈述）

文档里引用了若干**官方 DSH 代码事实**（例如官方存在 `ctx.uiWorkspace.openSession()` 这个接口），
来源为本机安装的 DeepSeek Harness 发行包。这类引用是**事实陈述与定位说明**，不复制其实现代码。
