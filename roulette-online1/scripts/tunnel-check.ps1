# 自定义域名（Cloudflare Tunnel）连通性诊断
#
#   powershell -File scripts\tunnel-check.ps1
#   powershell -File scripts\tunnel-check.ps1 -Domain n.od8.top -LocalPort 3000
#
# 依次检查：本地服务 → 本机 DNS → 公共 DNS → 域名可达性 → 静态资源 / API / WebSocket
param(
  [string]$Domain = 'n.od8.top',
  [int]$LocalPort = 3000
)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$script:failed = 0
function Ok([string]$m) { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Bad([string]$m) { Write-Host "  [!!]   $m" -ForegroundColor Red; $script:failed++ }
function Info([string]$m) { Write-Host "         $m" -ForegroundColor DarkGray }

Write-Host "`n=== 1. 本地服务 127.0.0.1:$LocalPort ==="
$listen = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
if ($listen) {
  Ok "端口 $LocalPort 正在监听（$(($listen | ForEach-Object { $_.LocalAddress }) -join ', ')）"
  $h = curl.exe -sS -m 8 "http://127.0.0.1:$LocalPort/api/health" 2>$null
  if ($h -match '"ok":true') { Ok "本机 /api/health 正常" } else { Bad "本机 /api/health 异常：$h" }
} else {
  Bad "端口 $LocalPort 没有监听 —— 请先执行 npm start（生产单端口）"
}

Write-Host "`n=== 2. cloudflared 隧道进程 ==="
$cf = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($cf) { Ok "cloudflared 正在运行（PID $(($cf | ForEach-Object { $_.Id }) -join ', ')）" }
else { Bad "cloudflared 未运行 —— 隧道断开时域名会返回 Cloudflare 1033 错误" }
$cfExe = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (Test-Path $cfExe) {
  $cfg = Join-Path $env:USERPROFILE '.cloudflared\config.yml'
  if (Test-Path $cfg) {
    Info "发现本地配置文件：$cfg（本地管理模式，改这个文件）"
    Get-Content $cfg | Where-Object { $_ -match '\S' } | ForEach-Object { Info "  $_" }
  } else {
    Info "没有 $cfg ——说明是【面板托管隧道】，入口规则要在 Cloudflare Zero Trust 面板里改"
  }
}

Write-Host "`n=== 3. DNS 解析 $Domain ==="
$publicIps = @()
# 注意：Resolve-DnsName -Server 在部分网络 / 安全软件下不稳定，这里统一用 nslookup
function Resolve-Via($server) {
  # 显式查 A 记录：有些递归服务器把 IPv4 放在 Additional 段，nslookup 默认输出容易漏
  $out = & nslookup -type=A $Domain $server 2>$null
  $v4 = @()
  $any = @()
  foreach ($line in $out) {
    if ($line -match '^\s*(Addresses?|地址)\s*:\s*(.+)$') {
      foreach ($v in ($Matches[2] -split '\s+')) {
        if ($v -match '^\d{1,3}(\.\d{1,3}){3}$') { if ($v -ne $server) { $v4 += $v } }
        elseif ($v -match '^[0-9a-fA-F:]{6,}$') { $any += $v }
      }
    }
  }
  if ($v4) { return ($v4 | Select-Object -Unique) }
  return ($any | Select-Object -Unique)
}
foreach ($r in @('8.8.8.8', '1.1.1.1', '114.114.114.114', '223.5.5.5')) {
  $ips = Resolve-Via $r
  if ($ips) { Ok "$r -> $($ips -join ', ')"; $publicIps += $ips } else { Bad "$r -> 解析失败" }
}
$firstDns = (Get-DnsClientServerAddress -AddressFamily IPv4 |
  Where-Object { $_.ServerAddresses } | Select-Object -First 1).ServerAddresses[0]
$localIps = Resolve-Via $firstDns
if ($localIps) {
  Ok "本机默认解析器（$firstDns） -> $($localIps -join ', ')"
} else {
  Bad "本机默认解析器解析失败（这就是浏览器打不开域名的原因）"
  $dns = Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses }
  foreach ($d in $dns) { Info "$($d.InterfaceAlias) 使用 DNS: $($d.ServerAddresses -join ', ')" }
  Info "修复：把网卡 DNS 改成 223.5.5.5 / 119.29.29.29，或 8.8.8.8；改完执行 ipconfig /flushdns"
}

