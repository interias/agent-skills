<#
.SYNOPSIS
    Prepares one run of the before/after probe of the epic program (agent-skills#69) in a clone of
    flotte-probe: skill copy, agents, adapter, gate and the base state of the areas on main, then
    the three mini-epics as new issues and the probe triggers.

.DESCRIPTION
    Before (stage 0) and after (stage 4) run the same preparation, once per run:
    - .claude/skills/epic-stapel/  the skill epic of this repository; only `name` and the path of
      the hook differ (a personal skill `epic` would win otherwise)
    - .claude/agents/              the agents of this repository unchanged, with their real models;
      only the hook path of the scout points at the copy
    - .claude/epic.md, werkzeug/gate.ps1, obst/ verse/ thema/  from this folder (basis/)
    One commit on main, pushed. Then per mini-epic (mini-epic-*.md) the epic and its children as
    issues over the GitHub API, labels `epic` and `ready-for-agent`. Last, into the git common dir:
    the hidden rules of the gate (regeln.ps1 as probe-regeln.ps1) and its triggers,
    probe-rot-paket for the first child of C and probe-rot-epic for B.
    stdout carries one JSON object with the issue numbers.

.EXAMPLE
    pwsh -NoProfile -File flotte/probe/programm/vorbereiten.ps1 -Probe C:\src\flotte-probe -Lauf vorher-1
#>
param(
    [Parameter(Mandatory)][string]$Probe,
    [Parameter(Mandatory)][string]$Lauf,
    [string]$Forge = 'interias/flotte-probe'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$hier = $PSScriptRoot
$stapel = (Resolve-Path (Join-Path $hier '../../..')).Path

function Invoke-ProbeGit { git -C $Probe @args; if ($LASTEXITCODE) { throw "git $args" } }

# this script commits and pushes to main: only in a clone of the probe repository
$origin = (git -C $Probe remote get-url origin).Trim()
if ($origin -notmatch "[/:]$([regex]::Escape($Forge))(\.git)?$") { throw "$Probe ist kein Klon von $Forge (origin $origin)" }

Invoke-ProbeGit switch -q main
Invoke-ProbeGit pull -q --ff-only

# skill copy and agents
$skill = Join-Path $Probe '.claude/skills/epic-stapel'
if (Test-Path $skill) { Remove-Item $skill -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $skill 'scripts'), (Join-Path $skill 'references') | Out-Null
Copy-Item (Join-Path $stapel 'epic/references/*') (Join-Path $skill 'references')
Get-ChildItem (Join-Path $stapel 'epic/scripts') -Filter *.ps1 | Where-Object { $_.Name -notlike '*.Tests.ps1' } | Copy-Item -Destination (Join-Path $skill 'scripts')
$hook = '$CLAUDE_PROJECT_DIR/.claude/skills/epic-stapel/scripts/guard.ps1'
$text = [IO.File]::ReadAllText((Join-Path $stapel 'epic/SKILL.md'))
$text = $text -replace '(?m)^name: epic\r?$', 'name: epic-stapel' -replace [regex]::Escape('$HOME/.claude/skills/epic/scripts/guard.ps1'), $hook
[IO.File]::WriteAllText((Join-Path $skill 'SKILL.md'), $text)
$agenten = Join-Path $Probe '.claude/agents'
New-Item -ItemType Directory -Force $agenten | Out-Null
foreach ($a in Get-ChildItem (Join-Path $stapel 'agents') -Filter 'epic-*.md') {
    $t = [IO.File]::ReadAllText($a.FullName) -replace [regex]::Escape('$HOME/.claude/skills/epic/scripts/guard.ps1'), $hook
    [IO.File]::WriteAllText((Join-Path $agenten $a.Name), $t)
}

# adapter, gate and the base state of the areas
Copy-Item (Join-Path $hier 'epic.md') (Join-Path $Probe '.claude/epic.md')
New-Item -ItemType Directory -Force (Join-Path $Probe 'werkzeug') | Out-Null
Copy-Item (Join-Path $hier 'gate.ps1') (Join-Path $Probe 'werkzeug/gate.ps1')
foreach ($b in 'obst', 'verse', 'thema') {
    $ziel = Join-Path $Probe $b
    if (Test-Path $ziel) { Remove-Item $ziel -Recurse -Force }
    Copy-Item (Join-Path $hier "basis/$b") $ziel -Recurse
}
Invoke-ProbeGit add -A .claude werkzeug obst verse thema
git -C $Probe diff --cached --quiet
if ($LASTEXITCODE) {
    Invoke-ProbeGit commit -q -m "chore: Probe Epic-Programm, Ausgangsstand fuer $Lauf (agent-skills#69)"
    Invoke-ProbeGit push -q origin main
}

# issues
function Neues-Issue([string]$titel, [string]$body, [string[]]$labels) {
    $datei = New-TemporaryFile
    [IO.File]::WriteAllText($datei, (@{ title = $titel; body = $body; labels = $labels } | ConvertTo-Json -Compress))
    $nr = gh api "repos/$Forge/issues" --input $datei --jq .number
    Remove-Item $datei
    if ($LASTEXITCODE -or -not $nr) { throw "Issue '$titel' nicht angelegt" }
    [int]$nr
}

$ergebnis = [ordered]@{ lauf = $Lauf; basis = (git -C $Probe rev-parse --short=8 HEAD).Trim(); epics = [ordered]@{} }
foreach ($datei in Get-ChildItem $hier -Filter 'mini-epic-*.md' | Sort-Object Name) {
    $teile = [regex]::Split([IO.File]::ReadAllText($datei.FullName), '(?m)^=== ') | Where-Object { $_.Trim() }
    $kopf, $kinder = $teile[0], @($teile | Select-Object -Skip 1)
    $titel = ($kopf -split '\r?\n')[0] -replace '^epic:\s*', ''
    $epicBody = ($kopf -split '\r?\n', 2)[1]
    $nr = Neues-Issue "$titel ($Lauf)" ($epicBody -replace '\{\{kinder\}\}', '(folgt)') @('epic', 'ready-for-agent')
    $nummern = [ordered]@{ epic = $nr }
    foreach ($k in $kinder) {
        $erste = ($k -split '\r?\n')[0]
        if ($erste -notmatch '^kind (\w+):\s*(.+)$') { throw "Kopf unlesbar: $erste" }
        $schluessel, $ktitel = $Matches[1], $Matches[2]
        $body = ($k -split '\r?\n', 2)[1] -replace '\{\{epic\}\}', $nr
        foreach ($s in @($nummern.Keys)) { $body = $body -replace "\{\{$s\}\}", $nummern[$s] }
        $nummern[$schluessel] = Neues-Issue $ktitel $body @('ready-for-agent')
    }
    $liste = (@($nummern.Keys | Where-Object { $_ -ne 'epic' } | ForEach-Object { "#$($nummern[$_])" }) -join ', ')
    $datei2 = New-TemporaryFile
    [IO.File]::WriteAllText($datei2, (@{ body = ($epicBody -replace '\{\{kinder\}\}', $liste) } | ConvertTo-Json -Compress))
    gh api -X PATCH "repos/$Forge/issues/$nr" --input $datei2 --jq .number | Out-Null
    Remove-Item $datei2
    $ergebnis.epics[$datei.BaseName -replace '^mini-epic-', ''] = $nummern
}

# hidden rules and triggers of gate.ps1, outside the work tree (regeln.ps1)
$common = (git -C $Probe rev-parse --path-format=absolute --git-common-dir).Trim()
Copy-Item (Join-Path $hier 'regeln.ps1') (Join-Path $common 'probe-regeln.ps1')
Remove-Item (Join-Path $common 'probe-rot-paket.zaehler') -ErrorAction SilentlyContinue
Set-Content (Join-Path $common 'probe-rot-paket') "agent/$($ergebnis.epics.c.c1)-"
Set-Content (Join-Path $common 'probe-rot-epic') "epic/$($ergebnis.epics.b.epic)-"
$ergebnis | ConvertTo-Json -Depth 4 -Compress
