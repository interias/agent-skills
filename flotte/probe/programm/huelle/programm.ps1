<#
.SYNOPSIS
    The thin shell of the after probe (agent-skills#69, stage 4): runs `flotte epic` for one epic
    under the driver and hands its blocks to the session that called it (SKILL.md next to it).

.DESCRIPTION
    vorbereiten.ps1 -Motor programm copies this file to .claude/skills/epic-stapel/scripts/ and the
    path of flotte/src/cli.ts to <git common dir>/probe-programm.txt, outside the work tree.
    -Antwort '<line of the driver>'  appends `<nr>: <answer>` to <epic dir>/antworten.txt, the
                                     --antworten file of the program; a line that lies with the
                                     person is skipped. Nothing is started.
    without -Antwort                 starts the program unless it runs or is finished, then waits up
                                     to -WarteS seconds for the next block in <epic dir>/bloecke.txt
                                     and prints it word for word. Else one line: LAEUFT (no block
                                     yet), PROGRAMM BEENDET (ended without a new block) or
                                     PROGRAMM GESCHEITERT (ended too often without one).
    The program runs detached behind an intermediate process that ends at once: neither the end of
    a turn nor the time limit of the shell tool ends it. It keeps running between the turns and
    reads the answers from its file. A program that died without a block is started again, which
    continues its running calls with --resume (restart of flotte epic), at most three times.

.EXAMPLE
    pwsh -NoProfile -File .claude/skills/epic-stapel/scripts/programm.ps1 -Epic 82
#>
param(
    [Parameter(Mandatory)][int]$Epic,
    [string]$Antwort,
    [int]$WarteS = 500,
    # internal: the intermediate process that starts the program and ends
    [switch]$Intern
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$utf8 = [Text.UTF8Encoding]::new($false)
$repo = (git rev-parse --show-toplevel).Trim()
$common = (git rev-parse --path-format=absolute --git-common-dir).Trim()
$dir = Join-Path $common "flotte/epics/$Epic"
New-Item -ItemType Directory -Force $dir | Out-Null
$antworten = Join-Path $dir 'antworten.txt'
$bloecke = Join-Path $dir 'bloecke.txt'
$gelesen = Join-Path $dir 'huelle-gelesen.txt'
$starts = Join-Path $dir 'huelle-starts.txt'

if ($Intern) {
    $cli = (Get-Content (Join-Path $common 'probe-programm.txt') -Raw).Trim()
    $konto = $env:CLAUDE_CONFIG_DIR
    if (-not $konto) { throw 'CLAUDE_CONFIG_DIR fehlt: das Konto des Laufs ist unbekannt' }
    $n = @(Get-Content $starts -ErrorAction SilentlyContinue).Count
    $argumente = @($cli, 'epic', $Epic, $repo, '--mechanik', 'echt', '--aufrufe', 'echt', '--konto', $konto, '--branch', "epic/$Epic-programm", '--basis', 'origin/main', '--antworten', $antworten, '--max-min', '120') | ForEach-Object { '"{0}"' -f $_ }
    # bun.exe: a bun.ps1 next to it (npm) would win as bun and is no program to start
    $bun = (Get-Command bun.exe -CommandType Application | Select-Object -First 1).Source
    Start-Process $bun -ArgumentList ($argumente -join ' ') -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dir "programm-$n.out") -RedirectStandardError (Join-Path $dir "programm-$n.err") | Out-Null
    exit 0
}

if ($Antwort) {
    if ($Antwort -notmatch '^\s*(\d+)\s*[.:)]\s*(.+?)\s*$') { Write-Output "keine Antwortzeile: $Antwort"; exit 0 }
    $nr, $text = $Matches[1], $Matches[2]
    if ($text -match '^liegt beim Menschen') { Write-Output "Frage $nr liegt beim Menschen: nichts notiert"; exit 0 }
    $text = $text -replace '^Antwort:\s*', '' -replace '\s+[^\w\s]{1,3}\s+Herkunft:.*$', '' -replace '\s+Herkunft:.*$', ''
    [IO.File]::AppendAllText($antworten, "${nr}: $text`n", $utf8)
    Write-Output "notiert: ${nr}: $text"
    exit 0
}

function Get-ProgrammPid {
    $lock = Join-Path $dir 'treiber.lock'
    if (-not (Test-Path $lock)) { return $null }
    try { $p = [int](Get-Content $lock -Raw | ConvertFrom-Json).pid } catch { return $null }
    $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'bun') { $p } else { $null }
}

function Get-Zustand {
    $datei = Join-Path $dir 'zustand.json'
    if (-not (Test-Path $datei)) { return $null }
    try { Get-Content $datei -Raw | ConvertFrom-Json } catch { $null }
}

# the next block after what the session got already; blocks are appended whole, with a blank line after
function Get-NeuerBlock {
    if (-not (Test-Path $bloecke)) { return $null }
    $ab = if (Test-Path $gelesen) { [long](Get-Content $gelesen -Raw) } else { 0 }
    $bytes = [IO.File]::ReadAllBytes($bloecke)
    if ($bytes.Length -le $ab) { return $null }
    $text = $utf8.GetString($bytes, $ab, $bytes.Length - $ab)
    $koepfe = [regex]::Matches($text, '(?m)^FLOTTE-(FRAGE|ENDE) ')
    if (-not $koepfe.Count) { return $null }
    $bis = if ($koepfe.Count -gt 1) { $koepfe[1].Index } else { $text.Length }
    Set-Content $gelesen ($ab + $utf8.GetByteCount($text.Substring(0, $bis))) -NoNewline
    $text.Substring($koepfe[0].Index, $bis - $koepfe[0].Index).Trim()
}

function Start-Programm {
    Add-Content $starts (Get-Date).ToUniversalTime().ToString('o')
    Start-Process pwsh -ArgumentList "-NoProfile -File `"$PSCommandPath`" -Epic $Epic -Intern" -WorkingDirectory $repo -WindowStyle Hidden | Out-Null
    # the program takes its lock first thing
    for ($i = 0; $i -lt 60 -and -not (Get-ProgrammPid); $i++) { Start-Sleep 1 }
}

$ende = (Get-Date).AddSeconds($WarteS)
for (;;) {
    $block = Get-NeuerBlock
    if ($block) { Write-Output $block; exit 0 }
    if (-not (Get-ProgrammPid)) {
        $z = Get-Zustand
        if ($z -and $z.phase -in 'fertig', 'abgebrochen') { Write-Output "PROGRAMM BEENDET: Epic $Epic ist $($z.phase), kein neuer Block."; exit 0 }
        if (@(Get-Content $starts -ErrorAction SilentlyContinue).Count -ge 4) {
            $err = Get-ChildItem $dir -Filter 'programm-*.err' | Sort-Object LastWriteTime | Select-Object -Last 1
            Write-Output "PROGRAMM GESCHEITERT: flotte epic $Epic endete viermal ohne Block. Letzte Fehlerausgabe:"
            if ($err) { Get-Content $err.FullName -Tail 15 }
            exit 0
        }
        Start-Programm
        continue
    }
    if ((Get-Date) -gt $ende) {
        $z = Get-Zustand
        $letztes = if ($z -and $z.ereignisse) { $z.ereignisse[-1].text } else { '-' }
        Write-Output "LAEUFT: flotte epic $Epic, Phase $($z.phase), zuletzt: $letztes"
        exit 0
    }
    Start-Sleep 2
}
