# Pester 3.4 (Windows PowerShell 5.1) and pwsh 7: Invoke-Pester .\arbeitspferd\einrichten.Tests.ps1
# einrichten.ps1 and start-arbeitspferd.ps1 run as separate pwsh processes with USERPROFILE, HOME and
# LOCALAPPDATA pointing to a fresh folder in TEMP, so no test touches the real home folder or desktop.

$script = Join-Path $PSScriptRoot 'einrichten.ps1'
$start = Join-Path $PSScriptRoot 'dateien\start-arbeitspferd.ps1'
$vorlageGuid = '{c1a0de00-2a7b-4e1f-9d3c-a7b0e1d2c0de}'

function New-Heim {
    $heim = Join-Path ([IO.Path]::GetTempPath()) "einrichten-test-$([guid]::NewGuid().ToString('N'))"
    $wt = Join-Path $heim 'AppData\Local\Microsoft\Windows Terminal'
    New-Item -ItemType Directory -Force $wt | Out-Null
    Set-Content -LiteralPath (Join-Path $wt 'settings.json') -Encoding UTF8 -Value '{"profiles":{"list":[{"guid":"{11111111-0000-0000-0000-000000000000}","name":"PowerShell"}]}}'
    $heim
}

function Invoke-ImHeim([string]$heim, [string]$datei, [string[]]$argumente) {
    $alt = $env:USERPROFILE, $env:HOME, $env:LOCALAPPDATA
    $env:USERPROFILE = $heim; $env:HOME = $heim; $env:LOCALAPPDATA = Join-Path $heim 'AppData\Local'
    try { & pwsh -NoProfile -NonInteractive -File $datei @argumente 2>&1 | ForEach-Object { "$_" } }
    finally { $env:USERPROFILE, $env:HOME, $env:LOCALAPPDATA = $alt }
}

function Invoke-Einrichten([string]$heim, [string[]]$argumente) {
    Invoke-ImHeim $heim $script (@('-Desktop', (Join-Path $heim 'Desktop')) + $argumente)
}

function Get-Profile([string]$heim) {
    (Get-Content -Raw -LiteralPath (Join-Path $heim 'AppData\Local\Microsoft\Windows Terminal\settings.json') | ConvertFrom-Json)
}

# Everything in the test folder except what pwsh itself keeps under LOCALAPPDATA
function Get-Verzeichnis([string]$heim) {
    @(Get-ChildItem -LiteralPath $heim -Recurse -Force | ForEach-Object { $_.FullName } |
        Where-Object { $_ -notlike "$heim\AppData\Local\Microsoft\PowerShell*" }) -join "`n"
}

# Removes the junctions first, so deleting the test folder never follows them
function Remove-Heim([string]$heim) {
    Get-ChildItem -LiteralPath $heim -Directory -Force -Filter '.claude-arbeitspferd*' | ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -Force | Where-Object { $_.LinkType } | ForEach-Object { [IO.Directory]::Delete($_.FullName) }
    }
    Remove-Item -LiteralPath $heim -Recurse -Force
}

Describe 'einrichten.ps1 -DryRun' {
    $heim = New-Heim
    $vorher = Get-Verzeichnis $heim
    $out = Invoke-Einrichten $heim @('-Konfig', "$heim\.claude-arbeitspferd-3", '-DryRun')
    $cfg = Join-Path $heim '.claude-arbeitspferd-3'

    It 'changes nothing' {
        Get-Verzeichnis $heim | Should Be $vorher
    }

    It 'reports links, settings, profile and shortcut of the further account' {
        $out -contains "[DryRun] wuerde Link anlegen: $cfg\skills -> $heim\.claude\skills" | Should Be $true
        $out -contains "[DryRun] wuerde schreiben: $cfg\CLAUDE.md" | Should Be $true
        $out -contains "[DryRun] wuerde in $cfg\settings.json eintragen: $heim\.claude, $cfg" | Should Be $true
        ($out | Where-Object { $_ -like "*Profil 'Claude Arbeitspferd 3' und Schema eintragen*" }) | Should Not BeNullOrEmpty
        $out -contains "[DryRun] wuerde Verknuepfung anlegen: $heim\Desktop\Claude Arbeitspferd 3.lnk" | Should Be $true
    }

    Remove-Heim $heim
}

