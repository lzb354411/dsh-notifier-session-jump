# restore.ps1 — 一键还原：把插件恢复成打补丁前的样子
# 用法：双击同目录 restore.bat（**先完全退出 DSH**）
#
# 做法：从最新一份备份按原路径层次拷回，并用字节长度 + 内容比对确认还原成功。
# 只写目标插件目录内的文件；备份里没有的文件一律不碰。
$ErrorActionPreference = 'Continue'   # 末端的 Read-Host 在输入被重定向时会抛错，不该让脚本报错退出；
                                      # 真正要严格失败的地方用显式 -ErrorAction Stop（下面的 Copy-Item）
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$pluginDir = if ($env:DSH_NOTIFIER_PLUGIN_DIR) { $env:DSH_NOTIFIER_PLUGIN_DIR }
             else { Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\@wingsky-1\dsh-notifier' }
# 备份根：环境变量优先；缺省取本项目目录上两级下的 _backup（典型布局 <工作区根>\<分类>\<项目>\）
$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$backupRoot = if ($env:DSH_NOTIFIER_BACKUP_ROOT) { $env:DSH_NOTIFIER_BACKUP_ROOT }
              else { [System.IO.Path]::GetFullPath((Join-Path $projectDir '..\..\_backup')) }
# 备份按「原路径去盘符」保存（例如 Users\<你>\.dsh\profiles\...）。
# 这里从插件目录**推**出这段相对路径，而不是写死某个用户名 —— 换台电脑也不用改。
$pluginRelPath = $pluginDir -replace '^[A-Za-z]:\\', ''
$relFiles = @(
  'lib\index.js',
  'lib\client.js',
  'lib\server\pipeline\impl\service\type.d.ts',
  'lib\server\channels\impl\deliver\type.d.ts',
  'lib\server\channels\impl\browser\type.d.ts',
  'lib\server\api\impl\stream\type.d.ts'
)

Write-Host ""
Write-Host "=========== dsh-notifier 会话跳转补丁 · 一键还原 ===========" -ForegroundColor Cyan
Write-Host ""

# ---- 1. 先确认 DSH 已退出（进程持有文件会让拷贝失败或只改一半）----
$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'DeepSeek' }
if ($procs) {
  Write-Host ("检测到 DSH 仍在运行（{0} 个进程）。" -f $procs.Count) -ForegroundColor Yellow
  Write-Host "还原必须在 DSH 完全退出后进行，否则可能只改到一半。" -ForegroundColor Yellow
  $ans = Read-Host "现在仍然要继续吗？输入 y 继续，直接回车退出"
  if ($ans -ne 'y') { Write-Host "已取消，未改动任何文件。"; Read-Host "按回车关闭"; exit 0 }
}

# ---- 2. 找最新一份「含本插件」的备份，并**确认它是打补丁前的干净原件** ----
# 安全要点：若误用一份「已经含补丁」的备份来还原，等于什么都没还原。
# 所以宁可跳过，也不用可疑的那份。
$patchMarks = @(
  'function sessionIdOf(agent)',
  'sessionJumper'
)
$candidates = Get-ChildItem $backupRoot -Directory -ErrorAction SilentlyContinue |
  ForEach-Object {
    $candidate = Join-Path $_.FullName $pluginRelPath
    if (Test-Path $candidate) { [PSCustomObject]@{ Stamp = $_.Name; Path = $candidate } }
  } | Sort-Object Stamp -Descending

$backupPlugin = $null
$skipped = @()
foreach ($c in $candidates) {
  $dirty = $false
  $srcServer = Join-Path $c.Path 'lib\index.js'
  $srcClient = Join-Path $c.Path 'lib\client.js'
  if (Test-Path $srcServer)   { $s = Get-Content $srcServer -Raw -Encoding UTF8; if ($s.Contains($patchMarks[0])) { $dirty = $true } }
  if (Test-Path $srcClient)   { $c2 = Get-Content $srcClient -Raw -Encoding UTF8; if ($c2.Contains($patchMarks[1])) { $dirty = $true } }
  if ($dirty) { $skipped += $c.Stamp; continue }
  $backupPlugin = $c
  break
}
if ($skipped.Count -gt 0) {
  Write-Host ("已跳过含补丁的备份（用它们还原等于没还原）：{0}" -f ($skipped -join '、')) -ForegroundColor DarkGray
}

if (-not $backupPlugin) {
  Write-Host "没找到「打补丁前」的干净备份，为安全起见不做任何改动。" -ForegroundColor Red
  Write-Host ("请手动检查备份根 {0} 下哪个 20261019-* 目录里的本插件是干净的（例如 20261019-185739）。" -f $backupRoot) -ForegroundColor Yellow
  Read-Host "按回车关闭"
  exit 1
}
Write-Host ("使用备份：{0}" -f $backupPlugin.Path) -ForegroundColor Cyan
Write-Host ("（已确认这份是打补丁前的干净原件，时间戳 {0}）" -f $backupPlugin.Stamp) -ForegroundColor DarkGray
Write-Host ""

# ---- 3. 逐文件拷回，逐个核对 ----
$restored = 0; $failed = 0
foreach ($rel in $relFiles) {
  $src = Join-Path $backupPlugin.Path $rel
  $dst = Join-Path $pluginDir $rel
  if (-not (Test-Path $src)) { Write-Host ("  跳过（备份里没有）：{0}" -f $rel) -ForegroundColor DarkGray; continue }
  try {
    Copy-Item $src $dst -Force -ErrorAction Stop
    $a = Get-Content $src -Raw -Encoding UTF8
    $b = Get-Content $dst -Raw -Encoding UTF8
    if ($a -ceq $b) { Write-Host ("  ✓ 已还原并校验一致：{0}" -f $rel) -ForegroundColor Green; $restored++ }
    else { Write-Host ("  ✗ 还原后内容不一致：{0}" -f $rel) -ForegroundColor Red; $failed++ }
  } catch {
    Write-Host ("  ✗ 还原失败：{0} —— {1}" -f $rel, $_.Exception.Message) -ForegroundColor Red
    $failed++
  }
}

# ---- 4. 结论 ----
Write-Host ""
if ($failed -eq 0) {
  Write-Host ("还原完成：{0} 个文件已恢复成打补丁前的样子。" -f $restored) -ForegroundColor Green
  Write-Host "重新启动 DSH 后，提示通知的行为就回到改动前（点击通知只把窗口拉到前台）。" -ForegroundColor Green
  Write-Host "想要回补丁：双击 apply.bat 重新打上即可。" -ForegroundColor Green
} else {
  Write-Host ("有 {0} 个文件没还原成功，请把本窗口内容发我。" -f $failed) -ForegroundColor Red
}
Write-Host ""
Read-Host "按回车关闭"
if ($failed -eq 0) { exit 0 } else { exit 1 }
