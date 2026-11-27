# Pester 3.4 (Windows PowerShell 5.1) and pwsh 7: Invoke-Pester .\flottenbruecke\einrichten.Tests.ps1
# einrichten.ps1 and .env.example are copied into $TestDrive, so the real .env is never touched (#97).
# docker, the PIN prompt, the browser and the task scheduler are global stand-in functions: a script run
# with & does not see Pester's mocks, but a function wins over a program or cmdlet of the same name.
# Before each run the test checks that every stand-in is in place, so nothing real is ever called.

$quelle = $PSScriptRoot
$attrappen = 'docker', 'wsl', 'Read-Host', 'Start-Process', 'Get-ScheduledTask', 'Register-ScheduledTask', 'New-ScheduledTaskAction', 'New-ScheduledTaskTrigger', 'New-ScheduledTaskSettingsSet'

function New-Bruecke {
    $dir = Join-Path $TestDrive "bruecke-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    New-Item -ItemType Directory -Path $dir, "$dir\heim" | Out-Null
    Copy-Item (Join-Path $quelle 'einrichten.ps1'), (Join-Path $quelle '.env.example') $dir
    $dir
}

# pin: what the prompt returns; dockerCode / wslCode: the exit code of docker / wsl; vorhanden: the tasks that exist
function Set-Attrappen([string]$pin = '', [int]$dockerCode = 0, [string[]]$vorhanden = @(), [int]$wslCode = 0) {
    $global:ePin = $pin; $global:eDockerCode = $dockerCode; $global:eVorhanden = $vorhanden; $global:eWslCode = $wslCode
    $global:eProtokoll = New-Object Collections.ArrayList
    function global:docker { [void]$global:eProtokoll.Add("docker $args"); $global:LASTEXITCODE = $global:eDockerCode }
    function global:wsl { [void]$global:eProtokoll.Add("wsl $args"); $global:LASTEXITCODE = $global:eWslCode }
    function global:Read-Host { [void]$global:eProtokoll.Add('pin'); $s = New-Object Security.SecureString; foreach ($c in $global:ePin.ToCharArray()) { $s.AppendChar($c) }; $s }
    function global:Start-Process { param($FilePath) [void]$global:eProtokoll.Add("browser $FilePath") }
    function global:Get-ScheduledTask { param($TaskName, $ErrorAction) if ($global:eVorhanden -contains $TaskName) { $TaskName } }
    function global:Register-ScheduledTask { param($TaskName, $Trigger, $Action, $User, $Settings) [void]$global:eProtokoll.Add("aufgabe $TaskName$(if ($Settings) { " $Settings" })") }
    function global:New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) [void]$global:eProtokoll.Add("aktion $Execute $Argument"); 'aktion' }
    function global:New-ScheduledTaskTrigger { param([switch]$AtLogOn, $User) 'ausloeser' }
    function global:New-ScheduledTaskSettingsSet { param($ExecutionTimeLimit) "ohne-zeitlimit-$($ExecutionTimeLimit.Ticks)" }
    foreach ($n in $attrappen) { if ((Get-Command $n).CommandType -ne 'Function') { throw "Attrappe $n fehlt" } }
}

function Remove-Attrappen {
    foreach ($n in $attrappen) { Remove-Item "Function:\$n" -ErrorAction SilentlyContinue }
}

