$ErrorActionPreference = 'Stop'

# Silent repair for SYSTEM / admin. Do not prompt UAC.
# Recreates WireGuard portproxy listeners after Docker Desktop / WG flaps.
# netsh still shows rules after the listen sockets are gone; always verify LISTENING.
# Do not change Windows firewall here. RemoteAddress must stay 10.66.0.0/24
# so 10.66.0.1 (cloud Nginx) and 10.66.0.3 (peer client) are never swapped.

$wgIp = '10.66.0.2'
$logDir = 'C:\ProgramData\chat-web'
$logFile = Join-Path $logDir 'portproxy-repair.log'
$forwardMappings = [ordered]@{
    '18080' = 16379
    '18081' = 15674
    '18082' = 15673
    '18083' = 19092
}

function Write-RepairLog {
    param([string]$Message)
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
    Write-Host $line
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-PortProxyListening {
    param([string]$ListenAddress, [int]$ListenPort)
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -eq $ListenAddress -and $_.LocalPort -eq $ListenPort })
    if ($listeners.Count -gt 0) {
        return $true
    }
    $escapedIp = [regex]::Escape($ListenAddress)
    $needle = ('{0}:{1}' -f $ListenAddress, $ListenPort)
    $netstat = & netstat.exe -ano
    return [bool]($netstat | Select-String -SimpleMatch $needle | Where-Object { $_.Line -match 'LISTENING' })
}

function Wait-WireGuardAddress {
    param([int]$TimeoutSeconds = 60)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $found = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -eq $wgIp }
        if ($found) {
            return $true
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Invoke-PortProxyApply {
    foreach ($listenPort in $forwardMappings.Keys) {
        $connectPort = $forwardMappings[$listenPort]
        & netsh.exe interface portproxy delete v4tov4 listenaddress=$wgIp listenport=$listenPort protocol=tcp | Out-Null
        $output = & netsh.exe interface portproxy add v4tov4 listenaddress=$wgIp listenport=$listenPort connectaddress=127.0.0.1 connectport=$connectPort protocol=tcp
        if ($LASTEXITCODE -ne 0) {
            throw ('create portproxy failed {0}:{1} -> 127.0.0.1:{2} {3}' -f $wgIp, $listenPort, $connectPort, ($output -join ' '))
        }
    }
}

if (-not (Test-IsAdministrator)) {
    Write-RepairLog 'skip: not administrator'
    exit 0
}

$iphlpsvc = Get-Service -Name iphlpsvc -ErrorAction SilentlyContinue
if (-not $iphlpsvc) {
    Write-RepairLog 'skip: iphlpsvc missing'
    exit 1
}
if ($iphlpsvc.Status -ne 'Running') {
    Start-Service -Name iphlpsvc
    Write-RepairLog 'started iphlpsvc'
}

if (-not (Wait-WireGuardAddress)) {
    Write-RepairLog ('skip: {0} not present' -f $wgIp)
    exit 0
}

$missing = @($forwardMappings.Keys | Where-Object { -not (Test-PortProxyListening -ListenAddress $wgIp -ListenPort ([int]$_)) })
if ($missing.Count -eq 0) {
    Write-RepairLog 'ok: 18080-18083 already listening'
    exit 0
}

Write-RepairLog ('repair: missing listeners {0}' -f ($missing -join ','))
Invoke-PortProxyApply
Restart-Service -Name iphlpsvc -Force
Start-Sleep -Seconds 2
Invoke-PortProxyApply
Start-Sleep -Seconds 1

$stillMissing = @($forwardMappings.Keys | Where-Object { -not (Test-PortProxyListening -ListenAddress $wgIp -ListenPort ([int]$_)) })
if ($stillMissing.Count -gt 0) {
    Write-RepairLog ('fail: still missing {0}' -f ($stillMissing -join ','))
    exit 1
}

Write-RepairLog 'ok: repaired 18080-18083 listeners'
