# apply.ps1 — 重新打上「通知点击跳转」补丁
# 用法：双击同目录 apply.bat（**先完全退出 DSH** 更稳）
#
# 这个脚本调用补丁引擎（apply-engine.mjs）：逐条校验锚点唯一 → 自动备份 → 写入。
# 任何一条锚点命中次数不是 1，就整体中止且不写任何文件。
$ErrorActionPreference = 'Continue'   # 末端的 Read-Host 在输入被重定向时会抛错，不该让脚本报错退出；
                                      # 真正要严格失败的地方用显式 -ErrorAction Stop 与 $LASTEXITCODE 判断
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
# 路径解析与 ../paths.mjs 同一套规则：环境变量优先，缺省按用户目录推导。
# （这样才能公开出去：不写死任何一台机器的绝对路径。）
$pluginDir = if ($env:DSH_NOTIFIER_PLUGIN_DIR) { $env:DSH_NOTIFIER_PLUGIN_DIR }
             else { Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\@wingsky-1\dsh-notifier' }

Write-Host ""
Write-Host "=========== dsh-notifier 会话跳转补丁 · 应用 ===========" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $pluginDir)) {
  Write-Host ("找不到插件目录：{0}" -f $pluginDir) -ForegroundColor Red
  Write-Host "插件没装，本补丁无从应用。" -ForegroundColor Yellow
  Read-Host "按回车关闭"; exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "没找到 node 命令，无法运行补丁引擎。" -ForegroundColor Red
  Read-Host "按回车关闭"; exit 1
}

$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'DeepSeek' }
if ($procs) {
  Write-Host ("提示：DSH 正在运行（{0} 个进程）。" -f $procs.Count) -ForegroundColor Yellow
  Write-Host "补丁改的是插件文件；改完必须**重启 DSH + 强刷页面**才生效。" -ForegroundColor Yellow
  Write-Host ""
}

Write-Host "先做一次试运行（只检查、不写文件）……" -ForegroundColor Cyan
& node (Join-Path $here 'apply.mjs') --dry-run
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "试运行发现问题，已中止，未改动任何文件。" -ForegroundColor Red
  Write-Host "多半是插件版本变了（锚点对不上）。把本窗口内容发我，我来适配新版本。" -ForegroundColor Yellow
  Read-Host "按回车关闭"; exit 1
}

Write-Host ""
Write-Host "试运行通过，现在正式应用……" -ForegroundColor Cyan
& node (Join-Path $here 'apply.mjs')
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "应用失败，未改动任何文件（引擎保证不半途而废）。" -ForegroundColor Red
  Read-Host "按回车关闭"; exit 1
}

Write-Host ""
Write-Host "补丁已应用。" -ForegroundColor Green
Write-Host "接下来：① 完全退出 DSH；② 重新启动；③ 启动后按 Ctrl+F5 强制刷新页面。" -ForegroundColor Green
Write-Host "然后双击 verify.bat 确认状态，再实际点一次通知试试。" -ForegroundColor Green
Write-Host ""
Read-Host "按回车关闭"