Describe 'einrichten.ps1 for the second and a third account' {
    $heim = New-Heim
    $k2 = Join-Path $heim '.claude-arbeitspferd'
    $k3 = Join-Path $heim '.claude-arbeitspferd-3'
    $null = Invoke-Einrichten $heim @()
    $out = Invoke-Einrichten $heim @('-Konfig', $k3)
    $wt = Get-Profile $heim
    $p2 = $wt.profiles.list | Where-Object name -eq 'Claude Arbeitspferd'
    $p3 = $wt.profiles.list | Where-Object name -eq 'Claude Arbeitspferd 3'

    It 'keeps the second account as before by default' {
        $p2.guid | Should Be $vorlageGuid
        $p2.tabColor | Should Be '#D97757'
        $p2.icon | Should Be "$k2\arbeitspferd.ico"
        $p2.commandline | Should Match ([regex]::Escape("$k2\start-arbeitspferd.ps1"))
    }

    It 'builds the same folder for the third account' {
        Test-Path "$k3\CLAUDE.md" | Should Be $true
        Test-Path "$k3\start-arbeitspferd.ps1" | Should Be $true
        Test-Path "$k3\arbeitspferd-3.ico" | Should Be $true
        foreach ($n in 'skills', 'agents', 'output-styles', 'plugins', 'themes') {
            $item = Get-Item "$k3\$n" -Force
            $item.LinkType | Should Be 'Junction'
            "$($item.Target)" | Should Be "$heim\.claude\$n"
        }
    }

    It 'lists every config folder in the settings of both accounts' {
        foreach ($k in $k2, $k3) {
            $dirs = @((Get-Content -Raw "$k\settings.json" | ConvertFrom-Json).permissions.additionalDirectories)
            $dirs -contains "$heim\.claude" | Should Be $true
            $dirs -contains $k2 | Should Be $true
            $dirs -contains $k3 | Should Be $true
            ($dirs | Select-Object -Unique).Count | Should Be $dirs.Count
        }
    }

    It 'adds a profile of its own with icon, colour and title' {
        @($wt.profiles.list).Count | Should Be 3
        $p3.guid | Should Not Be $vorlageGuid
        $p3.tabColor | Should Be '#7AA2C8'
        $p3.icon | Should Be "$k3\arbeitspferd-3.ico"
        $p3.commandline | Should Match ([regex]::Escape("$k3\start-arbeitspferd.ps1") + '" -Titel "Claude Arbeitspferd 3"$')
        @($wt.schemes | Where-Object name -eq 'Claude Code').Count | Should Be 1
    }

    It 'creates the desktop shortcut' {
        $sc = (New-Object -ComObject WScript.Shell).CreateShortcut("$heim\Desktop\Claude Arbeitspferd 3.lnk")
        $sc.TargetPath | Should Match 'wt\.exe$'
        $sc.Arguments | Should Be '-w new -p "Claude Arbeitspferd 3"'
        $sc.IconLocation | Should Match ([regex]::Escape("$k3\arbeitspferd-3.ico"))
    }

    It 'replaces its profile and keeps an existing shortcut on a second call' {
        Set-Content -LiteralPath "$heim\Desktop\Claude Arbeitspferd 3.lnk" -Value 'von Hand'
        $nochmal = Invoke-Einrichten $heim @('-Konfig', $k3)
        @((Get-Profile $heim).profiles.list).Count | Should Be 3
        $nochmal -contains "Verknuepfung vorhanden: $heim\Desktop\Claude Arbeitspferd 3.lnk" | Should Be $true
        (Get-Content -LiteralPath "$heim\Desktop\Claude Arbeitspferd 3.lnk") | Should Be 'von Hand'
    }

    Remove-Heim $heim
}

