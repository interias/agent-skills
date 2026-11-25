# Merges a pull request with a merge commit when the adapter allows it, then deletes its head branch on
# the remote only when the pull request is MERGED and the base branch provably contains every commit of
# it. Prints one summary line.
# Who merges is the adapter key `merge` in .claude/epic.md of the base branch (mission/references/adapter.md,
# "Andocken"): only `nach_gate` lets this script merge; `mensch` or a missing key refuses. With checks it
# waits for them, and a red one refuses; a repo that reports no check for -LeerMinuten has none (without
# a workflow and without checks on the base it does not wait at all). Checks or not, the gate block in
# the pull request description must be there, green, run against the current base on the current head,
# and the head must contain the current base: a check of something else (a website build) never stands
# in for the gate (acceptance 3, #14). The last run counts as it stands; there is no partial run.
# Usage: merge.ps1 -Repo <owner/name> -Pr 164 [-MaxMinuten 30] [-BranchBehalten] [-Api <host>/api/v1/repos/<owner>/<repo>]
# With -Api the forge is Gitea (#127): every call goes through curl against its API; the Authorization header
# comes from the variable FLOTTE_FORGE_KOPF (the driver sets it for this process), else `token $GITEA_TOKEN`.
# Gitea knows no checks but commit statuses.
# -GhCommand, -CurlCommand, -LeerMinuten and -TaktSekunden exist for the tests (merge.Tests.ps1).
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][int]$Pr,
    [int]$MaxMinuten = 30,
    [switch]$BranchBehalten,
    [string]$Api = '',
    [string]$GhCommand = 'gh',
    [string]$CurlCommand = 'curl',
    [double]$LeerMinuten = 2,
    [int]$TaktSekunden = 20
)

