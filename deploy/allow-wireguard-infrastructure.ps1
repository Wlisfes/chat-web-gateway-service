#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'
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
