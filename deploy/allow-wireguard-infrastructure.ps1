$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$administratorRole = [Security.Principal.WindowsBuiltInRole]::Administrator

if (-not $principal.IsInRole($administratorRole)) {
    Write-Host '正在请求管理员权限，请在 UAC 窗口中选择“是”...'
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath) -Wait -PassThru
    exit $process.ExitCode
}

$ruleName = 'Chat Web infrastructure via WireGuard'
$remoteCidr = '10.66.0.0/24'
# 10.66.0.1 = 云端 Nginx；10.66.0.2 = Home 基础设施宿主；10.66.0.3 = 另一台客户端。
# RemoteAddress 必须是整段 10.66.0.0/24，同时覆盖 .1 和 .3。
# 禁止改成单个对端 IP；只许并集不许替换。改这边不能掐掉另一台。
# 计划任务 ChatWeb-WireGuard-PortProxy 只修 portproxy 监听，禁止改防火墙。
# 基础设施容器的 RabbitMQ/Kafka 端口均发布到本机回环，再通过独立的
# WireGuard 端口代理对云端和另一台客户端开放，避免 Docker Desktop 占用 10.66.0.2 上的监听地址。
# 防火墙只放行 WireGuard 实际需要的入口端口，不再放行旧的 5672/15672/9092 监听。
# 5000-5050 是注册到 Nacos 的 Chat Web 服务实例端口；业务容器发布到宿主机后，
# 云端 Gateway 和本地开发 Gateway 都通过 WireGuard 地址访问这些端口。
$ports = [string[]]@('3306', '5000', '5010', '5020', '5030', '5040', '5050', '18080', '18081', '18082', '18083', '80', '443', '8848', '9848')
$forwardMappings = [ordered]@{
    '18080' = 16379
    '18081' = 15674
    '18082' = 15673
    '18083' = 19092
}

Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

# 清理单 IP 遗留规则。这些规则把 Remote 写成 10.66.0.1 或 10.66.0.3 之一，会让两台机器互抢。
$legacyRuleNames = @(
    'Chat Web Rabbit Kafka via WireGuard',
    'Chat Web Redis WireGuard proxy 18080',
    'Chat Web Redis via WireGuard'
)
Get-NetFirewallRule -DisplayName $legacyRuleNames -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

$firewallParams = @{
    DisplayName = $ruleName
    Direction = 'Inbound'
    Action = 'Allow'
    InterfaceAlias = 'chat-web-home'
    Protocol = 'TCP'
    LocalPort = $ports
    RemoteAddress = $remoteCidr
    Profile = 'Any'
    Description = '允许 10.66.0.0/24 内所有 WireGuard 对端（含 10.66.0.1 云端和 10.66.0.3 客户端）访问 Chat Web 基础设施。禁止把 RemoteAddress 改成单个对端 IP；只许并集不许替换。'
}
New-NetFirewallRule @firewallParams | Out-Null

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
Write-Host "防火墙 RemoteAddress=$remoteCidr （禁止改成单个对端 IP）"
$mappingSummary = $forwardMappings.GetEnumerator() | ForEach-Object { "$($_.Key)->$($_.Value)" }
Write-Host "已创建 Docker Desktop 端口代理: $($mappingSummary -join ', ')"

$repairSource = Join-Path $PSScriptRoot 'repair-wireguard-portproxy.ps1'
$repairInstalled = 'C:\ProgramData\chat-web\repair-wireguard-portproxy.ps1'
$taskName = 'ChatWeb-WireGuard-PortProxy'

if (-not (Test-Path -LiteralPath $repairSource)) {
    throw "缺少修复脚本: $repairSource"
}

New-Item -ItemType Directory -Path 'C:\ProgramData\chat-web' -Force | Out-Null
Copy-Item -LiteralPath $repairSource -Destination $repairInstalled -Force

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $repairInstalled)
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$startupTrigger.Delay = 'PT45S'
$repeatTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).Date.AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($startupTrigger, $repeatTrigger) -Principal $principal -Settings $settings -Description 'Rebuild Chat Web WireGuard portproxy listeners after Docker/WG flaps. Do not change firewall RemoteAddress.' -Force | Out-Null

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $repairInstalled
if ($LASTEXITCODE -ne 0) {
    throw "portproxy 修复失败，exit=$LASTEXITCODE"
}

Write-Host '已安装开机/每5分钟自动修复任务 ChatWeb-WireGuard-PortProxy（只修监听，不改防火墙）'
