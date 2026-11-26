<#
.SYNOPSIS
    The scheduled task "Flotte <name>" at logon for a driver start script: runs it without a window via hintergrund.ps1.
.DESCRIPTION
    Used by `flotte projekt hinzufuegen --autostart` and flottenbruecke/einrichten.ps1 -Autostart. Prints one word:
    - angelegt:   the task was missing and is registered for the signed-in user (no admin rights needed).
    - vorhanden:  the task exists with this very action; nothing changed.
    - umgestellt: the task exists with another action (an older one with a visible window): action and settings are
                  replaced in place, trigger and enabled state stay (a disabled task stays disabled).
    The action is `conhost.exe --headless pwsh -NoProfile -File <skills>\flotte\hintergrund.ps1 -Skript <start script>`.
    The settings lift the limits Windows puts on a task by default: no stop after 72 hours, none on battery.
.PARAMETER Skript
    The start script, ~/.claude/flotte/start/<name>.ps1.
.PARAMETER Heim
    The home folder; hintergrund.ps1 is the installed one under <Heim>\.claude\skills\flotte.
#>
param(
    [Parameter(Mandatory = $true)][string]$Skript,
    [string]$Heim = $HOME
)

$ErrorActionPreference = 'Stop'
$name = "Flotte $([IO.Path]::GetFileNameWithoutExtension($Skript))"
$huelle = Join-Path $Heim '.claude\skills\flotte\hintergrund.ps1'
$argumente = "--headless pwsh -NoProfile -File `"$huelle`" -Skript `"$Skript`""
$aktion = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $argumente -WorkingDirectory (Split-Path $Skript)
$einstellungen = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

$da = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($da) {
    $alt = @($da.Actions)
    if ($alt.Count -eq 1 -and $alt[0].Execute -eq 'conhost.exe' -and $alt[0].Arguments -eq $argumente) { 'vorhanden'; return }
    # the settings carry the enabled state: without this a disabled task would come back
    $einstellungen.Enabled = $da.Settings.Enabled
    Set-ScheduledTask -TaskName $name -Action $aktion -Settings $einstellungen | Out-Null
    'umgestellt'
    return
}
Register-ScheduledTask -TaskName $name -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) -Action $aktion -Settings $einstellungen -User $env:USERNAME | Out-Null
'angelegt'
