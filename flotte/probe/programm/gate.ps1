# Gate of the before/after probe of the epic program (agent-skills#69). Same output form as the
# gate of probe 3 (one context per area, `wurzel` always, a head line with base and HEAD), without
# the compose service.
#   (no switch)  the contexts the change touches since the merge-base with origin/main, plus wurzel
#   -Alle        all contexts
#   -Immer       only wurzel, the part that always runs (head line "Immer-Teil")
# Every area: a .txt file must not be empty and must not contain ROT (upper case). Further rules of
# the probe come from <git common dir>/probe-regeln.ps1 when it exists.
param([switch]$Alle, [switch]$Immer)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$gruen = "gr$([char]0xFC)n"

if ($Alle -and $Immer) { Write-Error 'Gate: -Alle und -Immer schliessen sich aus'; exit 2 }
$common = (git rev-parse --path-format=absolute --git-common-dir).Trim()
$branch = (git rev-parse --abbrev-ref HEAD).Trim()

$mb = (git merge-base HEAD origin/main).Trim()
if ($LASTEXITCODE) { Write-Error 'Gate: kein merge-base mit origin/main'; exit 2 }
$head = (git rev-parse --short=8 HEAD).Trim()
$dateien = @(git diff --name-only $mb) + @(git ls-files --others --exclude-standard) | Where-Object { $_ } | Select-Object -Unique
$bereiche = 'obst', 'verse', 'thema'
$beruehrt = if ($Alle) { $bereiche } elseif ($Immer) { @() } else { $bereiche | Where-Object { $b = $_; $dateien | Where-Object { $_ -like "$b/*" } } }

function Test-ProbeRegel([string]$bereich) { $null }
$regeln = Join-Path $common 'probe-regeln.ps1'
if (Test-Path $regeln) { . $regeln }

function Test-Dateien([string]$ordner) {
    foreach ($f in @(Get-ChildItem $ordner -Filter *.txt -File -ErrorAction SilentlyContinue)) {
        $t = Get-Content $f.FullName -Raw
        if (-not $t -or $t -cmatch 'ROT') { return "$ordner/$($f.Name) leer oder ROT" }
    }
    $null
}

function Zeile([string]$name, [string]$grund, [datetime]$start) {
    $s = [int]((Get-Date) - $start).TotalSeconds
    $zeit = '{0}:{1:00}' -f [int][math]::Floor($s / 60), ($s % 60)
    if ($grund) { "  $($name.PadRight(8)) $('rot'.PadRight(13)) $($zeit.PadLeft(6))  $grund" }
    else { "  $($name.PadRight(8)) $($gruen.PadRight(13)) $($zeit.PadLeft(6))" }
}

$zeilen = @()
$rot = $false
foreach ($b in $bereiche) {
    if ($b -notin $beruehrt) { $zeilen += "  $($b.PadRight(8)) $("$([char]0xFC)bersprungen".PadRight(13))"; continue }
    $start = Get-Date
    Write-Output "`n== Gate: $b"
    $grund = Test-Dateien $b
    if (-not $grund) { $grund = Test-ProbeRegel $b }
    if ($grund) { $rot = $true }
    $zeilen += Zeile $b $grund $start
}

# wurzel: no .txt file at the root says ROT
$start = Get-Date
Write-Output "`n== Gate: wurzel"
$grund = Test-Dateien '.'
if ($grund) { $rot = $true }
$zeilen += Zeile 'wurzel' $grund $start

$kopf = if ($Alle) { "--alle, Basis origin/main @ $($mb.Substring(0, 7)) (HEAD $head)" }
elseif ($Immer) { "Immer-Teil, Basis origin/main @ $($mb.Substring(0, 7)) (HEAD $head)" }
else { "Basis origin/main @ $($mb.Substring(0, 7)), $(@($dateien).Count) ge$([char]0xE4)nderte Dateien (HEAD $head)" }
Write-Output ''
Write-Output "== Gate: $kopf"
$zeilen | ForEach-Object { Write-Output $_ }
if ($rot) { Write-Output 'Gate rot.'; exit 1 }
Write-Output "Gate $gruen."
exit 0
