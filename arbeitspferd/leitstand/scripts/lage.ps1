# One compact overview: every registered session (alive, state, last activity), open PRs per repo, RAM.
# Usage: lage.ps1                       overview
#        lage.ps1 -Eintragen <id> -Repo <path> [-Modus ...]   adopt a session that was started by hand
#        lage.ps1 -Abhaken <id>          mark a session as done, the watcher stops looking at it
param([string]$Eintragen, [string]$Repo, [string]$Modus = 'issues', [string]$Abhaken)

$cfg = "$HOME\.claude-arbeitspferd"
$regDatei = "$cfg\leitstand\register.json"
New-Item -ItemType Directory -Force (Split-Path $regDatei) | Out-Null
$reg = @(Get-Content $regDatei -Raw -EA SilentlyContinue | ConvertFrom-Json) | Where-Object { $_ }

if ($Eintragen -or $Abhaken) {
    if ($Eintragen) {
        $path = if ([IO.Path]::IsPathRooted($Repo)) { $Repo } else { Join-Path "$HOME\git" $Repo }
        Push-Location $path; $gh = gh repo view --json nameWithOwner -q .nameWithOwner 2>$null; Pop-Location
        $reg = @($reg | Where-Object sessionId -ne $Eintragen) + [pscustomobject]@{
            name = Split-Path -Leaf $path; repo = $path; gh = $gh; sessionId = $Eintragen
            modus = $Modus; seit = (Get-Date -Format 'yyyy-MM-dd HH:mm'); aktiv = $true
        }
    }
    if ($Abhaken) { $reg | Where-Object sessionId -eq $Abhaken | ForEach-Object { $_.aktiv = $false } }
    ConvertTo-Json -InputObject @($reg) -Depth 3 | Set-Content $regDatei -Encoding utf8NoBOM
}

$sess = Get-ChildItem "$cfg\sessions\*.json" -EA SilentlyContinue | ForEach-Object { Get-Content $_ -Raw -EA SilentlyContinue | ConvertFrom-Json -EA SilentlyContinue }
foreach ($e in $reg | Where-Object aktiv) {
    $s = $sess | Where-Object sessionId -eq $e.sessionId | Select-Object -First 1
    $lebt = $s -and (Get-Process -Id $s.pid -EA SilentlyContinue)
    $zustand = if (-not $lebt) { 'beendet' } elseif ($s.waitingFor) { "$($s.status), wartet auf $($s.waitingFor)" } else { $s.status }
    $seit = if ($s.statusUpdatedAt) { [int]((Get-Date) - [DateTimeOffset]::FromUnixTimeMilliseconds($s.statusUpdatedAt).LocalDateTime).TotalMinutes } else { '?' }
    "SITZUNG $($e.name) [$($e.modus)] $($e.sessionId.Substring(0, 8)): $zustand seit $seit min"
}
foreach ($gh in $reg | Where-Object aktiv | ForEach-Object gh | Where-Object { $_ } | Select-Object -Unique) {
    $prs = @(gh pr list --repo $gh --json number,title,isDraft | ConvertFrom-Json)
    if ($prs) { $prs | ForEach-Object { "PR $gh #$($_.number)$(if ($_.isDraft) { ' (Entwurf)' }): $($_.title)" } } else { "PR ${gh}: keine offenen" }
}
$ram = powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.claude\skills\epic\scripts\ram.ps1" -RepoRoot "$HOME\git" 2>$null | ConvertFrom-Json
if ($ram) { "RAM $($ram.percent_used) % belegt, $($ram.free_gb) GB frei, Stufe $($ram.level)" }
