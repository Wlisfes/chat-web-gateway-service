$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$administratorRole = [Security.Principal.WindowsBuiltInRole]::Administrator

if (-not $principal.IsInRole($administratorRole)) {
    Write-Host '正在请求管理员权限，请在 UAC 窗口中选择“是”...'
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $process.ExitCode
}

$ruleName = 'Chat Web infrastructure via WireGuard'
# Redis 的 Docker 发布端口改为本机回环 16379，避免与 Windows portproxy 的监听端口冲突。
# 云端 Nginx 公网 6379 通过 WireGuard 访问本机 18080，再由 portproxy 转到 127.0.0.1:16379。
$ports = [string[]]@('3306', '18080', '5672', '9092', '15672', '80', '443', '8848', '9848')
$forwardMappings = [ordered]@{
    18080 = 16379
    5672 = 5672
    9092 = 9092
    15672 = 15672
}

Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

# 清理本次故障排查期间创建的 Redis 专用规则，统一由上面的基础设施规则管理。
Get-NetFirewallRule -DisplayName @('Chat Web Redis WireGuard proxy 18080', 'Chat Web Redis via WireGuard') -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -InterfaceAlias 'chat-web-home' `
    -Protocol TCP `
    -LocalPort $ports `
    -Profile Any `
    -Description '允许云端 Nginx 通过 WireGuard 访问 Chat Web 基础设施服务'

# 清理早期 Redis 方案留下的监听规则，避免旧 6379/16379 规则与新映射并存。
foreach ($legacyPort in [string[]]@('6379', '16379')) {
    & netsh.exe interface portproxy delete v4tov4 listenaddress=10.66.0.2 listenport=$legacyPort protocol=tcp | Out-Null
}

foreach ($port in $forwardMappings.Keys) {
    $connectPort = $forwardMappings[$port]
    & netsh.exe interface portproxy delete v4tov4 listenaddress=10.66.0.2 listenport=$port protocol=tcp | Out-Null
    & netsh.exe interface portproxy add v4tov4 listenaddress=10.66.0.2 listenport=$port connectaddress=127.0.0.1 connectport=$connectPort protocol=tcp | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "创建端口代理失败: 10.66.0.2:$port -> 127.0.0.1:$connectPort"
    }
}

Write-Host "已允许 WireGuard 接口 chat-web-home 访问端口: $($ports -join ', ')"
$mappingSummary = $forwardMappings.GetEnumerator() | ForEach-Object { "$($_.Key)->$($_.Value)" }
Write-Host "已创建 Docker Desktop 端口代理: $($mappingSummary -join ', ')"
