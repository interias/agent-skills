# Merge gate of flotte-probe (agent-skills#14, probe 3). Same output form as the gate of a real
# project: one context per area (alpha/, beta/, gamma/), `wurzel` on every change, a summary at the
# end whose head line names base and HEAD.
#   (no switch)  the contexts the change touches since the merge-base with origin/main, plus wurzel
#   -Alle        all contexts
#   -Immer       only wurzel, the part that always runs (head line "Immer-Teil"); record only: since the
#                gate rebuild a partial run never counts
# A context is red when one of its .txt files is empty or contains ROT. gamma also starts the
# compose service of the repository and asks it for a line; the container stays up for the cleanup
# of the skill to remove.
# Probe triggers in the git common dir (each used once, then deleted):
#   probe-lang  the gate stays silent for 300 s first (a long gate above the idle limit)
#   probe-rot   the first run on a merge of origin/main into the branch ends red
param([switch]$Alle, [switch]$Immer)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$gruen = "gr$([char]0xFC)n"

if ($Alle -and $Immer) { Write-Error 'Gate: -Alle und -Immer schliessen sich aus'; exit 2 }
$common = (git rev-parse --git-common-dir).Trim()
$lang = Join-Path $common 'probe-lang'
if (Test-Path $lang) { Remove-Item $lang; Start-Sleep -Seconds 300 }

$mb = (git merge-base HEAD origin/main).Trim()
if ($LASTEXITCODE) { Write-Error 'Gate: kein merge-base mit origin/main'; exit 2 }
$head = (git rev-parse --short=8 HEAD).Trim()
$dateien = @(git diff --name-only $mb) + @(git ls-files --others --exclude-standard) | Where-Object { $_ } | Select-Object -Unique
$bereiche = 'alpha', 'beta', 'gamma'
$beruehrt = if ($Alle) { $bereiche } elseif ($Immer) { @() } else { $bereiche | Where-Object { $b = $_; $dateien | Where-Object { $_ -like "$b/*" } } }

function Test-Dateien([string]$ordner) {
    foreach ($f in @(Get-ChildItem $ordner -Filter *.txt -File -ErrorAction SilentlyContinue)) {
        $t = Get-Content $f.FullName -Raw
        if (-not $t -or $t -match 'ROT') { return "$ordner/$($f.Name) leer oder ROT" }
    }
    $null
}

$zeilen = @()
$rot = $false
foreach ($b in $bereiche) {
    if ($b -notin $beruehrt) { $zeilen += "  $($b.PadRight(8)) $("$([char]0xFC)bersprungen".PadRight(13))"; continue }
    $start = Get-Date
    Write-Output "`n== Gate: $b"
    $grund = Test-Dateien $b
    if (-not $grund -and $b -eq 'gamma') {
        docker compose up -d --quiet-pull 2>&1 | Out-Null
        $antwort = docker compose exec -T dienst echo dienst-da 2>&1
        if ("$antwort".Trim() -ne 'dienst-da') { $grund = "Dienst antwortet nicht: $antwort" }
    }
    $s = [int]((Get-Date) - $start).TotalSeconds
    $zeit = '{0}:{1:00}' -f [int][math]::Floor($s / 60), ($s % 60)
    if ($grund) { $rot = $true; $zeilen += "  $($b.PadRight(8)) $('rot'.PadRight(13)) $($zeit.PadLeft(6))  $grund" }
    else { $zeilen += "  $($b.PadRight(8)) $($gruen.PadRight(13)) $($zeit.PadLeft(6))" }
}

# wurzel: CHANGELOG.md is readable and no file at the root says ROT
$start = Get-Date
Write-Output "`n== Gate: wurzel"
$grund = $null
$rotDatei = Join-Path $common 'probe-rot'
$eltern = @((git rev-list --parents -n 1 HEAD).Trim() -split ' ')
$basis = (git rev-parse origin/main).Trim()
if ((Test-Path $rotDatei) -and $eltern.Count -eq 3 -and $eltern[2] -eq $basis) {
    Remove-Item $rotDatei
    $grund = 'Probe: rot beim ersten Lauf nach dem Merge der Basis'
}
if (-not $grund) { $grund = Test-Dateien '.' }
$s = [int]((Get-Date) - $start).TotalSeconds
$zeit = '{0}:{1:00}' -f [int][math]::Floor($s / 60), ($s % 60)
if ($grund) { $rot = $true; $zeilen += "  $('wurzel'.PadRight(8)) $('rot'.PadRight(13)) $($zeit.PadLeft(6))  $grund" }
else { $zeilen += "  $('wurzel'.PadRight(8)) $($gruen.PadRight(13)) $($zeit.PadLeft(6))" }

$kopf = if ($Alle) { "--alle, Basis origin/main @ $($mb.Substring(0, 7)) (HEAD $head)" }
elseif ($Immer) { "Immer-Teil, Basis origin/main @ $($mb.Substring(0, 7)) (HEAD $head)" }
else { "Basis origin/main @ $($mb.Substring(0, 7)), $(@($dateien).Count) ge$([char]0xE4)nderte Dateien (HEAD $head)" }
Write-Output ''
Write-Output "== Gate: $kopf"
$zeilen | ForEach-Object { Write-Output $_ }
if ($rot) { Write-Output 'Gate rot.'; exit 1 }
Write-Output "Gate $gruen."
exit 0