Describe 'einrichten.ps1: a fresh run, then a second one' {
    $dir = New-Bruecke
    $konten = "$dir\heim\.claude\flotte\konten.json"
    Set-Attrappen -pin '4711'
    try {
        $out1 = & "$dir\einrichten.ps1" -Heim "$dir\heim"
        $env1 = [IO.File]::ReadAllBytes("$dir\.env")
        $konten1 = [IO.File]::ReadAllBytes($konten)
        $out2 = & "$dir\einrichten.ps1" -Heim "$dir\heim"
    } finally { Remove-Attrappen }
    $protokoll = @($global:eProtokoll)

    It 'creates .env with the PIN, without a BOM, and never prints the PIN' {
        (Get-Content "$dir\.env") -contains 'BRUECKE_PIN=4711' | Should Be $true
        (Get-Content "$dir\.env") -contains 'BRUECKE_PORT=4747' | Should Be $true
        $env1[0] | Should Not Be 0xEF
        (@($out1) + @($out2) | Where-Object { "$_" -match '4711' }) | Should BeNullOrEmpty
    }

    It 'without -Variante sets up the work machine: only this machine, no remote entry' {
        (Get-Content "$dir\.env") -contains 'BRUECKE_BIND=127.0.0.1' | Should Be $true
        (Get-Content "$dir\.env") -contains 'BRUECKE_FERNZUGRIFF=aus' | Should Be $true
        $out1 -contains 'angelegt: .env (arbeitsrechner) mit PIN' | Should Be $true
    }

    It 'creates konten.json with the accounts 1-3 as flotte reads them' {
        $k = @((Get-Content -Raw $konten | ConvertFrom-Json) | ForEach-Object { $_ })
        $k.Count | Should Be 3
        $k[1].ordner | Should Be '~/.claude-arbeitspferd'
        $k[2].aktiv | Should Be $true
        $konten1[0] | Should Not Be 0xEF
    }

    It 'leaves .env and konten.json unchanged on the second run and asks no PIN again' {
        [Convert]::ToBase64String([IO.File]::ReadAllBytes("$dir\.env")) | Should Be ([Convert]::ToBase64String($env1))
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($konten)) | Should Be ([Convert]::ToBase64String($konten1))
        @($protokoll | Where-Object { $_ -eq 'pin' }).Count | Should Be 1
        $out2 -contains 'behalten: .env (PIN und Variante unveraendert)' | Should Be $true
    }

    It 'starts the container each run and opens the bridge' {
        @($protokoll | Where-Object { $_ -eq 'docker compose up -d --build --wait' }).Count | Should Be 2
        @($protokoll | Where-Object { $_ -eq 'browser http://localhost:4747/' }).Count | Should Be 2
    }

    It 'without -Autostart does not touch the task scheduler' {
        @($protokoll | Where-Object { $_ -like 'aufgabe *' }).Count | Should Be 0
    }
}

Describe 'einrichten.ps1 -Autostart' {
    $dir = New-Bruecke
    New-Item -ItemType Directory -Path "$dir\heim\.claude\flotte\start" | Out-Null
    Set-Content -Path "$dir\heim\.claude\flotte\start\flotte-probe.ps1" -Value '# start'
    # the installed autostart.ps1 of the driver, as a stand-in that only records its call
    New-Item -ItemType Directory -Path "$dir\heim\.claude\skills\flotte" | Out-Null
    Set-Content -Path "$dir\heim\.claude\skills\flotte\autostart.ps1" -Value 'param($Skript, $Heim) [void]$global:eProtokoll.Add("autostart $([IO.Path]::GetFileName($Skript)) $Heim"); ''angelegt'''
    Set-Attrappen -vorhanden 'Flottenbruecke'
    try { $out = & "$dir\einrichten.ps1" -Heim "$dir\heim" -Autostart -OhneBrowser }
    finally { Remove-Attrappen }
    $protokoll = @($global:eProtokoll)

    It 'registers only the missing bridge task, the existing one stays' {
        @($protokoll | Where-Object { $_ -like 'aufgabe *' }).Count | Should Be 0
        $out -contains 'Aufgabe vorhanden: Flottenbruecke' | Should Be $true
    }

    It 'hands each driver start script to the installed autostart.ps1 (without a window), never registers it with one' {
        @($protokoll | Where-Object { $_ -like 'autostart *' }) -join ',' | Should Be "autostart flotte-probe.ps1 $dir\heim"
        @($protokoll | Where-Object { $_ -like 'aktion pwsh*' }).Count | Should Be 0
        $out -contains 'Aufgabe Flotte flotte-probe: angelegt' | Should Be $true
    }
}