Write-Host "`n=== 4. 域名可达性与内容 ==="
$ip = ($publicIps | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1)
$extra = @()
if ($ip) { $extra = @('--resolve', "${Domain}:443:$ip") ; Info "用 --resolve $Domain -> $ip 绕过本机 DNS" }
$code = (curl.exe -sS @extra -k --ssl-no-revoke -m 25 -o "$env:TEMP\tc.html" -w '%{http_code}' "https://$Domain/") -join ''
switch ($code) {
  '200' { Ok "https://$Domain/ -> HTTP 200" }
  '502' { Bad "HTTP 502 —— 隧道在线但回源失败：确认隧道指向的是 127.0.0.1:$LocalPort 且本机服务在跑" }
  '530' { Bad "HTTP 530 —— Cloudflare 找不到隧道（1033）：隧道已断开或域名绑定的隧道不对" }
  '403' { Bad "HTTP 403 —— 可能开了 Cloudflare Access 或 WAF 拦截" }
  default { Bad "https://$Domain/ -> HTTP $code" }
}
if (Test-Path "$env:TEMP\tc.html") {
  $body = Get-Content "$env:TEMP\tc.html" -Raw
  if ($body -match '<div id="app">') { Ok "返回的是本项目页面（含 #app 挂载点）" }
  elseif ($body -match 'challenge-platform|cf-chl|Just a moment') { Bad "返回的是 Cloudflare 验证页 —— 到面板关闭该主机的 Security Challenge / Under Attack 模式" }
  else { Bad "返回内容不是本项目页面（前 120 字符）：$($body.Substring(0, [Math]::Min(120, $body.Length)))" }
}

Write-Host "`n=== 5. 静态资源 / API / WebSocket ==="
$html = if (Test-Path "$env:TEMP\tc.html") { Get-Content "$env:TEMP\tc.html" -Raw } else { '' }
$asset = [regex]::Match($html, 'src="(/assets/[^"]+\.js)"').Groups[1].Value
if ($asset) {
  $ac = (curl.exe -sS @extra -k --ssl-no-revoke -m 25 -o NUL -w '%{http_code} %{size_download}' "https://$Domain$asset") -join ''
  if ($ac -match '^200') { Ok "静态资源 $asset -> $ac" } else { Bad "静态资源 $asset -> $ac" }
} else { Info "跳过：页面上没找到 /assets/*.js（可能不是本项目页面）" }
$api = (curl.exe -sS @extra -k --ssl-no-revoke -m 25 "https://$Domain/api/health") -join ''
if ($api -match '"ok":true') { Ok "API /api/health -> $api" } else { Bad "API /api/health -> $api" }
$hs = (curl.exe -sS @extra -k --ssl-no-revoke -m 25 "https://$Domain/socket.io/?EIO=4&transport=polling") -join ''
if ($hs -match '^\d+\{') { Ok "Socket.IO 轮询握手正常：$($hs.Substring(0, [Math]::Min(60, $hs.Length)))" } else { Bad "Socket.IO 握手异常：$hs" }
$ws = (curl.exe -sS @extra -k --ssl-no-revoke -m 8 -o NUL -w '%{http_code}' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H "Origin: https://$Domain" "https://$Domain/socket.io/?EIO=4&transport=websocket") -join ''
if ($ws -eq '101' -or $ws -eq '000') { Ok "WebSocket 升级 -> HTTP 101（101 为成功；连接保持不关闭导致超时属正常）" } else { Bad "WebSocket 升级 -> HTTP $ws" }

Write-Host "`n=== 6. 本机 hosts 应急方案 ==="
$hosts = "$env:WINDIR\System32\drivers\etc\hosts"
$line = (Get-Content $hosts -ErrorAction SilentlyContinue | Where-Object { $_ -match "\s$([regex]::Escape($Domain))(\s|$)" })
if ($line) { Info "hosts 已有记录：$($line -join ' | ')" }
elseif ($ip) { Info "如本机 DNS 修不好，可用管理员权限往 $hosts 追加一行：$ip $Domain" }
else { Info "未取到 Cloudflare IP，无法给出 hosts 建议" }

Write-Host "`n============================"
if ($script:failed -eq 0) { Write-Host "自定义域名链路全部正常 OK" -ForegroundColor Green }
else { Write-Host "$script:failed 项需要处理" -ForegroundColor Red }
exit $script:failed
