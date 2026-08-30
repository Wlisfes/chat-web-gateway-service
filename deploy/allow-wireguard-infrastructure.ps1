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
# 基础设施容器的 RabbitMQ/Kafka 端口均发布到本机回环，再通过独立的
# WireGuard 端口代理对云端开放，避免 Docker Desktop 占用 10.66.0.2 上的监听地址。
# 防火墙只放行 WireGuard 实际需要的入口端口，不再放行旧的 5672/15672/9092 监听。
$ports = [string[]]@('3306', '18080', '18081', '18082', '18083', '80', '443', '8848', '9848')
$forwardMappings = [ordered]@{
    '18080' = 16379
    '18081' = 15674
    '18082' = 15673
    '18083' = 19092
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

# 清理旧版直接暴露的 Redis/RabbitMQ/Kafka 监听规则，避免旧映射与新代理并存。
foreach ($legacyPort in [string[]]@('6379', '16379', '5672', '15672', '9092')) {
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