Describe 'einrichten.ps1 -Autostart without the installed driver' {
    $dir = New-Bruecke
    New-Item -ItemType Directory -Path "$dir\heim\.claude\flotte\start" | Out-Null
    Set-Content -Path "$dir\heim\.claude\flotte\start\flotte-probe.ps1" -Value '# start'
    Set-Attrappen -vorhanden 'Flottenbruecke'
    try { $out = & "$dir\einrichten.ps1" -Heim "$dir\heim" -Autostart -OhneBrowser }
    finally { Remove-Attrappen }

    It 'registers no driver task and says that install.ps1 comes first' {
        @($global:eProtokoll | Where-Object { $_ -like 'aufgabe *' -or $_ -like 'aktion pwsh*' }).Count | Should Be 0
        $out -contains 'Aufgabe Flotte flotte-probe: nicht angelegt, autostart.ps1 fehlt (erst install.ps1)' | Should Be $true
    }

    It 'an empty PIN leaves answering switched off; -OhneBrowser opens nothing' {
        (Get-Content "$dir\.env") -contains 'BRUECKE_PIN=' | Should Be $true
        @($protokoll | Where-Object { $_ -like 'browser *' }).Count | Should Be 0
    }
}

Describe 'einrichten.ps1 when docker fails' {
    $dir = New-Bruecke
    Set-Attrappen -dockerCode 1
    $fehler = $null
    try { & "$dir\einrichten.ps1" -Heim "$dir\heim" } catch { $fehler = $_.Exception.Message } finally { Remove-Attrappen }

    It 'stops with the exit code and opens nothing' {
        $fehler | Should Be 'docker compose up endete mit Code 1.'
        @($global:eProtokoll | Where-Object { $_ -like 'browser *' }).Count | Should Be 0
    }
}

Describe 'einrichten.ps1 -Variante privatrechner' {
    $dir = New-Bruecke
    Set-Attrappen
    try { $out = & "$dir\einrichten.ps1" -Heim "$dir\heim" -Variante privatrechner -OhneBrowser }
    finally { Remove-Attrappen }

    It 'reaches the LAN and keeps the remote entry for Tailscale' {
        (Get-Content "$dir\.env") -contains 'BRUECKE_BIND=0.0.0.0' | Should Be $true
        (Get-Content "$dir\.env") -contains 'BRUECKE_FERNZUGRIFF=an' | Should Be $true
        $out -contains 'angelegt: .env (privatrechner) ohne PIN (Antworten abgeschaltet)' | Should Be $true
    }
}

Describe 'einrichten.ps1 with docker in WSL' {
    $dir = New-Bruecke
    Set-Attrappen
    try { $out = & "$dir\einrichten.ps1" -Heim "$dir\heim" -Docker wsl -Autostart -OhneBrowser }
    finally { Remove-Attrappen }
    $protokoll = @($global:eProtokoll)

    It 'checks docker in WSL, then starts the container there and never docker from PATH' {
        @($protokoll | Where-Object { $_ -like 'wsl *' }) -join ',' | Should Be 'wsl -e docker version --format {{.Server.Version}},wsl -e docker compose up -d --build --wait'
        @($protokoll | Where-Object { $_ -like 'docker *' }).Count | Should Be 0
        $out -contains 'Bruecke laeuft (docker compose in WSL)' | Should Be $true
    }

    It 'the bridge task starts the container in WSL and holds WSL, without a time limit' {
        $protokoll -contains 'aktion wsl.exe -e sh -c "docker compose up -d; exec sleep infinity"' | Should Be $true
        $protokoll -contains 'aufgabe Flottenbruecke ohne-zeitlimit-0' | Should Be $true
    }
}

Describe 'einrichten.ps1 when docker in WSL is not reachable' {
    $dir = New-Bruecke
    Set-Attrappen -wslCode 1
    $fehler = $null
    try { & "$dir\einrichten.ps1" -Heim "$dir\heim" -Docker wsl } catch { $fehler = $_.Exception.Message } finally { Remove-Attrappen }

    It 'stops before compose and opens nothing' {
        $fehler | Should Be 'docker nicht erreichbar: weder im PATH noch in WSL (wsl -e docker version).'
        @($global:eProtokoll | Where-Object { $_ -like '*compose*' -or $_ -like 'browser *' }).Count | Should Be 0
    }
}