$gitea = [bool]$Api
if (-not $gitea) {
    $ghExe = if ($GhCommand -eq 'gh') { (Get-Command gh -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source } else { $GhCommand }
}
function gh { & $ghExe @args }
# gh writes UTF-8; with the console code page (ibm850 here) 'Gate grün.' in a PR body never matched
# (dress rehearsal #14, 19.11.2026).
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

# One call of the Gitea API: the request goes to curl as a config on stdin, so the token never shows in a
# process list. Returns @{ Status; Json }; Status 0 when the server was not reached.
function Invoke-Gitea([string]$method, [string]$path, $body = $null) {
    $kopf = if ($env:FLOTTE_FORGE_KOPF) { $env:FLOTTE_FORGE_KOPF } else { "token $env:GITEA_TOKEN" }
    $q = { param($v) '"' + ($v -replace '\\', '\\' -replace '"', '\"' -replace "`r", '\r' -replace "`n", '\n' -replace "`t", '\t') + '"' }
    $lines = @("url = $(& $q ($Api.TrimEnd('/') + $path))", "request = $(& $q $method)", "header = $(& $q "Authorization: $kopf")", "header = $(& $q 'Accept: application/json')")
    if ($null -ne $body) { $lines += "header = $(& $q 'Content-Type: application/json')", "data-binary = $(& $q (ConvertTo-Json -Compress -Depth 5 -InputObject $body))" }
    $out = @(($lines -join "`n") | & $CurlCommand -sS --config - -w '\n%{http_code}' 2>$null)
    $status = 0
    if (-not $LASTEXITCODE -and $out.Count -and [int]::TryParse("$($out[-1])".Trim(), [ref]$status)) {
        $text = (@($out | Select-Object -SkipLast 1) -join "`n").Trim()
        $json = if ($text) { try { $text | ConvertFrom-Json } catch { $null } } else { $null }
        return @{ Status = $status; Json = $json }
    }
    @{ Status = 0; Json = $null }
}
function Test-Ok($r) { $r.Status -ge 200 -and $r.Status -le 299 }

# Flat `key: value` entries of the YAML frontmatter; quotes around a value are removed, an
# unquoted value loses a trailing ` # comment`. A key without a value followed by `  - item` lines
# is a list.
function Read-Frontmatter([string]$text) {
    $values = @{}
    $lines = $text -split "`r?`n"
    if (-not $lines.Count -or $lines[0].Trim() -ne '---') { return $values }
    $list = $null
    for ($k = 1; $k -lt $lines.Count -and $lines[$k].Trim() -ne '---'; $k++) {
        if ($list -and $lines[$k] -match '^\s+-\s+(.*)$') {
            $item = $Matches[1].Trim()
            if ($item -match "^'([^']*)'$" -or $item -match '^"([^"]*)"$') { $item = $Matches[1] } else { $item = ($item -replace '\s+#.*$', '').Trim() }
            $values[$list] = @($values[$list]) + $item
            continue
        }
        $list = $null
        if ($lines[$k] -notmatch '^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$') { continue }
        $key = $Matches[1]; $value = $Matches[2].Trim()
        if ($value -match "^'([^']*)'" -or $value -match '^"([^"]*)"') { $value = $Matches[1] }
        else { $value = ($value -replace '\s+#.*$', '').Trim() }
        if (-not $value) { $list = $key; $values[$key] = @(); continue }
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
    # every line with a base starts a run; a run is green when gate_green follows before the next run
    $runs = New-Object Collections.ArrayList
    for ($k = 0; $k -lt $section.Count; $k++) { if ($section[$k] -match $settings.Base) { [void]$runs.Add($k) } }
    if (-not $runs.Count) { return 'kein Gate-Lauf mit Basis im Abschnitt' }
    $run = {
        param([int]$i)
        $at = $runs[$i]; $until = if ($i + 1 -lt $runs.Count) { $runs[$i + 1] } else { $section.Count }
        $h = [regex]::Match($section[$at], $settings.Head)
        $g = $false
        for ($k = $at + 1; $k -lt $until; $k++) { if ($section[$k].Trim() -eq $settings.Green) { $g = $true; break } }
        @{ Base = ([regex]::Match($section[$at], $settings.Base)).Groups[1].Value; Head = $(if ($h.Success) { $h.Groups[1].Value } else { $null }); Green = $g }
    }
    $last = & $run ($runs.Count - 1)
    if (-not $last.Head) { return 'der letzte Gate-Lauf nennt keinen HEAD' }
    if (-not $last.Green) { return "der letzte Gate-Lauf endet nicht mit '$($settings.Green)'" }
    if (-not $baseSha.StartsWith($last.Base, [StringComparison]::OrdinalIgnoreCase)) { return "Gate lief gegen $($last.Base), die Basis steht auf $($baseSha.Substring(0, 7))" }
    if (-not $headSha.StartsWith($last.Head, [StringComparison]::OrdinalIgnoreCase)) { return "Gate lief auf $($last.Head), der Pull Request steht auf $($headSha.Substring(0, 8))" }
    $null
}

# The forge, once per question: gh for GitHub, the API for Gitea (-Api).
function Get-PrInfo([string]$fields) {
    if (-not $gitea) { return (gh pr view $Pr --repo $Repo --json $fields | ConvertFrom-Json) }
    $r = Invoke-Gitea GET "/pulls/$Pr"
    if (-not (Test-Ok $r)) { return $null }
    $p = $r.Json
    [pscustomobject]@{
        state = if ($p.merged) { 'MERGED' } elseif ($p.state -eq 'open') { 'OPEN' } else { 'CLOSED' }
        headRefName = $p.head.ref; baseRefName = $p.base.ref; headRefOid = $p.head.sha; body = "$($p.body)"
        # a title with WIP: makes a Gitea pull request a draft (forge.md)
        isDraft = [bool]$p.draft -or "$($p.title)" -match '^\s*WIP:'
        mergeable = if ($p.mergeable -eq $false) { 'CONFLICTING' } else { 'MERGEABLE' }
    }
}
function Get-DefaultBranch {
    if (-not $gitea) { $n = gh api "repos/$Repo" --jq .default_branch 2>$null; return $(if ($LASTEXITCODE) { '' } else { "$n".Trim() }) }
    $r = Invoke-Gitea GET ''
    if (Test-Ok $r) { "$($r.Json.default_branch)".Trim() } else { '' }
}
# the content of a file on a branch, base64 as the forge sends it; '' when it is missing
function Get-FileBase64([string]$path, [string]$ref) {
    if (-not $gitea) {
        $encoded = gh api "repos/$Repo/contents/$($path)?ref=$ref" --jq .content 2>$null
        return $(if ($LASTEXITCODE) { '' } else { "$($encoded -join '')" })
    }
    $r = Invoke-Gitea GET "/contents/$($path)?ref=$([uri]::EscapeDataString($ref))"
    if (Test-Ok $r) { "$($r.Json.content)" } else { '' }
}
# checks as @{ name; bucket } (pass, fail, cancel, pending); on Gitea the commit statuses of the head
function Get-Checks([string]$headSha) {
    if (-not $gitea) { return @(gh pr checks $Pr --repo $Repo --json 'name,bucket' 2>$null | ConvertFrom-Json) }
    $r = Invoke-Gitea GET "/commits/$headSha/status"
    if (-not (Test-Ok $r)) { return @(@{ name = 'Status nicht lesbar'; bucket = 'pending' }) }
    # a head without any status sends statuses null, which a pipeline would turn into one empty entry
    @($r.Json.statuses | Where-Object { $_ } | ForEach-Object {
        @{ name = $_.context; bucket = switch ("$($_.status)") { 'success' { 'pass' } 'warning' { 'pass' } 'pending' { 'pending' } default { 'fail' } } } })
}
function Get-BranchSha([string]$branch) {
    if (-not $gitea) { $n = gh api "repos/$Repo/commits/$branch" --jq .sha 2>$null; return $(if ($LASTEXITCODE) { '' } else { "$n".Trim() }) }
    $r = Invoke-Gitea GET "/branches/$([uri]::EscapeDataString($branch))"
    if (Test-Ok $r) { "$($r.Json.commit.id)" } else { '' }
}
# commits of $head that $base lacks, as text; '' when unreadable
function Get-Ahead([string]$base, [string]$head) {
    if (-not $gitea) { $n = gh api "repos/$Repo/compare/$base...$head" --jq .ahead_by 2>$null; return $(if ($LASTEXITCODE) { '' } else { "$n".Trim() }) }
    $r = Invoke-Gitea GET "/compare/$([uri]::EscapeDataString($base))...$([uri]::EscapeDataString($head))"
    if (Test-Ok $r) { "$($r.Json.total_commits)" } else { '' }
}
# commits of $base that $head lacks
function Get-Behind([string]$base, [string]$head) {
    if (-not $gitea) { $n = gh api "repos/$Repo/compare/$base...$head" --jq .behind_by 2>$null; return $(if ($LASTEXITCODE) { '' } else { "$n".Trim() }) }
    Get-Ahead $head $base
}

$info = Get-PrInfo 'state,headRefName,baseRefName,headRefOid,isDraft,body'
if (-not $info) { "NICHT GEMERGT #${Pr}: Pull Request nicht lesbar"; exit 1 }
if ($info.state -ne 'OPEN') { "NICHT GEMERGT #${Pr}: Zustand $($info.state)"; exit 1 }
if ($info.isDraft) { "NICHT GEMERGT #${Pr}: Entwurf"; exit 1 }

# The adapter comes from the default branch, not from the base of the pull request: a branch of its own
# never decides that it may be merged into (follow-up check of #27 at #14).
$standard = Get-DefaultBranch
if (-not $standard) { "NICHT GEMERGT #${Pr}: Standardzweig von $Repo nicht lesbar"; exit 1 }
$adapterText = ''
$encoded = Get-FileBase64 '.claude/epic.md' $standard
if ($encoded) { $adapterText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($encoded -replace '\s', ''))) }
$adapter = Read-Frontmatter $adapterText
$merge = if ($adapter['merge']) { $adapter['merge'] } else { 'mensch' }
if ($merge -ne 'nach_gate') { "NICHT GEMERGT #${Pr}: merge: $merge (Adapter .claude/epic.md auf $standard), ein Mensch mergt"; exit 1 }
# the expected base: base_branch of the adapter, else main_branch, else the default branch; from-issue
# names a base per epic that this script cannot read, so a person merges
$basis = @($adapter['base_branch'], $adapter['main_branch'], $standard) | Where-Object { $_ } | Select-Object -First 1
if ($basis -eq 'from-issue') { "NICHT GEMERGT #${Pr}: base_branch: from-issue, die erwartete Basis ist nicht lesbar; ein Mensch mergt"; exit 1 }
if ($info.baseRefName -ne $basis) { "NICHT GEMERGT #${Pr}: Basis $($info.baseRefName), erwartet $basis; ein Mensch mergt"; exit 1 }

