# Merges a pull request with a merge commit when the adapter allows it, then deletes its head branch on
# the remote only when the pull request is MERGED and the base branch provably contains every commit of
# it. Prints one summary line.
# Who merges is the adapter key `merge` in .claude/epic.md of the base branch (epic/references/adapter.md,
# "Merge"): only `nach_gate` lets this script merge; `mensch` or a missing key refuses. With checks it
# waits for them; a repo that reports no check for -LeerMinuten has none, and then the gate block in the
# pull request description must be there, green, run against the current base on the current head, and
# the head must contain the current base.
# Usage: merge.ps1 -Repo <owner/name> -Pr 164 [-MaxMinuten 30] [-BranchBehalten]
# -GhCommand, -LeerMinuten and -TaktSekunden exist for the tests (merge.Tests.ps1).
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][int]$Pr,
    [int]$MaxMinuten = 30,
    [switch]$BranchBehalten,
    [string]$GhCommand = 'gh',
    [double]$LeerMinuten = 2,
    [int]$TaktSekunden = 20
)

$ghExe = if ($GhCommand -eq 'gh') { (Get-Command gh -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source } else { $GhCommand }
function gh { & $ghExe @args }

# Flat `key: value` entries of the YAML frontmatter; quotes around a value are removed, an
# unquoted value loses a trailing ` # comment`.
function Read-Frontmatter([string]$text) {
    $values = @{}
    $lines = $text -split "`r?`n"
    if (-not $lines.Count -or $lines[0].Trim() -ne '---') { return $values }
    for ($k = 1; $k -lt $lines.Count -and $lines[$k].Trim() -ne '---'; $k++) {
        if ($lines[$k] -notmatch '^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$') { continue }
        $key = $Matches[1]; $value = $Matches[2].Trim()
        if ($value -match "^'([^']*)'" -or $value -match '^"([^"]*)"') { $value = $Matches[1] }
        else { $value = ($value -replace '\s+#.*$', '').Trim() }
        $values[$key] = $value
    }
    $values
}

# The reason why the gate block does not allow the merge, or $null.
function Test-GateBlock([string]$body, $settings, [string]$baseSha, [string]$headSha) {
    $lines = @($body -split "`r?`n")
    $start = -1
    for ($k = 0; $k -lt $lines.Count; $k++) { if ($lines[$k].Trim() -eq $settings.Heading) { $start = $k; break } }
    if ($start -lt 0) { return "kein Abschnitt '$($settings.Heading)' in der Beschreibung" }
    $level = ($settings.Heading -replace '^(#+).*$', '$1').Length
    $section = New-Object Collections.ArrayList
    for ($k = $start + 1; $k -lt $lines.Count; $k++) {
        if ($lines[$k] -match '^(#+)\s' -and $Matches[1].Length -le $level) { break }
        [void]$section.Add($lines[$k])
    }
    $last = -1
    for ($k = 0; $k -lt $section.Count; $k++) { if ($section[$k] -match $settings.Base) { $last = $k } }
    if ($last -lt 0) { return 'kein Gate-Lauf mit Basis im Abschnitt' }
    $gateBase = ([regex]::Match($section[$last], $settings.Base)).Groups[1].Value
    $headMatch = [regex]::Match($section[$last], $settings.Head)
    if (-not $headMatch.Success) { return 'der letzte Gate-Lauf nennt keinen HEAD' }
    $gateHead = $headMatch.Groups[1].Value
    $green = $false
    for ($k = $last + 1; $k -lt $section.Count; $k++) { if ($section[$k].Trim() -eq $settings.Green) { $green = $true; break } }
    if (-not $green) { return "der letzte Gate-Lauf endet nicht mit '$($settings.Green)'" }
    if (-not $baseSha.StartsWith($gateBase, [StringComparison]::OrdinalIgnoreCase)) { return "Gate lief gegen $gateBase, die Basis steht auf $($baseSha.Substring(0, 7))" }
    if (-not $headSha.StartsWith($gateHead, [StringComparison]::OrdinalIgnoreCase)) { return "Gate lief auf $gateHead, der Pull Request steht auf $($headSha.Substring(0, 8))" }
    $null
}

$info = gh pr view $Pr --repo $Repo --json 'state,headRefName,baseRefName,headRefOid,isDraft,body' | ConvertFrom-Json
if (-not $info) { "NICHT GEMERGT #${Pr}: Pull Request nicht lesbar"; exit 1 }
if ($info.state -ne 'OPEN') { "NICHT GEMERGT #${Pr}: Zustand $($info.state)"; exit 1 }
if ($info.isDraft) { "NICHT GEMERGT #${Pr}: Entwurf"; exit 1 }

$adapterText = ''
$encoded = gh api "repos/$Repo/contents/.claude/epic.md?ref=$($info.baseRefName)" --jq .content 2>$null
if (-not $LASTEXITCODE -and $encoded) { $adapterText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((($encoded -join '') -replace '\s', ''))) }
$adapter = Read-Frontmatter $adapterText
$merge = if ($adapter['merge']) { $adapter['merge'] } else { 'mensch' }
if ($merge -ne 'nach_gate') { "NICHT GEMERGT #${Pr}: merge: $merge (Adapter .claude/epic.md auf $($info.baseRefName)), ein Mensch mergt"; exit 1 }

