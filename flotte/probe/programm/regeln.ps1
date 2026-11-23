# Hidden rules and triggers of the before/after probe (agent-skills#69). vorbereiten.ps1 copies this
# file to <git common dir>/probe-regeln.ps1, outside the work tree: a run that reads gate.ps1 cannot
# plan around them (preliminary run 21.11.2026: the runs read the rules in gate.ps1, serialised the
# packages and took the triggers for load flakes). gate.ps1 dot-sources it; $common, $branch and
# $dateien come from there.
#   obst/   every .txt file is listed as a line "- <name>" in obst/REGISTER.md
#           (parallel packages insert at the same place: a mechanical conflict, P14)
#   thema/  a branch that changes thema/ raises "version: <n>" in thema/STAND.md above origin/main
#           and says why in "grund: <text>" (parallel packages write different reasons: P15)
# Triggers, written by vorbereiten.ps1:
#   probe-rot-paket  a branch prefix (agent/<nr>-): from the second gate run on that branch, thema
#                    is red until thema/KONTRAST.md has the line "- nacht" (a red test in the
#                    package that only a new round fixes, P10)
#   probe-rot-epic   a branch prefix (epic/<nr>-): the first HEAD on that branch that merges a
#                    package branch makes verse red, on every run at that HEAD (P13)

function Test-ProbeRegel([string]$bereich) {
    if ($bereich -eq 'obst') {
        $register = if (Test-Path 'obst/REGISTER.md') { @(Get-Content 'obst/REGISTER.md') } else { @() }
        foreach ($f in @(Get-ChildItem 'obst' -Filter *.txt -File -ErrorAction SilentlyContinue)) {
            if ("- $($f.Name)" -notin $register) { return "obst/$($f.Name) fehlt in obst/REGISTER.md (Zeile '- $($f.Name)')" }
        }
    }
    if ($bereich -eq 'thema') {
        if ($dateien | Where-Object { $_ -like 'thema/*' }) {
            $jetzt = if (Test-Path 'thema/STAND.md') { Get-Content 'thema/STAND.md' -Raw } else { '' }
            $vorher = (git show origin/main:thema/STAND.md 2>$null) -join "`n"
            $v = if ($jetzt -match 'version:\s*(\d+)') { [int]$Matches[1] } else { -1 }
            $alt = if ($vorher -match 'version:\s*(\d+)') { [int]$Matches[1] } else { 0 }
            if ($v -le $alt) { return "thema/STAND.md: version muss gr$([char]0xF6)$([char]0xDF)er als $alt sein (origin/main), steht $v" }
            if ($jetzt -notmatch 'grund:\s*\S') { return 'thema/STAND.md: Zeile "grund: <text>" fehlt' }
        }
        $paket = Join-Path $common 'probe-rot-paket'
        if ((Test-Path $paket) -and $branch.StartsWith((Get-Content $paket -Raw).Trim())) {
            $zaehler = Join-Path $common 'probe-rot-paket.zaehler'
            $n = 1 + [int]$(if (Test-Path $zaehler) { Get-Content $zaehler -Raw } else { 0 })
            Set-Content $zaehler $n
            $kontrast = if (Test-Path 'thema/KONTRAST.md') { @(Get-Content 'thema/KONTRAST.md') } else { @() }
            if ($n -ge 2 -and '- nacht' -notin $kontrast) { return "thema/KONTRAST.md fehlt oder nennt das dunkle Thema nicht (Zeile '- nacht')" }
        }
    }
    if ($bereich -eq 'verse') {
        $epic = Join-Path $common 'probe-rot-epic'
        if (Test-Path $epic) {
            $teile = @((Get-Content $epic -Raw).Trim() -split '\s+')
            $kopf = (git rev-parse HEAD).Trim()
            if ($branch.StartsWith($teile[0])) {
                if ($teile.Count -eq 1) {
                    $eltern = @((git rev-list --parents -n 1 HEAD).Trim() -split ' ')
                    if ($eltern.Count -eq 3 -and @(git branch --list 'agent/*' --contains $eltern[2]).Count) {
                        Set-Content $epic "$($teile[0]) $kopf"
                        $teile += $kopf
                    }
                }
                if ($teile.Count -ge 2 -and $teile[1] -eq $kopf) { return 'verse: nach dem Andocken des Pakets bricht die Pruefung der Verse (Probe-Befund, bleibt bis zum Revert)' }
            }
        }
    }
    $null
}