# A repo without CI: no workflow, and the tip of the base has neither a check run nor a commit status.
# Then no check will come and nothing is waited for (#14, C2). Anything unreadable counts as CI.
function Test-OhneCi([string]$base) {
    if ($gitea) { $r = Invoke-Gitea GET "/commits/$([uri]::EscapeDataString($base))/status"; return ((Test-Ok $r) -and [int]$r.Json.total_count -eq 0) }
    foreach ($q in @("repos/$Repo/actions/workflows", "repos/$Repo/commits/$base/check-runs", "repos/$Repo/commits/$base/status")) {
        $n = gh api $q --jq .total_count 2>$null
        if ($LASTEXITCODE -or "$n".Trim() -ne '0') { return $false }
    }
    $true
}
if (Test-OhneCi $info.baseRefName) { $LeerMinuten = 0 }

# Checks need a moment to register after a push; a repo without CI never reports any
$ende = (Get-Date).AddMinutes($MaxMinuten); $leerSeit = Get-Date
while ($true) {
    $checks = @(Get-Checks $info.headRefOid)
    if ($checks.Count -eq 0) {
        if (((Get-Date) - $leerSeit).TotalMinutes -ge $LeerMinuten) { break }
    } else {
        $rot = @($checks | Where-Object bucket -in 'fail', 'cancel')
        if ($rot) { "CHECKS ROT #${Pr}: $(($rot | ForEach-Object name) -join ', ')"; exit 1 }
        if (-not ($checks | Where-Object bucket -eq 'pending')) { break }
    }
    if ((Get-Date) -gt $ende) { "ZEIT UM #${Pr}: Checks nach $MaxMinuten min noch offen"; exit 1 }
    Start-Sleep $TaktSekunden
}

