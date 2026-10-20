# verify.ps1 — 只读复核：会话跳转补丁现在是什么状态
# 用法：双击同目录 verify.bat（不会修改任何东西）
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$pluginDir   = if ($env:DSH_NOTIFIER_PLUGIN_DIR) { $env:DSH_NOTIFIER_PLUGIN_DIR }
               else { Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\@wingsky-1\dsh-notifier' }
# 备份根：环境变量优先；缺省取本项目目录上两级下的 _backup
$projectDir  = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$backupRoot  = if ($env:DSH_NOTIFIER_BACKUP_ROOT) { $env:DSH_NOTIFIER_BACKUP_ROOT }
               else { [System.IO.Path]::GetFullPath((Join-Path $projectDir '..\..\_backup')) }
# 备份按「原路径去盘符」保存；这段相对路径从插件目录推出，不写死用户名。
$pluginRelPath = $pluginDir -replace '^[A-Za-z]:\\', ''
$historyPath = Join-Path $env:USERPROFILE '.dsh\@wingsky-1\dsh-notifier\history.jsonl'

function Line($n, $s) { Write-Host ("  [{0}] {1}" -f $n, $s) }
function Ok($s)   { Write-Host ("  ✓ {0}" -f $s) -ForegroundColor Green }
function Bad($s)  { Write-Host ("  ✗ {0}" -f $s) -ForegroundColor Red }
function Warn($s) { Write-Host ("  ! {0}" -f $s) -ForegroundColor Yellow }

Write-Host ""
Write-Host "=========== dsh-notifier 会话跳转补丁 · 复核 ===========" -ForegroundColor Cyan

# ---- 1. 插件在不在 ----
Write-Host ""
Write-Host "1. 插件安装体" -ForegroundColor Cyan
if (-not (Test-Path $pluginDir)) {
  Bad "找不到插件目录：$pluginDir"
  Write-Host "    判读：插件没装，本补丁无法生效。" -ForegroundColor Yellow
  Write-Host ""
  Read-Host "按回车关闭"
  exit 1
}
$pj = Get-Content (Join-Path $pluginDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Ok ("插件存在，包内版本 {0}" -f $pj.version)

# ---- 2. 补丁是否在位（唯一判据：去装一个标记特征）----
Write-Host ""
Write-Host "2. 补丁是否在位" -ForegroundColor Cyan
$serverPath = Join-Path $pluginDir 'lib\index.js'
$clientPath = Join-Path $pluginDir 'lib\client.js'
$marksServer = @(
  'function sessionIdOf(agent)',
  'if (typeof message.sessionId === "string" && message.sessionId.length > 0)',
  'if (typeof frame.sessionId === "string" && frame.sessionId.length > 0)'
)
# 判据一律只用 ASCII 子串：本机只有 Windows PowerShell 5.1，它对无 BOM 脚本按 GBK 解码，
# 中文判据会被读成乱码而永远匹配不上（实测踩到过：即使补丁在位也会误报「未应用」）。
$marksClient = @(
  'session-jump.ts',
  'sessionJumper.jump(sessionId, kind);',
  'clientContext.current = ctx;'
)
$serverOk = Test-Path $serverPath
$clientOk = Test-Path $clientPath
foreach ($m in $marksServer) {
  if (-not ((Get-Content $serverPath -Raw -Encoding UTF8).Contains($m))) { $serverOk = $false }
}
foreach ($m in $marksClient) {
  if (-not ((Get-Content $clientPath -Raw -Encoding UTF8).Contains($m))) { $clientOk = $false }
}
if ($serverOk) { Ok "服务端产物：补丁特征齐全（会话 ID 会随通知下发）" }
else { Warn "服务端产物：缺补丁特征 → 通知不会带会话 ID，点击也就不会跳转" }
if ($clientOk) { Ok "客户端产物：补丁特征齐全（点击通知会切会话）" }
else { Warn "客户端产物：缺补丁特征 → 点击不会跳转" }
if ($serverOk -and $clientOk) {
  Write-Host "    → 结论：补丁已应用。" -ForegroundColor Green
} else {
  Write-Host "    → 结论：补丁**未**应用（或是被插件升级覆盖了）。双击 apply.bat 可重新打上。" -ForegroundColor Yellow
}

# ---- 3. 备份是否还在 ----
Write-Host ""
Write-Host "3. 备份（改坏了靠它还原）" -ForegroundColor Cyan
$backups = Get-ChildItem $backupRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName $pluginRelPath) } |
  Sort-Object Name -Descending | Select-Object -First 3
if ($backups) {
  foreach ($b in $backups) { Ok ("备份目录 {0}" -f $b.FullName) }
  Write-Host "    → 双击 restore.bat 可还原。" -ForegroundColor Green
  Write-Host "      （还原脚本会自己挑「打补丁前」的那一份，并跳过含补丁的备份，不必你手动分辨。）" -ForegroundColor DarkGray
} else {
  Warn ("在 {0} 下没找到针对本插件的备份（还原脚本将无从下手）" -f $backupRoot)
}

# ---- 4. DSH 是否在运行（决定还要不要重启）----
Write-Host ""
Write-Host "4. 生效条件" -ForegroundColor Cyan
$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'DeepSeek' }
if ($procs) {
  Warn ("DSH 正在运行（{0} 个进程）" -f $procs.Count)
  Write-Host "    → 宿主只在**启动时**组合插件与前端产物。若补丁是刚打上的：" -ForegroundColor Yellow
  Write-Host "      ① 完全退出 DSH 再启动；② 启动后**强制刷新一次浏览器页面**（Ctrl+F5）。" -ForegroundColor Yellow
} else {
  Ok "DSH 未运行 → 下次启动就是干净的重新组合"
}
Write-Host "    （若补丁是在本次启动之前就有的，则无需重启。）" -ForegroundColor DarkGray

# ---- 5. 通知历史（顺带看一眼通知是否正常）----
Write-Host ""
Write-Host "5. 通知历史（最近 3 条，确认通知本身还在工作）" -ForegroundColor Cyan
if (Test-Path $historyPath) {
  foreach ($l in (Get-Content $historyPath -Tail 3 -Encoding UTF8)) {
    try {
      $o = $l | ConvertFrom-Json
      $t = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$o.ts).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss')
      Write-Host ("    {0}  [{1}] {2}" -f $t, $o.kind, (($o.title + ' ' + $o.message) -replace "`n", ' '))
    } catch { Warn "有一行历史解析失败（不影响通知功能）" }
  }
  Write-Host ("    文件最后写入：{0}" -f (Get-Item $historyPath).LastWriteTime)
} else { Warn "没有历史文件（可能还没触发过通知）" }

# ---- 怎么自测 ----
Write-Host ""
Write-Host "=========== 怎么亲眼验证跳转 ===========" -ForegroundColor Cyan
Write-Host "  ① 让 DSH 在后台干点活（例如丢一个需要审批的操作给它）；"
Write-Host "  ② 切走干别的（页面不可见时才会弹系统通知）；"
Write-Host "  ③ 通知弹出后**点它** → 界面应切到那条通知所属的会话。"
Write-Host "  （页面可见时走页面内横幅通道，点横幅同样会跳。）"
Write-Host ""
Write-Host "  如果点了没反应：先确认补丁在位（第 2 节），再确认已重启 + 强刷页面。"
Write-Host "  通知照常弹、只是不跳 = 跳转被安全兜住了（宁可不动，不可跳错），"
Write-Host "  可在 DSH 的开发者控制台里搜 “dsh-notifier” 看告警原因。"
Write-Host ""
Read-Host "按回车关闭"
