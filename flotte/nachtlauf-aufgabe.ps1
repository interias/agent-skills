<#
.SYNOPSIS
    Creates, updates or removes the scheduled task of the night run (`flotte nachtlauf`) for one project.

.DESCRIPTION
    The task "Flotte Nachtlauf <name>" (name from the project folder, as `flotte projekt hinzufuegen` names its start
    script) runs the installed flotte CLI with `nachtlauf` in the project folder every night at -Uhrzeit. It never
    starts a second instance while one runs (IgnoreNew), does not catch up a missed run in the day (no
    StartWhenAvailable) and ends after 8 hours. It runs as the signed-in user, only while that user is signed in (a
    locked screen counts): running without a session would need a stored password, and with "do not store password"
    (S4U) the run has no access to the Git and gh sign-in it needs for fetch and issues. Without -Entfernen an existing
    task is updated in place. Only the task scheduler is touched; no admin rights are needed.

.EXAMPLE
    pwsh -NoProfile -File $HOME\.claude\skills\flotte\nachtlauf-aufgabe.ps1 -Projekt C:\git\app
.EXAMPLE
    pwsh -NoProfile -File $HOME\.claude\skills\flotte\nachtlauf-aufgabe.ps1 -Projekt C:\git\app -Uhrzeit 03:15
.EXAMPLE
    pwsh -NoProfile -File $HOME\.claude\skills\flotte\nachtlauf-aufgabe.ps1 -Projekt C:\git\app -Entfernen
#>
param(
    [Parameter(Mandatory)][string]$Projekt,
    [string]$Uhrzeit = '02:30',
    [switch]$Entfernen,
    # the home folder whose .claude\skills\flotte holds the installed CLI
    [string]$Heim = [Environment]::GetFolderPath('UserProfile'),
    # bun.exe; default: the one on PATH
    [string]$Bun
)
$ErrorActionPreference = 'Stop'

$Projekt = $Projekt.Trim().Trim('"', "'")
$name = 'Flotte Nachtlauf ' + ((Split-Path -Leaf $Projekt) -replace '[^A-Za-z0-9_.-]', '-')

if ($Entfernen) {
    if (-not (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue)) { "keine Aufgabe $name"; return }
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    "entfernt: $name"
    return
}

if (-not (Test-Path -LiteralPath (Join-Path $Projekt '.git'))) { throw "$Projekt ist kein Git-Repository (Projektordner mit .git)." }
if ($Uhrzeit -notmatch '^([01]?\d|2[0-3]):[0-5]\d$') { throw "Uhrzeit ${Uhrzeit}: hh:mm, etwa 02:30." }
if (-not $Bun) { $Bun = (Get-Command bun -CommandType Application | Select-Object -First 1).Source }
$cli = Join-Path $Heim '.claude\skills\flotte\src\cli.ts'

$aktion = New-ScheduledTaskAction -Execute $Bun -Argument "`"$cli`" nachtlauf" -WorkingDirectory $Projekt
$ausloeser = New-ScheduledTaskTrigger -Daily -At $Uhrzeit
# IgnoreNew: never twice; without StartWhenAvailable a night missed (machine off) is not run in the day
$einstellungen = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 8) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$prinzipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Set-ScheduledTask -TaskName $name -Action $aktion -Trigger $ausloeser -Settings $einstellungen -Principal $prinzipal | Out-Null
    "aktualisiert: $name, taeglich $Uhrzeit"
} else {
    Register-ScheduledTask -TaskName $name -Action $aktion -Trigger $ausloeser -Settings $einstellungen -Principal $prinzipal | Out-Null
    "angelegt: $name, taeglich $Uhrzeit"
}
