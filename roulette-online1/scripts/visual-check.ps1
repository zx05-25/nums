# 可视化自检：准备一局演示数据 → 用无头 Edge 渲染并截图（桌面端 / 手机端）
#
#   scripts\visual-check.ps1             仅截图（截图后清空演示数据）
#   scripts\visual-check.ps1 -KeepData   截图后保留演示数据
#
# 说明：
#  - 需要服务器已在 3000 端口运行（npm start）
#  - 无头 Edge 无法向本目录直接写文件，因此截图先落到 %TEMP% 再复制回 docs/
#  - 无头 Edge 的最小布局视口约 504px，故「手机端」以 504px 宽度代表窄屏断点（<640px）
param(
  [switch]$KeepData,
  [int]$Width = 1440,
  [int]$Height = 1500
)
$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:3000'
$root = 'D:\AI_proj\dsh1\roulette-online'
$dist = Join-Path $root 'client\dist'
$docs = Join-Path $root 'docs'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$tmp = Join-Path $env:TEMP 'roulette-visual'
New-Item -ItemType Directory -Force -Path $docs, $tmp | Out-Null

function Post([string]$path, [hashtable]$h, [string]$playerId) {
  $f = Join-Path $tmp ("b-" + [guid]::NewGuid().ToString('N') + '.json')
  [System.IO.File]::WriteAllText($f, ($h | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))
  $a = @('-sS', '-X', 'POST', "$base$path", '-H', 'Content-Type: application/json', '--data-binary', "@$f")
  if ($playerId) { $a += @('-H', "x-player-id: $playerId") }
  return (((curl.exe @a) -join "`n") | ConvertFrom-Json)
}

function ShotTo($url, $name, $w, $h) {
  $t = Join-Path $env:TEMP "s-$name"
  for ($try = 1; $try -le 3; $try++) {
    Remove-Item $t -Force -ErrorAction SilentlyContinue
    & $edge --headless=new --disable-gpu --no-sandbox --hide-scrollbars --window-size="$w,$h" `
      --virtual-time-budget=12000 --screenshot=$t $url 2>$null | Out-Null
    Start-Sleep -Milliseconds 800
    if (Test-Path $t) {
      Copy-Item $t (Join-Path $docs $name) -Force
      Write-Host ("   OK   {0}  ({1} KB)" -f $name, [math]::Round((Get-Item $t).Length / 1KB))
      return
    }
    Start-Sleep -Seconds 2
  }
  Write-Host ("   FAIL {0}" -f $name) -ForegroundColor Red
}

Write-Host '>> 1/4 准备演示数据（四色各一位玩家 + 12 次真实转动）'
Post '/api/reset' @{ keepPlayers = $false } $null | Out-Null
$demo = @(
  @{ name = '阿明'; color = 'yellow' },
  @{ name = '小美'; color = 'blue' },
  @{ name = '老王'; color = 'green' },
  @{ name = '阿强'; color = 'red' }
)
$players = @()
foreach ($d in $demo) {
  $r = Post '/api/join' $d $null
  $players += [pscustomobject]@{ id = $r.player.id; name = $d.name; color = $d.color }
}
$i = 0
foreach ($n in @(3, 11, 7, 4, 12, 5, 0, 9, 6, 10, 2, 8)) {
  # 轮流由不同玩家上报；仍留出间隔，避免触发同一玩家的防连点保护
  $p = $players[$i % 4]
  Post '/api/spin' @{ num = $n; pocket = (Get-Random -Minimum 0 -Maximum 36) } $p.id | Out-Null
  $i++
  Start-Sleep -Milliseconds 1300
}
$st = ((curl.exe -sS "$base/api/state") -join "`n") | ConvertFrom-Json
Write-Host ("   玩家 {0} 位 · 记录 {1} 条 · 总步数 {2}" -f $st.players.Count, $st.spins.Count, $st.totalSteps)
$st.players | Sort-Object color | ForEach-Object { Write-Host ("   - {0,-6} {1,-7} {2,3} 步 · {3} 次" -f $_.name, $_.color, $_.steps, $_.spinCount) }

Write-Host "`n>> 2/4 生成带身份的检查页面（仅用于截图，重新构建即被覆盖）"
$index = [System.IO.File]::ReadAllText((Join-Path $dist 'index.html'), [System.Text.UTF8Encoding]::new($false))
$me = $players | Where-Object { $_.color -eq 'yellow' }
$identity = @{ id = $me.id; name = $me.name; color = $me.color; token = 'visual-check-token' } | ConvertTo-Json -Compress
foreach ($pair in @(@('__w.html', '/wheel'), @('__l.html', '/log'))) {
  $inject = "<script>localStorage.setItem('roulette.identity.v1','$identity');history.replaceState(null,'','$($pair[1])');</script>`n    "
  [System.IO.File]::WriteAllText((Join-Path $dist $pair[0]), $index.Replace('<div id="app"></div>', $inject + '<div id="app"></div>'), [System.Text.UTF8Encoding]::new($false))
}

Write-Host "`n>> 3/4 桌面端截图 ${Width}x${Height}"
ShotTo "$base/__w.html" 'wheel-desktop.png' $Width $Height
ShotTo "$base/__l.html" 'log-desktop.png' $Width $Height

Write-Host "`n>> 4/4 手机端截图 504x1700（无头浏览器最小布局视口，命中 <640px 断点）"
ShotTo "$base/__w.html" 'wheel-mobile.png' 504 1700
ShotTo "$base/__l.html" 'log-mobile.png' 504 1500

Remove-Item (Join-Path $dist '__w.html'), (Join-Path $dist '__l.html') -Force -ErrorAction SilentlyContinue
if (-not $KeepData) {
  Post '/api/reset' @{ keepPlayers = $false } $null | Out-Null
  Write-Host '   已清空演示数据（如需保留请加 -KeepData）'
}
Write-Host "`n截图已输出到：$docs"
