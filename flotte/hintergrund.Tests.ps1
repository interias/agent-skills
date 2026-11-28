# Pester 3.4 (Windows PowerShell 5.1) and pwsh 7: Invoke-Pester .\flotte\hintergrund.Tests.ps1
# hintergrund.ps1 runs in a child process of the same PowerShell (it ends with exit) against a stand-in start
# script in $TestDrive that exits with the codes of a list, one per run, like bun would.
# autostart.ps1 runs with global stand-in functions for the task scheduler, as in einrichten.Tests.ps1: a function
# wins over a cmdlet of the same name, and each run checks they are in place, so nothing real is ever registered.

$wurzel = $PSScriptRoot
$shell = (Get-Process -Id $PID).Path

# codes: the exit code of each run in turn; every run writes one line to stdout and one to native stderr
function New-Start([int[]]$codes) {
    $dir = Join-Path $TestDrive "h-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    New-Item -ItemType Directory -Path "$dir\start" | Out-Null
    Set-Content -LiteralPath "$dir\codes.txt" -Value ($codes -join ',')
    $skript = "$dir\start\probe.ps1"
    Set-Content -LiteralPath $skript -Value @'
$liste = (Get-Content -LiteralPath "$PSScriptRoot\..\codes.txt") -split ','
$n = @(Get-ChildItem -LiteralPath "$PSScriptRoot\.." -Filter 'lauf-*').Count
New-Item -ItemType File -Path "$PSScriptRoot\..\lauf-$n" | Out-Null
"ausgabe lauf $n"
cmd /c "echo fehler lauf $n 1>&2"
exit [int]$liste[[Math]::Min($n, $liste.Count - 1)]
'@
    @{ Dir = $dir; Skript = $skript; Log = "$dir\log\probe.log" }
}

function Invoke-Hintergrund($s, [string[]]$mehr = @()) {
    & $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $wurzel 'hintergrund.ps1') -Skript $s.Skript -PauseS 0 @mehr | Out-Null
    $LASTEXITCODE
}

function Get-Laeufe($s) { @(Get-ChildItem -LiteralPath $s.Dir -Filter 'lauf-*').Count }

Describe 'hintergrund.ps1: a wanted end' {
    $s = New-Start 0
    $code = Invoke-Hintergrund $s

    It 'runs the start script once and ends with 0' {
        $code | Should Be 0
        Get-Laeufe $s | Should Be 1
    }

    It 'writes stdout and stderr into ~/.claude/flotte/log/<name>.log next to the start folder' {
        $log = Get-Content -LiteralPath $s.Log
        $log -contains 'ausgabe lauf 0' | Should Be $true
        @($log | Where-Object { $_ -like '*fehler lauf 0*' }).Count | Should Be 1
        @($log | Where-Object { $_ -like '*Ende mit Code 0: gewollt, kein Neustart*' }).Count | Should Be 1
    }
}

Describe 'hintergrund.ps1: a crash' {
    It 'starts again after a crash and ends with the first wanted end' {
        $s = New-Start 1, 3, 0
        Invoke-Hintergrund $s | Should Be 0
        Get-Laeufe $s | Should Be 3
        @(Get-Content -LiteralPath $s.Log | Where-Object { $_ -like '*Ende mit Code 3: abgestuerzt, Neustart 2 von 3*' }).Count | Should Be 1
    }

    It 'gives up after -Neustarts crashes in a row and passes the code on' {
        $s = New-Start 5
        Invoke-Hintergrund $s '-Neustarts', '2' | Should Be 5
        Get-Laeufe $s | Should Be 3
        @(Get-Content -LiteralPath $s.Log | Where-Object { $_ -like '*2 Neustarts in Folge verbraucht, keiner mehr*' }).Count | Should Be 1
    }

    It 'a run longer than -LaufS resets the count' {
        $s = New-Start 1, 1, 1, 0
        Invoke-Hintergrund $s '-Neustarts', '1', '-LaufS', '0' | Should Be 0
        Get-Laeufe $s | Should Be 4
    }
}

