<#
.SYNOPSIS
    Runs a driver start script in the background: no window, the output in a log file, a new start only after a crash.
.DESCRIPTION
    The scheduled task "Flotte <name>" (autostart.ps1) starts this script through `conhost.exe --headless`, so no
    window opens. Everything the start script and its driver write goes to ~/.claude/flotte/log/<name>.log; once
    the file passes -MaxMB it moves to <name>.1.log (the older one goes).
    Exit code 0 is a wanted end (flotte anhalten, "Entfernen" in the bridge, nothing left to do): the script ends
    with it, and nothing waits on. Any other code is a crash: after -PauseS seconds the start script runs again, at
    most -Neustarts times in a row; a run longer than -LaufS seconds counts as healthy and resets the count. A new
    start after `flotte anhalten` ends at once, since the driver reads the halt file left next to its state.
    When the task is stopped, a watch ends the driver and this script too (below), so no hidden shell stays behind.
    NODE_EXTRA_CA_CERTS, when unset, points at rootCA.pem of mkcert (#244), so the driver trusts a bridge on HTTPS.
.PARAMETER Skript
    The start script, ~/.claude/flotte/start/<name>.ps1.
.PARAMETER Protokoll
    The log file; default ~/.claude/flotte/log/<name>.log next to the start folder.
.EXAMPLE
    conhost.exe --headless pwsh -NoProfile -File hintergrund.ps1 -Skript C:\Users\me\.claude\flotte\start\projekt.ps1
#>
param(
    [Parameter(Mandatory = $true)][string]$Skript,
    [string]$Protokoll,
    [int]$MaxMB = 10,
    [int]$Neustarts = 3,
    [int]$PauseS = 60,
    [int]$LaufS = 3600
)

$name = [IO.Path]::GetFileNameWithoutExtension($Skript)
if (-not $Protokoll) { $Protokoll = Join-Path (Split-Path (Split-Path $Skript)) "log\$name.log" }
[void](New-Item -ItemType Directory -Force -Path (Split-Path $Protokoll))
$alt = [IO.Path]::ChangeExtension($Protokoll, '.1.log')
$utf8 = New-Object Text.UTF8Encoding $false
$max = [long]$MaxMB * 1MB

function Write-Protokoll([string]$zeile) {
    if ((Test-Path -LiteralPath $Protokoll) -and (Get-Item -LiteralPath $Protokoll).Length -ge $max) {
        Move-Item -LiteralPath $Protokoll -Destination $alt -Force
    }
    [IO.File]::AppendAllText($Protokoll, "$zeile`r`n", $utf8)
}

# The watch: Windows ends only conhost when the task is stopped (Stop-ScheduledTask, "Beenden" in the task scheduler),
# so this script and the driver would run on hidden. Once the parent is gone, the watch ends the driver (the direct
# children of this process) and this script, like closing a terminal does; the runs the driver started live on (D16).
$elternId = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$eltern = Get-Process -Id $elternId -ErrorAction SilentlyContinue
if ($eltern) {
    $wache = [PowerShell]::Create()
    [void]$wache.AddScript({
        param($eltern, $selbst, $protokoll)
        $eltern.WaitForExit()
        foreach ($k in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$selbst")) { Stop-Process -Id $k.ProcessId -Force -ErrorAction SilentlyContinue }
        try { [IO.File]::AppendAllText($protokoll, "=== $((Get-Date).ToString('s')) Aufgabe beendet: Treiber beendet, kein Neustart ===`r`n") } catch { }
        [Environment]::Exit(1)
    }).AddArgument($eltern).AddArgument($PID).AddArgument($Protokoll)
    [void]$wache.BeginInvoke()
}

# #244: the task runs pwsh -NoProfile, so a NODE_EXTRA_CA_CERTS set in the profile is missing and bun refuses the
# certificate of a bridge on HTTPS (mkcert). The root certificate of mkcert, where it exists, unless a value is set.
if (-not $env:NODE_EXTRA_CA_CERTS) {
    $caWurzel = if ($env:CAROOT) { $env:CAROOT } elseif ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'mkcert' }
    if ($caWurzel -and (Test-Path -LiteralPath (Join-Path $caWurzel 'rootCA.pem'))) { $env:NODE_EXTRA_CA_CERTS = Join-Path $caWurzel 'rootCA.pem' }
}

$fehlstarts = 0
for (;;) {
    $beginn = Get-Date
    Write-Protokoll "=== $($beginn.ToString('s')) Start $Skript ==="
    $global:LASTEXITCODE = 0
    $code = 0
    try {
        & $Skript *>&1 | ForEach-Object { Write-Protokoll "$_" }
        $code = $global:LASTEXITCODE
    } catch {
        Write-Protokoll "$_"
        $code = 1
    }
    if ($code -eq 0) {
        Write-Protokoll "=== $((Get-Date).ToString('s')) Ende mit Code 0: gewollt, kein Neustart ==="
        # not exit: the thread of the watch would keep the process alive
        [Environment]::Exit(0)
    }
    if (((Get-Date) - $beginn).TotalSeconds -ge $LaufS) { $fehlstarts = 0 }
    $fehlstarts++
    if ($fehlstarts -gt $Neustarts) {
        Write-Protokoll "=== $((Get-Date).ToString('s')) Ende mit Code ${code}: abgestuerzt, $Neustarts Neustarts in Folge verbraucht, keiner mehr ==="
        [Environment]::Exit($code)
    }
    Write-Protokoll "=== $((Get-Date).ToString('s')) Ende mit Code ${code}: abgestuerzt, Neustart $fehlstarts von $Neustarts in $PauseS s ==="
    Start-Sleep -Seconds $PauseS
}