# green checks are not the gate: the gate block decides, with checks or without (acceptance 3, #14)
$settings = @{
    Heading = if ($adapter['gate_heading']) { $adapter['gate_heading'] } else { '## Gate' }
    Green   = if ($adapter['gate_green']) { $adapter['gate_green'] } else { "Gate gr$([char]0x00FC)n." }
    Base    = if ($adapter['gate_base']) { $adapter['gate_base'] } else { 'Basis \S+ @ ([0-9a-f]{7,40})' }
    Head    = if ($adapter['gate_head']) { $adapter['gate_head'] } else { '\(HEAD ([0-9a-f]{7,40})\)' }
}
$baseSha = Get-BranchSha $info.baseRefName
if (-not $baseSha) { "GATE UNGEPRUEFT #${Pr}: Basis $($info.baseRefName) nicht lesbar"; exit 1 }
# an error inside the check never lets the merge through
try { $grund = Test-GateBlock $info.body $settings ([string]$baseSha).Trim() $info.headRefOid }
catch { $grund = "Pruefung gescheitert: $($_.Exception.Message)" }
if ($grund) { "GATE FEHLT #${Pr}: $grund"; exit 1 }
$hinter = Get-Behind $info.baseRefName $info.headRefOid
if ("$hinter".Trim() -ne '0') { "GATE FEHLT #${Pr}: der Head enthaelt die aktuelle Basis nicht ($("$hinter".Trim()) Commits dahinter)"; exit 1 }

