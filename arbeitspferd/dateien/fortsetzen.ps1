# Closes one waiting Arbeitspferd window and continues its session in a new one.
# Usage: fortsetzen.ps1 -Repo tippel -SessionId <id> -AuftragDatei <file> [-AltePid <claude pid>]
# Only touches a claude process whose parent pwsh runs start-arbeitspferd.ps1, so it can never stop
# Claude Desktop or a session of the main account.
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][string]$SessionId,
    [Parameter(Mandatory)][string]$AuftragDatei,
    [int]$AltePid,
    [string[]]$AddDir
)

$cfg = "$HOME\.claude-arbeitspferd"
# Fleets read the shared skills and work in sibling worktrees; without these the window stops at a permission prompt
$AddDir = @($AddDir -split ',' | Where-Object { $_ }) + @($cfg, "$HOME\.claude", "$HOME\git\$Repo-worktrees") | Select-Object -Unique
if ($AltePid) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$AltePid"
    $parent = if ($proc) { Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" }
    if (-not $proc -or $proc.Name -ne 'claude.exe' -or $parent.CommandLine -notmatch 'start-arbeitspferd\.ps1') {
        throw "PID $AltePid ist kein Arbeitspferd-Fenster - nichts beendet."
    }
    Stop-Process -Id $proc.ProcessId, $parent.ProcessId -Force
    Start-Sleep 2
    Write-Host "Altes Fenster beendet (claude $($proc.ProcessId), pwsh $($parent.ProcessId))"
}

& "$cfg\auftrag.ps1" -Repo $Repo -Auftrag (Get-Content -Raw $AuftragDatei) -Resume $SessionId -AddDir ($AddDir -join ',')
