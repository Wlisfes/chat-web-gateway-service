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
$ports = [string[]]@('3306', '6379', '5672', '9092', '15672', '80', '443', '8848', '9848')

Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue |
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

Write-Host "已允许 WireGuard 接口 chat-web-home 访问端口: $($ports -join ', ')"
