# 命运轮盘 · 服务端 API 端到端自检
# 说明：Windows PowerShell 对原生参数中的引号处理不稳定，因此所有请求体一律写入临时文件后用 --data-binary "@file" 发送。
$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:3000'
$tmp = Join-Path $env:TEMP 'roulette-api-test'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$script:failed = 0
function Check([bool]$cond, [string]$msg) {
  if ($cond) { Write-Host "  PASS  $msg" -ForegroundColor Green }
  else { Write-Host "  FAIL  $msg" -ForegroundColor Red; $script:failed++ }
}
function Body([hashtable]$h) {
  $f = Join-Path $tmp ("body-" + [guid]::NewGuid().ToString('N') + '.json')
  [System.IO.File]::WriteAllText($f, ($h | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))
  return $f
}
function Post([string]$path, [hashtable]$h, [string]$playerId) {
  $f = Body $h
  $a = @('-sS', '-X', 'POST', "$base$path", '-H', 'Content-Type: application/json', '--data-binary', "@$f")
  if ($playerId) { $a += @('-H', "x-player-id: $playerId") }
  return (((curl.exe @a) -join "`n") | ConvertFrom-Json)
}

Write-Host "`n=== 1. 健康检查与常量 ==="
$health = (((curl.exe -sS "$base/api/health") -join "`n") | ConvertFrom-Json)
Check $health.ok 'GET /api/health 正常'
$opt = (((curl.exe -sS "$base/api/options") -join "`n") | ConvertFrom-Json)
Check ($opt.colors.Count -eq 4) '颜色数量 = 4'
Check (((($opt.colors | ForEach-Object { $_.key }) -join ',')) -eq 'yellow,blue,green,red') '颜色顺序 = 黄蓝绿红'
Check ((((($opt.colors | Where-Object { $_.key -eq 'green' }).expectedNumbers) -join ',')) -eq '7,8,9') '绿 = 数字 7,8,9'

Write-Host "`n=== 2. 进入房间（同一种颜色允许多人）==="
$reset = Post '/api/reset' @{ keepPlayers = $false } $null
Check ($reset.state.players.Count -eq 0) "清空（不保留玩家）后玩家数 = $($reset.state.players.Count)"
Check ($reset.state.spins.Count -eq 0) "清空后记录数 = $($reset.state.spins.Count)"

$a = Post '/api/join' @{ name = '阿明'; color = 'red' }
Check (($a.player.name -eq '阿明') -and ($a.player.color -eq 'red')) '阿明 登记为 红'
Check ($a.player.token.Length -ge 20) '返回了身份 token'
$b = Post '/api/join' @{ name = '老王'; color = 'green' }
$c = Post '/api/join' @{ name = '小美'; color = 'green' }
Check ($b.player.id -ne $c.player.id) '两人可共用一个绿颜色'
Check ($c.state.players.Count -eq 3) "state 中玩家数 = $($c.state.players.Count)（期望 3）"

$a2 = Post '/api/join' @{ name = '阿明'; color = 'red'; playerId = $a.player.id; token = $a.player.token }
Check (($a2.resumed -eq $true) -and ($a2.player.id -eq $a.player.id)) '同一设备重进恢复原身份（未重复占位）'
Check ($a2.state.players.Count -eq 3) "恢复后玩家数仍为 $($a2.state.players.Count)（期望 3）"