Describe 'hintergrund.ps1: the log file' {
    It 'past -MaxMB moves it to <name>.1.log and starts a new one' {
        $s = New-Start 0
        New-Item -ItemType Directory -Path (Split-Path $s.Log) | Out-Null
        [IO.File]::WriteAllText($s.Log, ('x' * 1MB))
        Invoke-Hintergrund $s '-MaxMB', '1' | Should Be 0
        (Get-Item -LiteralPath "$($s.Dir)\log\probe.1.log").Length | Should Be 1MB
        (Get-Item -LiteralPath $s.Log).Length -lt 1KB | Should Be $true
    }
}

Describe 'hintergrund.ps1: the root certificate of mkcert (#244)' {
    # the task runs pwsh -NoProfile: a NODE_EXTRA_CA_CERTS set in the profile is missing, bun refuses the bridge's certificate
    function Invoke-MitUmgebung($s, $werte) {
        $vorher = @{}
        foreach ($n in $werte.Keys) { $vorher[$n] = [Environment]::GetEnvironmentVariable($n); [Environment]::SetEnvironmentVariable($n, $werte[$n]) }
        try { Invoke-Hintergrund $s } finally { foreach ($n in $vorher.Keys) { [Environment]::SetEnvironmentVariable($n, $vorher[$n]) } }
    }
    function New-CaStart {
        $s = New-Start 0
        Set-Content -LiteralPath $s.Skript -Value '"ca=$env:NODE_EXTRA_CA_CERTS"'
        $s
    }

    It 'points NODE_EXTRA_CA_CERTS at rootCA.pem of mkcert when it is unset' {
        $s = New-CaStart
        $ca = Join-Path $s.Dir 'lokal\mkcert\rootCA.pem'
        New-Item -ItemType File -Force -Path $ca | Out-Null
        Invoke-MitUmgebung $s @{ NODE_EXTRA_CA_CERTS = $null; CAROOT = $null; LOCALAPPDATA = (Join-Path $s.Dir 'lokal') } | Should Be 0
        (Get-Content -LiteralPath $s.Log) -contains "ca=$ca" | Should Be $true
    }

    It 'takes the folder of CAROOT when it is set' {
        $s = New-CaStart
        $ca = Join-Path $s.Dir 'wurzel\rootCA.pem'
        New-Item -ItemType File -Force -Path $ca | Out-Null
        Invoke-MitUmgebung $s @{ NODE_EXTRA_CA_CERTS = $null; CAROOT = (Join-Path $s.Dir 'wurzel'); LOCALAPPDATA = (Join-Path $s.Dir 'lokal') } | Should Be 0
        (Get-Content -LiteralPath $s.Log) -contains "ca=$ca" | Should Be $true
    }

    It 'keeps a value set already, and sets none without mkcert' {
        $s = New-CaStart
        New-Item -ItemType File -Force -Path (Join-Path $s.Dir 'lokal\mkcert\rootCA.pem') | Out-Null
        Invoke-MitUmgebung $s @{ NODE_EXTRA_CA_CERTS = 'C:\eigen\ca.pem'; CAROOT = $null; LOCALAPPDATA = (Join-Path $s.Dir 'lokal') } | Should Be 0
        (Get-Content -LiteralPath $s.Log) -contains 'ca=C:\eigen\ca.pem' | Should Be $true
        $ohne = New-CaStart
        Invoke-MitUmgebung $ohne @{ NODE_EXTRA_CA_CERTS = $null; CAROOT = $null; LOCALAPPDATA = (Join-Path $ohne.Dir 'leer') } | Should Be 0
        (Get-Content -LiteralPath $ohne.Log) -contains 'ca=' | Should Be $true
    }
}

