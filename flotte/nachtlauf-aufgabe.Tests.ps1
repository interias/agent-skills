# Pester 3.4 (Windows PowerShell 5.1) and pwsh 7: Invoke-Pester .\flotte\nachtlauf-aufgabe.Tests.ps1
# The scheduled task of the night run (step 8 of the gate rework). The cmdlets of the task scheduler are global
# stand-in functions: a script run with & does not see Pester's mocks, but a function wins over a cmdlet of the
# same name. Before each run the test checks that every stand-in is in place, so no real task is ever touched.

$skript = Join-Path $PSScriptRoot 'nachtlauf-aufgabe.ps1'
$attrappen = 'Get-ScheduledTask', 'Register-ScheduledTask', 'Set-ScheduledTask', 'Unregister-ScheduledTask', 'New-ScheduledTaskAction', 'New-ScheduledTaskTrigger', 'New-ScheduledTaskSettingsSet', 'New-ScheduledTaskPrincipal'

# vorhanden: the tasks that exist
function Set-Attrappen([string[]]$vorhanden = @()) {
    $global:nVorhanden = $vorhanden
    $global:nProtokoll = New-Object Collections.ArrayList
    function global:Get-ScheduledTask { param($TaskName, $ErrorAction) if ($global:nVorhanden -contains $TaskName) { $TaskName } }
    function global:Register-ScheduledTask { param($TaskName, $Action, $Trigger, $Settings, $Principal, $Description) [void]$global:nProtokoll.Add(@{ was = 'anlegen'; name = $TaskName; aktion = $Action; ausloeser = $Trigger; einstellungen = $Settings; prinzipal = $Principal }) }
    function global:Set-ScheduledTask { param($TaskName, $Action, $Trigger, $Settings, $Principal) [void]$global:nProtokoll.Add(@{ was = 'aendern'; name = $TaskName; aktion = $Action; ausloeser = $Trigger; einstellungen = $Settings; prinzipal = $Principal }) }
    function global:Unregister-ScheduledTask { param($TaskName, $Confirm) [void]$global:nProtokoll.Add(@{ was = 'entfernen'; name = $TaskName; confirm = $Confirm }) }
    function global:New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) @{ Execute = $Execute; Argument = $Argument; WorkingDirectory = $WorkingDirectory } }
    function global:New-ScheduledTaskTrigger { param([switch]$Daily, $At) @{ Daily = [bool]$Daily; At = $At } }
    function global:New-ScheduledTaskSettingsSet { param($MultipleInstances, $ExecutionTimeLimit, [switch]$StartWhenAvailable, [switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries) @{ MultipleInstances = $MultipleInstances; ExecutionTimeLimit = $ExecutionTimeLimit; StartWhenAvailable = [bool]$StartWhenAvailable; AllowStartIfOnBatteries = [bool]$AllowStartIfOnBatteries } }
    function global:New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) @{ UserId = $UserId; LogonType = $LogonType; RunLevel = $RunLevel } }
    foreach ($n in $attrappen) { if ((Get-Command $n).CommandType -ne 'Function') { throw "Attrappe $n fehlt" } }
}

function Remove-Attrappen {
    foreach ($n in $attrappen) { Remove-Item "Function:\$n" -ErrorAction SilentlyContinue }
}

function New-Projekt([string]$name = 'mein projekt') {
    $ordner = Join-Path $TestDrive $name
    New-Item -ItemType Directory -Path (Join-Path $ordner '.git') -Force | Out-Null
    $ordner
}

Describe 'nachtlauf-aufgabe.ps1: create' {
    $ordner = New-Projekt
    $heim = Join-Path $TestDrive 'heim'
    Set-Attrappen
    try { $aus = & $skript -Projekt $ordner -Heim $heim -Bun 'C:\werkzeug\bun.exe' } finally { Remove-Attrappen }
    $a = $global:nProtokoll[0]

    It 'registers one task, named after the project folder' {
        $global:nProtokoll.Count | Should Be 1
        $a.was | Should Be 'anlegen'
        $a.name | Should Be 'Flotte Nachtlauf mein-projekt'
        "$aus" | Should Match 'angelegt: Flotte Nachtlauf mein-projekt, taeglich 02:30'
    }

    It 'calls the installed flotte CLI with nachtlauf in the project folder' {
        $a.aktion.Execute | Should Be 'C:\werkzeug\bun.exe'
        $a.aktion.Argument | Should Be ('"' + (Join-Path $heim '.claude\skills\flotte\src\cli.ts') + '" nachtlauf')
        $a.aktion.WorkingDirectory | Should Be $ordner
    }

    It 'runs daily at night by default' {
        $a.ausloeser.Daily | Should Be $true
        $a.ausloeser.At | Should Be '02:30'
    }

    It 'never starts twice, does not catch up a missed run in the day, and has a time limit' {
        $a.einstellungen.MultipleInstances | Should Be 'IgnoreNew'
        $a.einstellungen.StartWhenAvailable | Should Be $false
        $a.einstellungen.ExecutionTimeLimit.TotalHours | Should Be 8
    }

    It 'runs as the signed-in user, only while signed in, without a stored password' {
        $a.prinzipal.UserId | Should Be $env:USERNAME
        $a.prinzipal.LogonType | Should Be 'Interactive'
        $a.prinzipal.RunLevel | Should Be 'Limited'
    }
}

Describe 'nachtlauf-aufgabe.ps1: update, time, remove, refuse' {
    It 'updates an existing task in place with the time given' {
        $ordner = New-Projekt 'alpha'
        Set-Attrappen -vorhanden 'Flotte Nachtlauf alpha'
        try { $aus = & $skript -Projekt $ordner -Uhrzeit '03:15' -Bun 'bun.exe' } finally { Remove-Attrappen }
        $global:nProtokoll.Count | Should Be 1
        $global:nProtokoll[0].was | Should Be 'aendern'
        $global:nProtokoll[0].ausloeser.At | Should Be '03:15'
        "$aus" | Should Match 'aktualisiert: Flotte Nachtlauf alpha, taeglich 03:15'
    }

    It 'removes the task with -Entfernen, without asking, and says when there is none' {
        $ordner = New-Projekt 'beta'
        Set-Attrappen -vorhanden 'Flotte Nachtlauf beta'
        try { $aus = & $skript -Projekt $ordner -Entfernen } finally { Remove-Attrappen }
        $global:nProtokoll[0].was | Should Be 'entfernen'
        $global:nProtokoll[0].name | Should Be 'Flotte Nachtlauf beta'
        $global:nProtokoll[0].confirm | Should Be $false
        "$aus" | Should Match 'entfernt: Flotte Nachtlauf beta'
        Set-Attrappen
        try { $aus = & $skript -Projekt $ordner -Entfernen } finally { Remove-Attrappen }
        $global:nProtokoll.Count | Should Be 0
        "$aus" | Should Match 'keine Aufgabe Flotte Nachtlauf beta'
    }

    It 'refuses a folder that is no repository and a time that is none, and registers nothing' {
        $leer = Join-Path $TestDrive 'leer'
        New-Item -ItemType Directory -Path $leer | Out-Null
        Set-Attrappen
        try {
            { & $skript -Projekt $leer -Bun 'bun.exe' } | Should Throw 'kein Git-Repository'
            { & $skript -Projekt (New-Projekt 'gamma') -Uhrzeit '25:00' -Bun 'bun.exe' } | Should Throw 'Uhrzeit'
        } finally { Remove-Attrappen }
        $global:nProtokoll.Count | Should Be 0
    }
}