Write-Host "`n=== 3. 转动与步数记账 ==="
foreach ($n in @(12, 5, 0, 12, 3)) {
  Start-Sleep -Milliseconds 1300
  $s = Post '/api/spin' @{ num = $n; pocket = 7 } $a.player.id
  Check ($s.spin.steps -eq $n) "数字 $n → 步数 $($s.spin.steps)"
  Check ($s.spin.color -eq 'red') '记录颜色 = red'
}
$st = (((curl.exe -sS "$base/api/state" -H "x-player-id: $($a.player.id)") -join "`n") | ConvertFrom-Json)
$ming = $st.players | Where-Object { $_.id -eq $a.player.id }
Check ($ming.steps -eq 32) "阿明累计步数 = $($ming.steps)（12+5+0+12+3 = 32，0 不前进）"
Check ($ming.spinCount -eq 5) "阿明转动次数 = $($ming.spinCount)"
Check ($st.spins.Count -eq 5) "记录条数 = $($st.spins.Count)"
Check ($st.spins[0].num -eq 3) '最新记录在最前（num = 3）'
Check ($st.totalSteps -eq 32) "全员总步数 = $($st.totalSteps)"
$wang = $st.players | Where-Object { $_.id -eq $b.player.id }
Check ($wang.steps -eq 0) '其他人的棋子不前进（老王 = 0 步）'
Check ($ming.lastSpinNum -eq 3) "顶部展示用字段：最近一次数字 = $($ming.lastSpinNum)"
Check ($ming.lastSpinSteps -eq 3) "顶部展示用字段：最近一次步数 = $($ming.lastSpinSteps)"
Check ($null -ne $ming.lastSpinAt) '顶部展示用字段：最近一次时间存在（前端据此算「xx秒前」）'
Check ($null -eq $wang.lastSpinNum) '未转动过的玩家最近一次为 null（前端显示「尚未转动」）'

Write-Host "`n=== 4. 公平性 / 防刷校验 ==="
$r1 = Post '/api/spin' @{ num = 7 } $a.player.id
Check ($r1.error -like '*稍候*') "防连点生效：$($r1.error)"
$r2 = Post '/api/spin' @{ num = 99 } $a.player.id
Check ($r2.error -like '*无效*') "非法数字被拒：$($r2.error)"
$r3 = Post '/api/spin' @{ num = 4 } 'not-a-real-id'
Check ($r3.error -like '*身份*') "伪造身份被拒：$($r3.error)"

Write-Host "`n=== 5. 批量试验不改变步数 ==="
$before = ((((curl.exe -sS "$base/api/state") -join "`n") | ConvertFrom-Json)).totalSteps
$sim = Post '/api/simulate' @{ times = 3700 } $a.player.id
Check ($sim.times -eq 3700) '试验 3700 次已受理'
$after = (((curl.exe -sS "$base/api/state" -H "x-player-id: $($a.player.id)") -join "`n") | ConvertFrom-Json)
Check ($after.totalSteps -eq $before) "试验不改变任何步数（$before → $($after.totalSteps)）"
Check ($after.mySimCount -eq 3700) "本设备样本数 = $($after.mySimCount)"
Check ((($after.simCounts | Measure-Object -Sum).Sum) -eq 3700) '样本总数 = 3700'

Write-Host "`n=== 6. 静态页面 / 前端产物 ==="
$page = (curl.exe -sS "$base/") -join "`n"
Check ($page -match '<div id="app">') '生产模式托管前端 index.html'
$idx = (curl.exe -sS "$base/log") -join "`n"
Check ($idx -match '<div id="app">') '/log 深链接回退到 SPA（history 路由）'
$assetPath = [regex]::Match($page, 'src="(/assets/[^"]+\.js)"').Groups[1].Value
Check ($assetPath -ne '') "首页引用了打包产物：$assetPath"
if ($assetPath) {
  $assetCode = (curl.exe -sS -o NUL -w '%{http_code}' "$base$assetPath") -join ''
  Check ("$assetCode" -eq '200') "静态资源可访问（HTTP $assetCode）"
}
$bad = (curl.exe -sS -o NUL -w '%{http_code}' -X POST "$base/api/spin" -H 'Content-Type: application/json' --data-binary 'not json') -join ''
Check ("$bad" -eq '400') "坏 JSON 返回 400 而不是崩溃（HTTP $bad）"
Check (((((curl.exe -sS "$base/api/health") -join "`n") | ConvertFrom-Json)).ok) '坏请求后服务仍存活'

