# Opens a new Windows Terminal window in a repository and starts the Arbeitspferd there with a prompt.
# Usage: auftrag.ps1 -Repo kicherklotz -Auftrag "/epic-flotte"
#        auftrag.ps1 -Repo kicherklotz -Auftrag "weiter" -Resume <session id>
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][string]$Auftrag,
    [string]$Resume,
    [string[]]$AddDir
)

$cfg = "$HOME\.claude-arbeitspferd"
$path = if ([IO.Path]::IsPathRooted($Repo)) { $Repo } else { Join-Path "$HOME\git" $Repo }
if (-not (Test-Path $path)) { throw "Repository nicht gefunden: $path" }

# The prompt goes through a file so quotes and semicolons survive the hand-over to wt
New-Item -ItemType Directory -Force "$cfg\auftraege" | Out-Null
$datei = Join-Path "$cfg\auftraege" "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$(Split-Path -Leaf $path).txt"
Set-Content $datei $Auftrag -Encoding utf8NoBOM

# Each repository gets its own tab colour so windows are told apart at a glance; unknown ones pick from the palette by name
$farben = @{ hexanite = '#3FA7A0'; tippel = '#9B7BD8'; kicherklotz = '#E3B341'; Milon = '#5B9BD5' }
$palette = '#D97757', '#3FA7A0', '#9B7BD8', '#E3B341', '#5B9BD5', '#7FB069', '#D46A8C'
$name = Split-Path -Leaf $path
$tab = if ($farben[$name]) { $farben[$name] } else { $palette[([int[]][char[]]$name | Measure-Object -Sum).Sum % $palette.Count] }

# Profile "Claude Arbeitspferd" in Windows Terminal supplies the Claude look (scheme, icon); the command line here overrides its own
wt -w new -p "Claude Arbeitspferd" --tabColor $tab --title "Arbeitspferd $(Split-Path -Leaf $path)" -d $path pwsh -NoExit -NoLogo -ExecutionPolicy Bypass -File "$cfg\start-arbeitspferd.ps1" -AuftragDatei $datei $(if ($Resume) { '-Resume', $Resume }) $(if ($AddDir) { '-AddDir', ($AddDir -join ',') })
Write-Host "Gestartet in $path (Auftrag: $datei)"