# Checks need a moment to register after a push; a repo without CI never reports any
$ende = (Get-Date).AddMinutes($MaxMinuten); $leerSeit = Get-Date; $ohneChecks = $false
while ($true) {
    $checks = @(gh pr checks $Pr --repo $Repo --json 'name,bucket' 2>$null | ConvertFrom-Json)
    if ($checks.Count -eq 0) {
        if (((Get-Date) - $leerSeit).TotalMinutes -ge $LeerMinuten) { $ohneChecks = $true; break }
    } else {
        $rot = @($checks | Where-Object bucket -in 'fail', 'cancel')
        if ($rot) { "CHECKS ROT #${Pr}: $(($rot | ForEach-Object name) -join ', ')"; exit 1 }
        if (-not ($checks | Where-Object bucket -eq 'pending')) { break }
    }
    if ((Get-Date) -gt $ende) { "ZEIT UM #${Pr}: Checks nach $MaxMinuten min noch offen"; exit 1 }
    Start-Sleep $TaktSekunden
}

if ($ohneChecks) {
    $settings = @{
        Heading = if ($adapter['gate_heading']) { $adapter['gate_heading'] } else { '## Gate' }
        Green   = if ($adapter['gate_green']) { $adapter['gate_green'] } else { "Gate gr$([char]0x00FC)n." }
        Base    = if ($adapter['gate_base']) { $adapter['gate_base'] } else { 'Basis \S+ @ ([0-9a-f]{7,40})' }
        Head    = if ($adapter['gate_head']) { $adapter['gate_head'] } else { '\(HEAD ([0-9a-f]{7,40})\)' }
    }
    $baseSha = gh api "repos/$Repo/commits/$($info.baseRefName)" --jq .sha 2>$null
    if ($LASTEXITCODE -or -not $baseSha) { "GATE UNGEPRUEFT #${Pr}: Basis $($info.baseRefName) nicht lesbar"; exit 1 }
    $grund = Test-GateBlock $info.body $settings ([string]$baseSha).Trim() $info.headRefOid
    if ($grund) { "GATE FEHLT #${Pr}: $grund"; exit 1 }
    $hinter = gh api "repos/$Repo/compare/$($info.baseRefName)...$($info.headRefOid)" --jq .behind_by 2>$null
    if ($LASTEXITCODE -or "$hinter".Trim() -ne '0') { "GATE FEHLT #${Pr}: der Head enthaelt die aktuelle Basis nicht ($("$hinter".Trim()) Commits dahinter)"; exit 1 }
}

$info = gh pr view $Pr --repo $Repo --json mergeable | ConvertFrom-Json
if ($info.mergeable -eq 'CONFLICTING') { "KONFLIKT #${Pr}: nicht mergebar"; exit 1 }
gh pr merge $Pr --repo $Repo --merge | Out-Null
if ($LASTEXITCODE) { "MERGE FEHLGESCHLAGEN #$Pr"; exit 1 }

$info = gh pr view $Pr --repo $Repo --json 'state,headRefName,baseRefName,closingIssuesReferences' | ConvertFrom-Json
if ($info.state -ne 'MERGED') { "MERGE UNKLAR #${Pr}: Zustand $($info.state), Branch $($info.headRefName) bleibt"; exit 1 }
$zeile = "GEMERGT #$Pr -> $($info.baseRefName)"
$issues = @($info.closingIssuesReferences | ForEach-Object { "#$($_.number)" })
if ($issues) {
    $zu = @($info.closingIssuesReferences | Where-Object { (gh issue view $_.number --repo $Repo --json state -q .state) -eq 'CLOSED' } | ForEach-Object { "#$($_.number)" })
    $zeile += "; Issues zu: $($zu -join ' ')"
    $offen = @($issues | Where-Object { $_ -notin $zu })
    if ($offen) { $zeile += "; NOCH OFFEN: $($offen -join ' ')" }
}
if (-not $BranchBehalten) {
    $voraus = gh api "repos/$Repo/compare/$($info.baseRefName)...$($info.headRefName)" --jq .ahead_by 2>$null
    if ($voraus -eq '0') {
        gh api -X DELETE "repos/$Repo/git/refs/heads/$($info.headRefName)" 2>$null | Out-Null
        $zeile += if ($LASTEXITCODE) { "; Branch $($info.headRefName) nicht geloescht" } else { "; Branch $($info.headRefName) geloescht" }
    } else {
        $zeile += "; Branch $($info.headRefName) behalten ($voraus Commits nicht in $($info.baseRefName))"
    }
}
$zeile