Write-Host "`n=== 7. 数据持久化 ==="
$dataFile = 'D:\AI_proj\dsh1\roulette-online\data\game-state.json'
Start-Sleep -Milliseconds 500
$saved = Get-Content $dataFile -Raw -Encoding UTF8 | ConvertFrom-Json
Check ($saved.players.Count -eq 3) "存档中玩家数 = $($saved.players.Count)（期望 3）"
Check ($saved.spins.Count -eq 5) "存档中记录条数 = $($saved.spins.Count)（期望 5）"
Check ($saved.players[0].token.Length -ge 20) '存档保留身份 token（重启后仍可继续）'

Write-Host "`n=== 8. 重置 = 先备份后清空 ==="
$beforeArchives = $a2.state.archives.Count
$reset1 = Post '/api/reset' @{ keepPlayers = $true } $a.player.id
Check ($null -ne $reset1.archived) '重置后返回了备份摘要'
Check ($reset1.archived.spinCount -eq 5) "备份包含全部 5 条记录（实际 $($reset1.archived.spinCount)）"
Check ($reset1.archived.totalSteps -eq 32) "备份合计步数 = 32（实际 $($reset1.archived.totalSteps)）"
Check ($reset1.archived.playerCount -eq 3) "备份记录 3 位玩家（实际 $($reset1.archived.playerCount)）"
Check ($reset1.archived.id -notmatch '\s') "备份 ID 不含空格、可安全放进 URL（$($reset1.archived.id)）"
Check ($reset1.state.spins.Count -eq 0) '重置后当前记录清空'
Check ($reset1.state.players.Count -eq 3) '重置保留了玩家颜色（keepPlayers=true）'
Check ($reset1.state.players[0].steps -eq 0) '重置后步数归零'
Check ($reset1.state.archives.Count -eq $beforeArchives + 1) "备份列表增加 1 局（$beforeArchives → $($reset1.state.archives.Count)）"

$reset2 = Post '/api/reset' @{ keepPlayers = $true } $a.player.id
Check ($null -eq $reset2.archived) '空局再重置不会产生空备份'
Check ($reset2.state.archives.Count -eq $beforeArchives + 1) '备份数量没有虚增'

Write-Host "`n=== 9. 备份读取 / 导出 / 删除 ==="
$aid = $reset1.archived.id
$detail = (((curl.exe -sS "$base/api/archives/$aid") -join "`n") | ConvertFrom-Json).archive
Check ($detail.spins.Count -eq 5) "备份详情含 5 条记录（实际 $($detail.spins.Count)）"
Check ($detail.players.Count -eq 3) '备份详情含 3 位玩家'
Check (($detail.players | Where-Object { $_.name -eq '阿明' }).steps -eq 32) '备份里保留了当时的累计步数'

$csvPath = Join-Path $env:TEMP 'roulette-selftest-archive.csv'
curl.exe -sS -o $csvPath "$base/api/archives/$aid/export.csv" | Out-Null
$csv = Get-Content $csvPath -Raw -Encoding UTF8
Check ($csv -match '对局') 'CSV 含对局信息表头'
Check ($csv -match '阿明') 'CSV 含玩家姓名'
Check (($csv -split "`r`n").Count -ge 8) "CSV 行数 = $(($csv -split "`r`n").Count)"
$badArchive = (curl.exe -sS -o NUL -w '%{http_code}' "$base/api/archives/not-exist") -join ''
Check ("$badArchive" -eq '404') "读取不存在的备份返回 404（HTTP $badArchive）"

$deleted = (((curl.exe -sS -X DELETE "$base/api/archives/$aid") -join "`n") | ConvertFrom-Json)
Check ($deleted.ok -eq $true) '删除备份成功'
Check ($deleted.archives.Count -eq $beforeArchives) '删除后备份列表回到原数量'
Check (-not (Test-Path "D:\AI_proj\dsh1\roulette-online\data\archive\$aid.json")) '磁盘上的备份文件已删除'

Write-Host "`n============================"
if ($script:failed -eq 0) { Write-Host '全部断言通过 OK' -ForegroundColor Green }
else { Write-Host "$script:failed 项断言失败" -ForegroundColor Red }
exit $script:failed
