# Merge gate of agent-skills: runs every suite of the repository and prints the gate block the
# flotte driver and merge.ps1 read (mission/references/adapter.md, "Der Andockblock").
# Usage (in a worktree): pwsh -NoProfile -File gate.ps1
$ErrorActionPreference = 'Continue'
# the driver reads stdout as UTF-8; without this "Gate grün." arrives mangled and counts as red
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Set-Location $PSScriptRoot
git fetch -q origin main 2>$null
$basis = (git merge-base HEAD origin/main).Trim()
$kopf = (git rev-parse HEAD).Trim()
# The Pester suites run where test_commands run them: Windows PowerShell 5.1 with Pester 3.4, the
# version they are written for (INSTALL.md). Without a Pester below 5 the newest one runs with its
# own switches; the call differs between the two (-Quiet against -Output), and a call that fails
# leaves no result. Its messages stay ASCII: the 5.1 host writes them in the console code page.
# The part is green only with a result, more than 0 tests (#165) and no red test (#129).
$pesterLauf = @'
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Set-Location -LiteralPath '<ROOT>'
$da = @(Get-Module Pester -ListAvailable | Sort-Object Version -Descending)
$modul = @(@($da | Where-Object { $_.Version.Major -lt 5 }) + $da)[0]
if (-not $modul) { 'pester: kein Pester installiert, vorausgesetzt ist Pester 3.4 (INSTALL.md).'; exit 1 }
Import-Module $modul.Path -Force
if (-not (Test-Path -LiteralPath install.Tests.ps1)) { 'pester: install.Tests.ps1 fehlt.'; exit 1 }
$dateien = @((Get-ChildItem mission\scripts\*.Tests.ps1, install.Tests.ps1).FullName)
$fuenf = $modul.Version.Major -ge 5
$still = if ($fuenf) { @{ Output = 'None' } } else { @{ Quiet = $true } }
$r = Invoke-Pester -Path $dateien -PassThru @still
if (-not $r) { "pester: Invoke-Pester $($modul.Version) lieferte kein Ergebnis."; exit 1 }
$rot = if ($fuenf) { @($r.Failed | ForEach-Object { $_.ExpandedPath }) } else { @($r.TestResult | Where-Object { $_.Result -eq 'Failed' } | ForEach-Object { "$($_.Describe) :: $($_.Name) :: $(@("$($_.FailureMessage)" -split "`n")[0])" }) }
foreach ($t in $rot) { "pester: ROT $t" }
"pester: Pester $($modul.Version), $($dateien.Count) Dateien, $($r.TotalCount) Tests, $($r.FailedCount) rot"
if ($r.TotalCount -eq 0) { 'pester: kein Test gelaufen (Testzahl 0), der Teil ist rot (#165).'; exit 1 }
if ($r.FailedCount -gt 0 -or $rot) { exit 1 }
exit 0
'@
$teile = [ordered]@{
    flotte  = { Push-Location flotte; bun test; $c = $LASTEXITCODE; Pop-Location; $c }
    bruecke = { Push-Location flottenbruecke; python -m pytest -q -p no:cacheprovider "--basetemp=$(Join-Path $env:TEMP agent-skills-gate-$PID)"; $c = $LASTEXITCODE; Pop-Location; $c }
    pester  = { powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($pesterLauf.Replace('<ROOT>', $PSScriptRoot)))); [int]($LASTEXITCODE -ne 0) }
}
$zeilen = @(); $gruen = $true
foreach ($n in $teile.Keys) {
    $t0 = Get-Date
    $code = & $teile[$n] 2>&1 | Tee-Object -Variable aus | Select-Object -Last 1
    $ok = ($code -eq 0)
    if (-not $ok) { $gruen = $false; $aus | Select-Object -Last 30 | Out-Host }
    $zeilen += '  {0,-8} {1,-6} {2,6:N0} s' -f $n, ($(if ($ok) { 'grün' } else { 'ROT' })), ((Get-Date) - $t0).TotalSeconds
}
''
"== Gate: Basis origin/main @ $($basis.Substring(0, 7)) (HEAD $($kopf.Substring(0, 8)))"
$zeilen
if ($gruen) { 'Gate grün.'; exit 0 } else { 'Gate ROT.'; exit 1 }