Describe 'hintergrund.ps1: the output of bun in the log (#244)' {
    It 'keeps umlauts: bun writes UTF-8, the log is UTF-8' {
        $s = New-Start 0
        $bun = (Get-Command bun -CommandType Application | Select-Object -First 1).Source
        # the umlaut as an escape of JavaScript: this file stays ASCII for 5.1
        Set-Content -LiteralPath $s.Skript -Value "& '$bun' -e `"console.log('Flottenbr\u00fccke erreichbar')`""
        # the code page of the task's console: OEM (850), not UTF-8
        $cp = [Console]::OutputEncoding.CodePage
        $befehl = "chcp 850 >nul & `"$shell`" -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $wurzel 'hintergrund.ps1')`" -Skript `"$($s.Skript)`" -PauseS 0 & chcp $cp >nul"
        cmd /c $befehl | Out-Null
        $text = [IO.File]::ReadAllText($s.Log, [Text.Encoding]::UTF8)
        $text.Contains("Flottenbr$([char]0x00FC)cke erreichbar") | Should Be $true
    }
}

Describe 'hintergrund.ps1: the task is stopped' {
    # the parent stands in for conhost: it starts hintergrund.ps1 and is killed like Stop-ScheduledTask does it.
    # The start script runs a long child (the driver), which itself starts a grandchild (a run of the driver).
    $s = New-Start 0
    Set-Content -LiteralPath $s.Skript -Value @'
& (Get-Process -Id $PID).Path -NoProfile -Command "`$e = Start-Process (Get-Process -Id `$PID).Path -ArgumentList '-NoProfile', '-Command', 'Start-Sleep 120' -WindowStyle Hidden -PassThru; Set-Content -LiteralPath '$PSScriptRoot\..\enkel.pid' -Value `$e.Id; Set-Content -LiteralPath '$PSScriptRoot\..\kind.pid' -Value `$PID; Start-Sleep 120"
'@
    $befehl = "& '$($shell -replace "'", "''")' -NoProfile -ExecutionPolicy Bypass -File '$((Join-Path $wurzel 'hintergrund.ps1') -replace "'", "''")' -Skript '$($s.Skript -replace "'", "''")' -PauseS 0"
    $eltern = Start-Process $shell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $befehl -WindowStyle Hidden -PassThru
    for ($i = 0; $i -lt 60 -and -not (Test-Path "$($s.Dir)\kind.pid"); $i++) { Start-Sleep -Milliseconds 500 }
    $huelle = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($eltern.Id)" | Where-Object { $_.CommandLine -like '*hintergrund.ps1*' }) | Select-Object -First 1
    $kind = [int](Get-Content "$($s.Dir)\kind.pid")
    $enkel = [int](Get-Content "$($s.Dir)\enkel.pid")
    Stop-Process -Id $eltern.Id -Force
    for ($i = 0; $i -lt 30 -and (Get-Process -Id $huelle.ProcessId, $kind -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
    $lebt = @(Get-Process -Id $huelle.ProcessId, $kind, $enkel -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    Stop-Process -Id $huelle.ProcessId, $kind, $enkel -Force -ErrorAction SilentlyContinue

    It 'ends this script and the driver, the run of the driver lives on' {
        $lebt -contains $huelle.ProcessId | Should Be $false
        $lebt -contains $kind | Should Be $false
        $lebt -contains $enkel | Should Be $true
    }

    It 'says so in the log' {
        @(Get-Content -LiteralPath $s.Log | Where-Object { $_ -like '*Aufgabe beendet: Treiber beendet, kein Neustart*' }).Count | Should Be 1
    }
}

$attrappen = 'Get-ScheduledTask', 'Register-ScheduledTask', 'Set-ScheduledTask', 'New-ScheduledTaskAction', 'New-ScheduledTaskTrigger', 'New-ScheduledTaskSettingsSet'

# da: the existing task (or $null)
function Set-Aufgaben($da) {
    $global:aDa = $da
    $global:aProtokoll = New-Object Collections.ArrayList
    function global:Get-ScheduledTask { param($TaskName, $ErrorAction) $global:aDa }
    function global:Register-ScheduledTask { param($TaskName, $Trigger, $Action, $Settings, $User) [void]$global:aProtokoll.Add(@{ Was = 'register'; Name = $TaskName; Action = $Action; Settings = $Settings }) }
    function global:Set-ScheduledTask { param($TaskName, $Action, $Settings) [void]$global:aProtokoll.Add(@{ Was = 'set'; Name = $TaskName; Action = $Action; Settings = $Settings }) }
    function global:New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) [pscustomobject]@{ Execute = $Execute; Arguments = $Argument; WorkingDirectory = $WorkingDirectory } }
    function global:New-ScheduledTaskTrigger { param([switch]$AtLogOn, $User) 'ausloeser' }
    function global:New-ScheduledTaskSettingsSet { param($ExecutionTimeLimit, [switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries, $MultipleInstances) [pscustomobject]@{ ExecutionTimeLimit = $ExecutionTimeLimit; Batterie = $AllowStartIfOnBatteries -and $DontStopIfGoingOnBatteries; MultipleInstances = $MultipleInstances; Enabled = $true } }
    foreach ($n in $attrappen) { if ((Get-Command $n).CommandType -ne 'Function') { throw "Attrappe $n fehlt" } }
}

function Remove-Aufgaben { foreach ($n in $attrappen) { Remove-Item "Function:\$n" -ErrorAction SilentlyContinue } }

$skript = 'C:\heim\.claude\flotte\start\mein projekt.ps1'
$erwartet = '--headless pwsh -NoProfile -File "C:\heim\.claude\skills\flotte\hintergrund.ps1" -Skript "C:\heim\.claude\flotte\start\mein projekt.ps1"'

Describe 'autostart.ps1: a missing task' {
    Set-Aufgaben $null
    try { $out = & (Join-Path $wurzel 'autostart.ps1') -Skript $skript -Heim 'C:\heim' } finally { Remove-Aufgaben }
    $r = $global:aProtokoll[0]

    It 'registers "Flotte <name>" running hintergrund.ps1 through conhost --headless' {
        $out | Should Be 'angelegt'
        $global:aProtokoll.Count | Should Be 1
        $r.Was | Should Be 'register'
        $r.Name | Should Be 'Flotte mein projekt'
        $r.Action.Execute | Should Be 'conhost.exe'
        $r.Action.Arguments | Should Be $erwartet
    }

    It 'lifts the 72-hour limit and the battery stop' {
        $r.Settings.ExecutionTimeLimit | Should Be ([TimeSpan]::Zero)
        $r.Settings.Batterie | Should Be $true
    }
}

Describe 'autostart.ps1: an existing task' {
    It 'with an older action: switched over in place, a disabled one stays disabled' {
        Set-Aufgaben ([pscustomobject]@{ Actions = @([pscustomobject]@{ Execute = 'pwsh'; Arguments = "-NoProfile -File `"$skript`"" }); Settings = [pscustomobject]@{ Enabled = $false } })
        try { $out = & (Join-Path $wurzel 'autostart.ps1') -Skript $skript -Heim 'C:\heim' } finally { Remove-Aufgaben }
        $out | Should Be 'umgestellt'
        $global:aProtokoll.Count | Should Be 1
        $global:aProtokoll[0].Was | Should Be 'set'
        $global:aProtokoll[0].Action.Arguments | Should Be $erwartet
        $global:aProtokoll[0].Settings.Enabled | Should Be $false
    }

    It 'with this very action: vorhanden, nothing changed' {
        Set-Aufgaben ([pscustomobject]@{ Actions = @([pscustomobject]@{ Execute = 'conhost.exe'; Arguments = $erwartet }); Settings = [pscustomobject]@{ Enabled = $true } })
        try { $out = & (Join-Path $wurzel 'autostart.ps1') -Skript $skript -Heim 'C:\heim' } finally { Remove-Aufgaben }
        $out | Should Be 'vorhanden'
        $global:aProtokoll.Count | Should Be 0
    }
}