Describe 'einrichten.ps1 for the main account' {
    $heim = New-Heim
    New-Item -ItemType Directory "$heim\.claude" | Out-Null
    Set-Content -LiteralPath "$heim\.claude\CLAUDE.md" -Value 'eigene Regeln'
    $null = Invoke-Einrichten $heim @('-Konfig', "$heim\.claude")
    $p1 = (Get-Profile $heim).profiles.list | Where-Object name -eq 'Claude Hauptkonto'

    It 'copies only start script and icon and leaves the account files alone' {
        Test-Path "$heim\.claude\start-claude.ps1" | Should Be $true
        Test-Path "$heim\.claude\hauptkonto.ico" | Should Be $true
        Test-Path "$heim\.claude\settings.json" | Should Be $false
        Test-Path "$heim\.claude\start-arbeitspferd.ps1" | Should Be $false
        Get-Content -LiteralPath "$heim\.claude\CLAUDE.md" | Should Be 'eigene Regeln'
        @(Get-ChildItem "$heim\.claude" -Force | Where-Object { $_.LinkType }).Count | Should Be 0
    }

    It 'adds the profile "Claude Hauptkonto" with its own colour' {
        $p1.guid | Should Not Be $vorlageGuid
        $p1.tabColor | Should Be '#8FB573'
        $p1.icon | Should Be "$heim\.claude\hauptkonto.ico"
        $p1.commandline | Should Match ([regex]::Escape("$heim\.claude\start-claude.ps1"))
        Test-Path "$heim\Desktop\Claude Hauptkonto.lnk" | Should Be $true
    }

    Remove-Heim $heim
}

Describe 'einrichten.ps1 -Konfig' {
    It 'refuses a folder that is no account folder' {
        $heim = New-Heim
        $out = Invoke-Einrichten $heim @('-Konfig', "$heim\.anderes", '-DryRun')
        $LASTEXITCODE | Should Not Be 0
        ($out -join "`n") | Should Match 'Konfigordner muss'
        Remove-Heim $heim
    }
}

Describe 'start-arbeitspferd.ps1' {
    $heim = New-Heim
    $bin = Join-Path $heim 'bin'
    New-Item -ItemType Directory $bin | Out-Null
    $aufruf = Join-Path $heim 'aufruf.txt'
    # the stand-in for claude records the account it got
    Set-Content -LiteralPath (Join-Path $bin 'claude.ps1') -Encoding UTF8 -Value "Set-Content -LiteralPath '$aufruf' -Value ('[' + `$env:CLAUDE_CONFIG_DIR + ']')"
    $auftrag = Join-Path $heim 'auftrag.txt'
    Set-Content -LiteralPath $auftrag -Value 'weiter'

    function Invoke-Start([string]$ordner, [string]$name) {
        New-Item -ItemType Directory -Force $ordner | Out-Null
        Copy-Item $start (Join-Path $ordner $name)
        $altPath = $env:PATH; $altCfg = $env:CLAUDE_CONFIG_DIR
        $env:PATH = "$bin;$env:PATH"; $env:CLAUDE_CONFIG_DIR = 'C:\vorher'
        try { $null = Invoke-ImHeim $heim (Join-Path $ordner $name) @('-AuftragDatei', $auftrag, '-Titel', 'Test') }
        finally { $env:PATH = $altPath; $env:CLAUDE_CONFIG_DIR = $altCfg }
        Get-Content -LiteralPath $aufruf
    }

    It 'starts claude with the account of its own folder' {
        Invoke-Start "$heim\.claude-arbeitspferd-3" 'start-arbeitspferd.ps1' | Should Be "[$heim\.claude-arbeitspferd-3]"
    }

    It 'starts the main account without CLAUDE_CONFIG_DIR' {
        Invoke-Start "$heim\.claude" 'start-claude.ps1' | Should Be '[]'
    }

    Remove-Heim $heim
}
