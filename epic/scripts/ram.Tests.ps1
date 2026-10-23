# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\epic\scripts\ram.Tests.ps1
# The measurement is stubbed with -TotalGb/-FreeGb; the script runs as a separate process, the
# way /epic and /epic-flotte call it. One test measures for real.

$script = Join-Path $PSScriptRoot 'ram.ps1'

# stdout and stderr apart: the script promises exactly one JSON object on stdout.
function Invoke-Ram([string[]]$arguments) {
    $errFile = Join-Path $TestDrive ([guid]::NewGuid().ToString('N') + '.err')
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script @arguments 2>$errFile
    @{ Exit = $LASTEXITCODE; Out = @($out | Where-Object { $_ -ne $null }); Err = ((Get-Content $errFile -Raw) -replace '\s+', ' ') }
}

# A reading with the given used percent on a 100 GB machine.
function Get-Level([double]$usedPercent, [string[]]$extra = @()) {
    $r = Invoke-Ram (@('-TotalGb', '100', '-FreeGb', (100 - $usedPercent).ToString([cultureinfo]::InvariantCulture)) + $extra)
    $r.Out[0] | ConvertFrom-Json
}

function New-AdapterRepo([string]$frontmatter) {
    $repo = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path (Join-Path $repo '.claude') -Force | Out-Null
    Set-Content -Path (Join-Path $repo '.claude\epic.md') -Value "---`n$frontmatter`n---`n`n# Adapter"
    $repo
}

Describe 'ram.ps1 levels with the defaults 75 / 85 / 4' {
    It 'rates 74 % used as ok' { (Get-Level 74).level | Should Be 'ok' }
    It 'rates exactly 75 % used as warn' { (Get-Level 75).level | Should Be 'warn' }
    It 'rates 76 % used as warn' { (Get-Level 76).level | Should Be 'warn' }
    It 'rates 84 % used as warn' { (Get-Level 84).level | Should Be 'warn' }
    It 'rates exactly 85 % used as hold' { (Get-Level 85).level | Should Be 'hold' }
    It 'rates 86 % used as hold' { (Get-Level 86).level | Should Be 'hold' }

    It 'is at least warn below 4 GB free even at 60 % used' {
        $r = Invoke-Ram @('-TotalGb', '9.75', '-FreeGb', '3.9')
        $j = $r.Out[0] | ConvertFrom-Json
        $j.percent_used | Should Be 60
        $j.free_gb | Should Be 3.9
        $j.level | Should Be 'warn'
    }
    It 'stays ok at exactly 4 GB free and 60 % used' {
        ((Invoke-Ram @('-TotalGb', '10', '-FreeGb', '4')).Out[0] | ConvertFrom-Json).level | Should Be 'ok'
    }
    It 'does not lower hold when little is free' {
        ((Invoke-Ram @('-TotalGb', '16', '-FreeGb', '1')).Out[0] | ConvertFrom-Json).level | Should Be 'hold'
    }
}

Describe 'ram.ps1 settings' {
    It 'takes the three values from the parameters' {
        (Get-Level 66 @('-WarnPercent', '65')).level | Should Be 'warn'
        (Get-Level 76 @('-HoldPercent', '76')).level | Should Be 'hold'
        ((Invoke-Ram @('-TotalGb', '100', '-FreeGb', '30', '-MinFreeGb', '40')).Out[0] | ConvertFrom-Json).level | Should Be 'warn'
    }
    It 'takes the three values from the frontmatter of the adapter' {
        $repo = New-AdapterRepo "ram_warn_percent: 50`nram_hold_percent: 60  # tight`nram_min_free_gb: 1"
        (Get-Level 49 @('-RepoRoot', $repo)).level | Should Be 'ok'
        (Get-Level 50 @('-RepoRoot', $repo)).level | Should Be 'warn'
        (Get-Level 60 @('-RepoRoot', $repo)).level | Should Be 'hold'
    }
    It 'lets a parameter win over the adapter' {
        $repo = New-AdapterRepo "ram_warn_percent: 50"
        (Get-Level 55 @('-RepoRoot', $repo, '-WarnPercent', '70')).level | Should Be 'ok'
    }
    It 'falls back to the defaults for a missing key, adapter or frontmatter' {
        $partial = New-AdapterRepo 'ram_hold_percent: 90'
        (Get-Level 80 @('-RepoRoot', $partial)).level | Should Be 'warn'
        (Get-Level 90 @('-RepoRoot', $partial)).level | Should Be 'hold'
        $empty = Join-Path $TestDrive 'norepo'
        New-Item -ItemType Directory -Path $empty | Out-Null
        (Get-Level 75 @('-RepoRoot', $empty)).level | Should Be 'warn'
    }
    It 'refuses a value that is not a number' {
        $repo = New-AdapterRepo 'ram_warn_percent: viel'
        $r = Invoke-Ram @('-RepoRoot', $repo, '-TotalGb', '100', '-FreeGb', '50')
        $r.Exit | Should Be 1
        $r.Out.Count | Should Be 0
        $r.Err | Should Match 'ram_warn_percent'
    }
    It 'refuses warn at or above hold' {
        $r = Invoke-Ram @('-TotalGb', '100', '-FreeGb', '50', '-WarnPercent', '90', '-HoldPercent', '80')
        $r.Exit | Should Be 1
        $r.Err | Should Match 'warn < hold'
    }
    It 'refuses NaN and Infinity instead of rating everything ok' {
        foreach ($bad in @('-WarnPercent', 'NaN'), @('-HoldPercent', 'NaN'), @('-MinFreeGb', 'NaN'), @('-WarnPercent', 'Infinity')) {
            $r = Invoke-Ram (@('-TotalGb', '100', '-FreeGb', '5') + $bad)
            $r.Exit | Should Be 1
            $r.Out.Count | Should Be 0
        }
        (Invoke-Ram @('-TotalGb', 'NaN', '-FreeGb', '5')).Exit | Should Be 1
    }
    It 'compares the raw values, not the rounded ones' {
        $j = (Invoke-Ram @('-TotalGb', '100', '-FreeGb', '25.04')).Out[0] | ConvertFrom-Json
        $j.percent_used | Should Be 75
        $j.level | Should Be 'ok'
    }
    It 'refuses -TotalGb without -FreeGb' {
        $r = Invoke-Ram @('-TotalGb', '100')
        $r.Exit | Should Be 1
        $r.Err | Should Match 'together'
    }
}

Describe 'ram.ps1 output' {
    It 'prints exactly one JSON object on stdout and exits 0 for every level' {
        foreach ($free in 50, 20, 5) {
            $r = Invoke-Ram @('-TotalGb', '100', '-FreeGb', "$free")
            $r.Exit | Should Be 0
            $r.Out.Count | Should Be 1
            $j = $r.Out[0] | ConvertFrom-Json
            @($j.PSObject.Properties.Name | Sort-Object) -join ',' | Should Be 'free_gb,level,percent_used,total_gb'
            $r.Err | Should BeNullOrEmpty
        }
    }
    It 'measures the real machine' {
        $r = Invoke-Ram @()
        $r.Exit | Should Be 0
        $r.Out.Count | Should Be 1
        $j = $r.Out[0] | ConvertFrom-Json
        ($j.percent_used -gt 0 -and $j.percent_used -lt 100) | Should Be $true
        ($j.free_gb -gt 0 -and $j.free_gb -lt $j.total_gb) | Should Be $true
        @('ok', 'warn', 'hold') -contains $j.level | Should Be $true
    }
}
