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
$teile = [ordered]@{
    flotte  = { Push-Location flotte; bun test; $c = $LASTEXITCODE; Pop-Location; $c }
    bruecke = { Push-Location flottenbruecke; python -m pytest -q -p no:cacheprovider "--basetemp=$(Join-Path $env:TEMP agent-skills-gate-$PID)"; $c = $LASTEXITCODE; Pop-Location; $c }
    pester  = { $r = Invoke-Pester -Path (Get-ChildItem mission\scripts\*.Tests.ps1, install.Tests.ps1).FullName -PassThru -Output None; [int]($r.FailedCount -gt 0) }
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