$head = $info.headRefOid
$info = Get-PrInfo mergeable
# Gitea says not mergeable also while it checks after a push to the base: a conflict only when a second read says so
if ($gitea -and $info.mergeable -eq 'CONFLICTING') { Start-Sleep ([math]::Min(5, $TaktSekunden)); $info = Get-PrInfo mergeable }
if ($info.mergeable -eq 'CONFLICTING') { "KONFLIKT #${Pr}: nicht mergebar"; exit 1 }
# only the head that was checked: a push between the check and the merge makes the forge refuse
if ($gitea) {
    $r = Invoke-Gitea POST "/pulls/$Pr/merge" @{ Do = 'merge'; head_commit_id = $head }
    $ok = Test-Ok $r
    $grund = if ($r.Status -eq 0) { 'Server nicht erreicht' } else { "Status $($r.Status): $($r.Json.message)" }
} else {
    $grund = @(gh pr merge $Pr --repo $Repo --merge --match-head-commit $head 2>&1 | ForEach-Object { "$_" }) -join ' '
    $ok = -not $LASTEXITCODE
}
# the reason of the forge on the same line (#229): the driver sorts it into passing, conflict or lasting
if (-not $ok) {
    $grund = ($grund -replace '\s+', ' ').Trim().TrimEnd(':').Trim()
    if (-not $grund) { $grund = 'keine Ausgabe der Forge' }
    if ($grund.Length -gt 300) { $grund = $grund.Substring(0, 297) + '...' }
    "MERGE FEHLGESCHLAGEN #${Pr}: $grund"; exit 1
}

$info = Get-PrInfo 'state,headRefName,baseRefName,closingIssuesReferences'
if ($info.state -ne 'MERGED') { "MERGE UNKLAR #${Pr}: Zustand $($info.state), Branch $($info.headRefName) bleibt"; exit 1 }
$zeile = "GEMERGT #$Pr -> $($info.baseRefName)"
# Gitea lists no closing issues: the English closing words of the description, the only ones it acts on (forge.md)
$schliesst = if ($gitea) { @([regex]::Matches("$($info.body)", '(?im)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)') | ForEach-Object { [int]$_.Groups[1].Value } | Select-Object -Unique) }
             else { @($info.closingIssuesReferences | ForEach-Object { $_.number }) }
function Get-IssueState([int]$n) {
    if (-not $gitea) { return (gh issue view $n --repo $Repo --json state -q .state) }
    $r = Invoke-Gitea GET "/issues/$n"
    if ((Test-Ok $r) -and $r.Json.state -eq 'closed') { 'CLOSED' } else { 'OPEN' }
}
$issues = @($schliesst | ForEach-Object { "#$_" })
if ($issues) {
    $zu = @($schliesst | Where-Object { (Get-IssueState $_) -eq 'CLOSED' } | ForEach-Object { "#$_" })
    $zeile += "; Issues zu: $($zu -join ' ')"
    $offen = @($issues | Where-Object { $_ -notin $zu })
    if ($offen) { $zeile += "; NOCH OFFEN: $($offen -join ' ')" }
}
# true only when the forge says the branch does not exist (404): it deleted it itself after the merge
function Test-BranchWeg([string]$branch) {
    if ($gitea) { return (Invoke-Gitea GET "/branches/$([uri]::EscapeDataString($branch))").Status -eq 404 }
    $out = @(gh api "repos/$Repo/branches/$branch" --jq .name 2>&1 | ForEach-Object { "$_" }) -join ' '
    [bool]$LASTEXITCODE -and $out -match 'HTTP 404'
}
# the end of the line says which of three it was: already gone (no error), deleted, or kept with its reason
$branch = $info.headRefName
if ($BranchBehalten) { $zeile += "; Branch $branch behalten (-BranchBehalten)" }
elseif (Test-BranchWeg $branch) { $zeile += "; Branch $branch war schon geloescht (von der Forge)" }
else {
    $voraus = Get-Ahead $info.baseRefName $branch
    if ($voraus -eq '0') {
        if ($gitea) { $weg = Test-Ok (Invoke-Gitea DELETE "/branches/$([uri]::EscapeDataString($branch))") }
        else { gh api -X DELETE "repos/$Repo/git/refs/heads/$branch" 2>$null | Out-Null; $weg = -not $LASTEXITCODE }
        $zeile += if (-not $weg) { "; Branch $branch nicht geloescht (die Forge lehnte ab)" } else { "; Branch $branch geloescht" }
    } elseif (-not $voraus) {
        $zeile += "; Branch $branch behalten (Vergleich mit $($info.baseRefName) nicht lesbar)"
    } else {
        $zeile += "; Branch $branch behalten ($voraus Commits nicht in $($info.baseRefName))"
    }
}
$zeile
