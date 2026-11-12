# Starts a new Arbeitspferd session in its own window, appends the standing fleet rules to the brief and
# the machine-specific rules from leitstand\lokal.md if present, and records the session in the register so waechter.ps1, nachricht.ps1 and lage.ps1 know it.
# Usage: start.ps1 -Repo <repo> -Auftrag <text or file> [-Modus epic|flotte|issues|nacharbeit|aufraeumen] [-Gh owner/name]
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][string]$Auftrag,
    [string]$Modus = 'issues',
    [string]$Gh,
    [string[]]$AddDir
)

$cfg = "$HOME\.claude-arbeitspferd"
$path = if ([IO.Path]::IsPathRooted($Repo)) { $Repo } else { Join-Path "$HOME\git" $Repo }
if (-not (Test-Path $path)) { throw "Repository nicht gefunden: $path" }
if (-not $Gh) { Push-Location $path; $Gh = gh repo view --json nameWithOwner -q .nameWithOwner 2>$null; Pop-Location }

$text = if (Test-Path $Auftrag -PathType Leaf) { Get-Content -Raw $Auftrag } else { $Auftrag }
$text += "`n`n" + (Get-Content -Raw "$PSScriptRoot\..\references\flotten-regeln.md").Replace('{CFG}', $cfg)
if (Test-Path "$cfg\leitstand\lokal.md") { $text += "`n" + (Get-Content -Raw "$cfg\leitstand\lokal.md") }
$AddDir = @($AddDir) + @($cfg, "$HOME\.claude", "$path-worktrees") | Where-Object { $_ } | Select-Object -Unique

$vorher = @(Get-ChildItem "$cfg\sessions\*.json" -EA SilentlyContinue | ForEach-Object Name)
& "$cfg\auftrag.ps1" -Repo $path -Auftrag $text -AddDir ($AddDir -join ',') | Out-Null

# The new session file appears once claude is up; an unknown folder stops at the trust prompt instead
$neu = $null
foreach ($i in 1..45) {
    Start-Sleep 2
    $neu = Get-ChildItem "$cfg\sessions\*.json" | Where-Object Name -notin $vorher |
        ForEach-Object { Get-Content $_ -Raw | ConvertFrom-Json } | Where-Object cwd -eq $path | Select-Object -First 1
    if ($neu) { break }
}
if (-not $neu) { "KEINE SITZUNG nach 90 s in $path - Fenster pruefen (Vertrauensfrage?)"; exit 1 }

$regDatei = "$cfg\leitstand\register.json"
New-Item -ItemType Directory -Force (Split-Path $regDatei) | Out-Null
$reg = @(Get-Content $regDatei -Raw -EA SilentlyContinue | ConvertFrom-Json)
$reg = @($reg | Where-Object { $_ -and $_.sessionId -ne $neu.sessionId }) + [pscustomobject]@{
    name = Split-Path -Leaf $path; repo = $path; gh = $Gh; sessionId = $neu.sessionId
    modus = $Modus; seit = (Get-Date -Format 'yyyy-MM-dd HH:mm'); aktiv = $true
}
ConvertTo-Json -InputObject $reg -Depth 3 | Set-Content $regDatei -Encoding utf8NoBOM
"GESTARTET $(Split-Path -Leaf $path) $($neu.sessionId) ($Modus)"
