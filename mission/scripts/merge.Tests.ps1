# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\mission\scripts\merge.Tests.ps1
# The script runs as a separate pwsh process, the way the driver calls it. gh is a stub script
# (-GhCommand) that answers from a list of rules and logs every call; no test reaches GitHub.

$script = Join-Path $PSScriptRoot 'merge.ps1'
$green = "Gate gr$([char]0x00FC)n."

$stub = @'
$line = $args -join ' '
Add-Content -Path $env:MERGE_GH_LOG -Value $line -Encoding utf8
foreach ($rule in (Get-Content $env:MERGE_GH_FIXTURE -Raw -Encoding utf8 | ConvertFrom-Json)) {
    if ($line -match $rule.match) {
        if ($rule.out) { $rule.out }
        if ($rule.err) { [Console]::Error.WriteLine([string]$rule.err) }
        exit $rule.exit
    }
}
exit 1
'@

# The same rules as a native program (gh.cmd -> pwsh), writing raw UTF-8 bytes: merge.ps1 then decodes
# them with [Console]::OutputEncoding, the path the code page fix of the dress rehearsal changed.
$nativeStub = $stub -replace 'if \(\$rule\.out\) \{ \$rule\.out \}', 'if ($rule.out) { $b = [Text.Encoding]::UTF8.GetBytes([string]$rule.out + [char]10); $o = [Console]::OpenStandardOutput(); $o.Write($b, 0, $b.Length); $o.Flush() }'

function Get-Base64([string]$text) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)) }

$baseSha = 'aaaaaaa' + ('1' * 33)
$headSha = 'bbbbbbbb' + ('2' * 32)
$nachGate = "---`nmerge: nach_gate`n---`n`n# Adapter`n"

function New-GateBody([string]$base = 'aaaaaaa', [string]$head = 'bbbbbbbb', [string]$end = $green) {
    "## Pakete`n- x`n`n## Gate`n``````n== Gate: Basis origin/main @ $base, 3 ge$([char]0x00E4)nderte Dateien (HEAD $head)`n  web gr$([char]0x00FC)n 0:50`n$end`n```````n`nFertig."
}

# Rules for a pull request #7 with the given body, adapter text, checks and compare answers.
function New-Rules([string]$body, [string]$adapter = $nachGate, [string]$checks = '[]', [string]$behind = '0',
    [string]$stateAfter = 'MERGED', [string]$ahead = '0', [string]$base = 'main') {
    $view = ConvertTo-Json -Compress -InputObject @{ state = 'OPEN'; headRefName = 'epic/7-x'; headRefOid = $headSha; isDraft = $false; body = $body; baseRefName = $base }
    $rules = @(
        @{ match = '^pr view 7 .*--json state,headRefName,baseRefName,headRefOid'; out = $view; exit = 0 }
        @{ match = '^api repos/o/r --jq \.default_branch'; out = 'main'; exit = 0 }
        @{ match = '^api repos/o/r/contents/\.claude/epic\.md\?ref=main'; out = $(if ($adapter) { Get-Base64 $adapter } else { '' }); exit = $(if ($adapter) { 0 } else { 1 }) }
        @{ match = '^pr checks 7'; out = $checks; exit = 0 }
        @{ match = '^api repos/o/r/commits/main'; out = $baseSha; exit = 0 }
        @{ match = "^api repos/o/r/compare/main\.\.\.$headSha"; out = $behind; exit = 0 }
        @{ match = '^pr view 7 .*--json mergeable'; out = '{"mergeable":"MERGEABLE"}'; exit = 0 }
        @{ match = '^pr merge 7 '; out = ''; exit = 0 }
        @{ match = '^pr view 7 .*--json state,headRefName,baseRefName,closingIssuesReferences'; out = (ConvertTo-Json -Compress -InputObject @{ state = $stateAfter; headRefName = 'epic/7-x'; baseRefName = 'main'; closingIssuesReferences = @() }); exit = 0 }
        @{ match = '^api repos/o/r/compare/main\.\.\.epic/7-x'; out = $ahead; exit = 0 }
        @{ match = '^api repos/o/r/branches/epic/7-x'; out = 'epic/7-x'; exit = 0 }
        @{ match = '^api -X DELETE'; out = ''; exit = 0 }
    )
    $rules
}

function Invoke-Merge($rules, [switch]$Native, [double]$LeerMinuten = 0, [int]$TaktSekunden = 0, [switch]$BranchBehalten) {
    $dir = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $stubFile = Join-Path $dir 'gh-stub.ps1'
    Set-Content -Path $stubFile -Value $(if ($Native) { $nativeStub } else { $stub }) -Encoding UTF8
    if ($Native) {
        $cmd = Join-Path $dir 'gh.cmd'
        Set-Content -Path $cmd -Value "@pwsh -NoProfile -ExecutionPolicy Bypass -File `"$stubFile`" %*" -Encoding ASCII
        $stubFile = $cmd
    }
    $fixture = Join-Path $dir 'rules.json'
    [IO.File]::WriteAllText($fixture, (ConvertTo-Json -Depth 5 -InputObject @($rules)), (New-Object Text.UTF8Encoding $false))
    $log = Join-Path $dir 'calls.log'
    $env:MERGE_GH_FIXTURE = $fixture; $env:MERGE_GH_LOG = $log
    $out = & pwsh -NoProfile -File $script -Repo o/r -Pr 7 -GhCommand $stubFile -LeerMinuten $LeerMinuten -TaktSekunden $TaktSekunden -BranchBehalten:$BranchBehalten 2>$null
    $exit = $LASTEXITCODE
    $calls = if (Test-Path $log) { @(Get-Content $log -Encoding UTF8) } else { @() }
    @{ Exit = $exit; Out = (@($out) -join "`n"); Calls = $calls }
}

function Get-MergeCalls($r) { @($r.Calls | Where-Object { $_ -match '^pr merge' }) }
function Get-DeleteCalls($r) { @($r.Calls | Where-Object { $_ -match '^api -X DELETE' }) }

Describe 'merge.ps1: the adapter key merge decides who merges' {
    It 'refuses without a merge key: the default is mensch' {
        $r = Invoke-Merge (New-Rules (New-GateBody) "---`nforge: github`n---`n")
        $r.Exit | Should Be 1
        $r.Out | Should Match 'NICHT GEMERGT #7: merge: mensch'
        (Get-MergeCalls $r).Count | Should Be 0
    }

    It 'refuses without an adapter' {
        $r = Invoke-Merge (New-Rules (New-GateBody) '')
        $r.Out | Should Match 'merge: mensch'
        (Get-MergeCalls $r).Count | Should Be 0
    }

    It 'reads the adapter from the default branch and refuses a base other than the expected one' {
        $r = Invoke-Merge (New-Rules (New-GateBody) -base 'release')
        $r.Exit | Should Be 1
        $r.Out | Should Match 'NICHT GEMERGT #7: Basis release, erwartet main'
        @($r.Calls | Where-Object { $_ -match 'contents/\.claude/epic\.md\?ref=main' }).Count | Should Be 1
        (Get-MergeCalls $r).Count | Should Be 0
        $r = Invoke-Merge (New-Rules (New-GateBody) "---`nmerge: nach_gate`nmain_branch: trunk`n---`n")
        $r.Out | Should Match 'Basis main, erwartet trunk'
        $r = Invoke-Merge (New-Rules (New-GateBody) "---`nmerge: nach_gate`nbase_branch: release`n---`n" -base 'release')
        $r.Out | Should Not Match 'erwartet'
        $r = Invoke-Merge (New-Rules (New-GateBody) "---`nmerge: nach_gate`nbase_branch: from-issue`n---`n")
        $r.Out | Should Match 'base_branch: from-issue'
        (Get-MergeCalls $r).Count | Should Be 0
    }

    It 'refuses merge: mensch' {
        $r = Invoke-Merge (New-Rules (New-GateBody) "---`nmerge: mensch`n---`n")
        $r.Out | Should Match 'merge: mensch'
        (Get-MergeCalls $r).Count | Should Be 0
    }
}

Describe 'merge.ps1: with checks' {
    It 'merges with a merge commit after green checks and a green gate' {
        $r = Invoke-Merge (New-Rules (New-GateBody) -checks '[{"name":"ci","bucket":"pass"}]')
        $r.Exit | Should Be 0
        $r.Out | Should Match 'GEMERGT #7 -> main'
        (Get-MergeCalls $r) | Should Be @("pr merge 7 --repo o/r --merge --match-head-commit $headSha")
    }

    It 'never lets a green foreign check stand in for the gate (acceptance 3: a website build on every PR)' {
        $checks = '[{"name":"Workers Builds: hexanite","bucket":"pass"}]'
        $r = Invoke-Merge (New-Rules 'kein Gate' -checks $checks)
        $r.Exit | Should Be 1
        $r.Out | Should Match "GATE FEHLT #7: kein Abschnitt '## Gate'"
        (Get-MergeCalls $r).Count | Should Be 0
        $r = Invoke-Merge (New-Rules (New-GateBody -end 'Gate rot.') -checks $checks)
        $r.Out | Should Match 'GATE FEHLT #7'
        (Get-MergeCalls $r).Count | Should Be 0
        $r = Invoke-Merge (New-Rules (New-GateBody -base 'ccccccc') -checks $checks)
        $r.Out | Should Match 'GATE FEHLT #7: Gate lief gegen ccccccc'
        (Get-MergeCalls $r).Count | Should Be 0
    }

    It 'stops on red checks' {
        $r = Invoke-Merge (New-Rules (New-GateBody) -checks '[{"name":"ci","bucket":"fail"}]')
        $r.Out | Should Match 'CHECKS ROT #7: ci'
        (Get-MergeCalls $r).Count | Should Be 0
    }
}

Describe 'merge.ps1: the gate block decides' {
    It 'merges after a green gate on the current base and head' {
        $r = Invoke-Merge (New-Rules (New-GateBody))
        $r.Exit | Should Be 0
        $r.Out | Should Match 'GEMERGT #7 -> main; Branch epic/7-x geloescht'
        (Get-MergeCalls $r).Count | Should Be 1
        # a push between the check and the merge makes gh refuse (acceptance, low)
        @(Get-MergeCalls $r)[0] | Should Match "--match-head-commit $headSha"
    }

    It 'reads "Gate gruen." with an umlaut from a native gh in UTF-8 (dress rehearsal, acceptance finding 16)' {
        $r = Invoke-Merge (New-Rules (New-GateBody)) -Native
        $r.Out | Should Match 'GEMERGT #7 -> main'
        (Get-MergeCalls $r).Count | Should Be 1
    }

    It 'refuses without a gate section' {
        $r = Invoke-Merge (New-Rules "## Pakete`n- x")
        $r.Out | Should Match "GATE FEHLT #7: kein Abschnitt '## Gate'"
        (Get-MergeCalls $r).Count | Should Be 0
    }

    It 'refuses a red gate' {
        $r = Invoke-Merge (New-Rules (New-GateBody -end 'Gate ROT.'))
        $r.Out | Should Match 'GATE FEHLT #7: der letzte Gate-Lauf endet nicht'
        (Get-MergeCalls $r).Count | Should Be 0
    }

    It 'counts the last run: red after green refuses, green after red merges' {
        $twoRuns = "## Gate`n``````n== Gate: Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)`n$green`n== Gate: Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)`nGate ROT.`n``````"
        (Invoke-Merge (New-Rules $twoRuns)).Out | Should Match 'GATE FEHLT'
        $fixed = "## Gate`n``````n== Gate: Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)`nGate ROT.`n== Gate: Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)`n$green`n``````"
        (Invoke-Merge (New-Rules $fixed)).Out | Should Match 'GEMERGT #7'
    }

    It 'ends the section at the next heading of the same level' {
        $body = "## Gate`nkommt noch`n`n## Notizen`n== Gate: Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)`n$green"
        (Invoke-Merge (New-Rules $body)).Out | Should Match 'GATE FEHLT #7: kein Gate-Lauf mit Basis'
    }

    It 'refuses a gate against an old base' {
        $r = Invoke-Merge (New-Rules (New-GateBody -base 'ccccccc'))
        $r.Out | Should Match 'GATE FEHLT #7: Gate lief gegen ccccccc, die Basis steht auf aaaaaaa'
        (Get-MergeCalls $r).Count | Should Be 0
    }

    It 'refuses a gate on another head' {
        $r = Invoke-Merge (New-Rules (New-GateBody -head 'dddddddd'))
        $r.Out | Should Match 'GATE FEHLT #7: Gate lief auf dddddddd'
        (Get-MergeCalls $r).Count | Should Be 0
    }

    It 'refuses a head that does not contain the current base' {
        $r = Invoke-Merge (New-Rules (New-GateBody) -behind '3')
        $r.Out | Should Match 'GATE FEHLT #7: der Head enthaelt die aktuelle Basis nicht \(3 Commits dahinter\)'
        (Get-MergeCalls $r).Count | Should Be 0
    }

    It 'reads gate_heading, gate_green, gate_base and gate_head from the adapter' {
        $adapter = "---`nmerge: nach_gate`ngate_heading: '### Pruefung'`ngate_green: 'OK alles'`ngate_base: 'base=([0-9a-f]+)'`ngate_head: 'head=([0-9a-f]+)'   # own form`n---`n"
        $body = "### Pruefung`nbase=aaaaaaa head=bbbbbbbb`nOK alles"
        (Invoke-Merge (New-Rules $body $adapter)).Out | Should Match 'GEMERGT #7'
    }
}

Describe 'merge.ps1: a repository without CI (#14, C2)' {
    $ohneCi = @(
        @{ match = '^api repos/o/r/actions/workflows'; out = '0'; exit = 0 }
        @{ match = '^api repos/o/r/commits/main/check-runs'; out = '0'; exit = 0 }
        @{ match = '^api repos/o/r/commits/main/status'; out = '0'; exit = 0 }
    )

    It 'does not wait for checks without a workflow and without checks on the base' {
        $t = Get-Date
        $r = Invoke-Merge ($ohneCi + (New-Rules (New-GateBody))) -LeerMinuten 5 -TaktSekunden 1
        $r.Out | Should Match 'GEMERGT #7'
        ((Get-Date) - $t).TotalSeconds | Should BeLessThan 60
        @($r.Calls | Where-Object { $_ -match '^pr checks' }).Count | Should Be 1
    }

    It 'still waits when the repository has a workflow' {
        $mitWorkflow = @(@{ match = '^api repos/o/r/actions/workflows'; out = '1'; exit = 0 }) + $ohneCi[1..2]
        $r = Invoke-Merge ($mitWorkflow + (New-Rules (New-GateBody))) -LeerMinuten 0.05 -TaktSekunden 1
        $r.Out | Should Match 'GEMERGT #7'
        @($r.Calls | Where-Object { $_ -match '^pr checks' }).Count | Should BeGreaterThan 1
    }
}

Describe 'merge.ps1: one gate block, one way (step 7 of the gate rebuild; was the part run of #14, B)' {
    # an adapter of before: the abolished keys gate_areas, gate_always_command and gate_partial, a list among them
    $alt = "---`nmerge: nach_gate`ngate_areas:`n  - 'apps/web/ = web'`n  - apps/api/** = api   # the server`ngate_always_command: npm run gate -- --immer`ngate_partial: Immer-Teil`n---`n"
    # a full green run on an older state, then a run whose heading still says Immer-Teil on the current state
    $body = "## Gate`n``````n== Gate: Basis origin/main @ ccccccc (HEAD eeeeeeee)`n$green`n== Gate: Immer-Teil, Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)`n  wurzel gr$([char]0x00FC)n`n$green`n``````"
    $compare = @(@{ match = '^api repos/o/r/compare/(ccccccc|eeeeeeee|aaaaaaa1)'; out = "1`napps/web/z.ts"; exit = 0 })

    It 'a partial run never counts, even green on the current base and head; no file list is read' {
        $r = Invoke-Merge ($compare + (New-Rules $body $alt))
        $r.Out | Should Be 'GATE FEHLT #7: der letzte Gate-Lauf ist ein Teil-Lauf, er zaehlt nicht'
        (Get-MergeCalls $r).Count | Should Be 0
        @($r.Calls | Where-Object { $_ -match '^api repos/o/r/compare/(ccccccc|eeeeeeee|aaaaaaa1)' }).Count | Should Be 0
    }

    It 'without gate_partial the heading Immer-Teil marks a partial run; with it, its pattern does' {
        (Invoke-Merge ($compare + (New-Rules $body))).Out | Should Match 'Teil-Lauf, er zaehlt nicht'
        $eigen = "---`nmerge: nach_gate`ngate_partial: Nur-Wurzel`n---`n"
        $nurWurzel = "## Gate`n== Gate: Nur-Wurzel, Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)`n$green"
        (Invoke-Merge (New-Rules $nurWurzel $eigen)).Out | Should Match 'Teil-Lauf, er zaehlt nicht'
        # a full run after the partial one counts as usual
        $danach = $body -replace '```$',"== Gate: Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)`n$green`n``````"
        (Invoke-Merge ($compare + (New-Rules $danach $alt))).Out | Should Match 'GEMERGT #7'
    }

    It 'a last run on an old base never counts, whatever the base moved in' {
        $alt2 = "## Gate`n``````n== Gate: Basis origin/main @ aaaaaaa (HEAD eeeeeeee)`n$green`n== Gate: Basis origin/main @ ccccccc (HEAD bbbbbbbb)`n$green`n``````"
        $r = Invoke-Merge ($compare + (New-Rules $alt2 $alt))
        $r.Out | Should Match 'GATE FEHLT #7: Gate lief gegen ccccccc, die Basis steht auf aaaaaaa'
        (Get-MergeCalls $r).Count | Should Be 0
    }
}

Describe 'merge.ps1: the head branch' {
    It 'keeps the branch when the pull request is not MERGED after the merge call' {
        $r = Invoke-Merge (New-Rules (New-GateBody) -stateAfter 'OPEN')
        $r.Exit | Should Be 1
        $r.Out | Should Match 'MERGE UNKLAR #7: Zustand OPEN'
        (Get-DeleteCalls $r).Count | Should Be 0
    }

    It 'keeps the branch when the base lacks some of its commits' {
        $r = Invoke-Merge (New-Rules (New-GateBody) -ahead '2')
        $r.Out | Should Match 'Branch epic/7-x behalten \(2 Commits nicht in main\)'
        (Get-DeleteCalls $r).Count | Should Be 0
    }

    It 'says when the forge already deleted the branch: no error, no delete call' {
        $weg = @(@{ match = '^api repos/o/r/branches/epic/7-x'; out = ''; err = 'gh: Not Found (HTTP 404)'; exit = 1 })
        # -Native: the error text of gh comes on stderr of its own process, as with the real gh
        $r = Invoke-Merge -Native ($weg + (New-Rules (New-GateBody)))
        $r.Exit | Should Be 0
        $r.Out | Should Be 'GEMERGT #7 -> main; Branch epic/7-x war schon geloescht (von der Forge)'
        (Get-DeleteCalls $r).Count | Should Be 0
    }

    It 'names the reason when it keeps the branch on purpose' {
        $r = Invoke-Merge (New-Rules (New-GateBody)) -BranchBehalten
        $r.Out | Should Be 'GEMERGT #7 -> main; Branch epic/7-x behalten (-BranchBehalten)'
        (Get-DeleteCalls $r).Count | Should Be 0
        $r = Invoke-Merge (New-Rules (New-GateBody) -ahead '')
        $r.Out | Should Be 'GEMERGT #7 -> main; Branch epic/7-x behalten (Vergleich mit main nicht lesbar)'
        (Get-DeleteCalls $r).Count | Should Be 0
    }

    It 'says deleted only when the forge deleted it' {
        $r = Invoke-Merge (New-Rules (New-GateBody))
        $r.Out | Should Be 'GEMERGT #7 -> main; Branch epic/7-x geloescht'
        $nein = @(@{ match = '^api -X DELETE'; out = ''; err = 'gh: Forbidden (HTTP 403)'; exit = 1 })
        $r = Invoke-Merge ($nein + (New-Rules (New-GateBody)))
        $r.Out | Should Be 'GEMERGT #7 -> main; Branch epic/7-x nicht geloescht (die Forge lehnte ab)'
    }
}

# Gitea (#127): curl is a stub script (-CurlCommand) that reads the request from its config on stdin, logs
# "METHOD path" and answers from rules; a rule with `after` holds only once a logged call matched it, one with
# `prior` only when that many earlier calls matched its own pattern.
$curlStub = @'
$cfg = @($input) -join "`n"
$url = [regex]::Match($cfg, '(?m)^url = "(.*)"$').Groups[1].Value
$method = [regex]::Match($cfg, '(?m)^request = "(.*)"$').Groups[1].Value
$auth = [regex]::Match($cfg, '(?m)^header = "Authorization: (.*)"$').Groups[1].Value
$path = $url -replace '^https?://[^/]+/api/v1/repos/o/r', ''
$line = "$method $path"
$log = @(if (Test-Path $env:MERGE_GH_LOG) { Get-Content $env:MERGE_GH_LOG -Encoding utf8 })
Add-Content -Path $env:MERGE_GH_LOG -Value "$line | $auth | $($args -join ' ')" -Encoding utf8
foreach ($rule in (Get-Content $env:MERGE_GH_FIXTURE -Raw -Encoding utf8 | ConvertFrom-Json)) {
    if ($line -notmatch $rule.match) { continue }
    if ($rule.after -and -not ($log | Where-Object { $_ -match $rule.after })) { continue }
    if ($null -ne $rule.prior -and @($log | Where-Object { ($_ -split ' \| ')[0] -match $rule.match }).Count -notin @($rule.prior)) { continue }
    if ($rule.out) { $rule.out }
    "$($rule.status)"
    exit 0
}
'404'
exit 0
'@

function New-GiteaRules([string]$body, [string]$title = 'Mission', [string]$statuses = '[]', [string]$behind = '0', [string]$issue3 = 'closed', [int[]]$unmergeable = @()) {
    $pr = @{ number = 7; title = $title; state = 'open'; merged = $false; draft = $false; mergeable = $true; body = $body; head = @{ ref = 'epic/7-x'; sha = $headSha }; base = @{ ref = 'main' } }
    $merged = $pr.Clone(); $merged.state = 'closed'; $merged.merged = $true
    $notMergeable = $pr.Clone(); $notMergeable.mergeable = $false
    @(
        @{ match = '^GET /pulls/7$'; after = '^POST /pulls/7/merge'; out = (ConvertTo-Json -Compress -Depth 4 -InputObject $merged); status = 200 }
        @{ match = '^GET /pulls/7$'; prior = $unmergeable; out = (ConvertTo-Json -Compress -Depth 4 -InputObject $notMergeable); status = 200 }
        @{ match = '^GET /pulls/7$'; out = (ConvertTo-Json -Compress -Depth 4 -InputObject $pr); status = 200 }
        @{ match = '^GET $'; out = '{"default_branch":"main"}'; status = 200 }
        @{ match = '^GET /contents/\.claude/epic\.md\?ref=main$'; out = (ConvertTo-Json -Compress -InputObject @{ content = (Get-Base64 $nachGate) }); status = 200 }
        @{ match = '^GET /commits/main/status$'; out = '{"total_count":0,"statuses":[]}'; status = 200 }
        @{ match = "^GET /commits/$headSha/status$"; out = "{`"statuses`":$statuses}"; status = 200 }
        @{ match = '^GET /branches/main$'; out = "{`"commit`":{`"id`":`"$baseSha`"}}"; status = 200 }
        @{ match = "^GET /compare/$headSha\.\.\.main$"; out = "{`"total_commits`":$behind}"; status = 200 }
        @{ match = '^POST /pulls/7/merge$'; status = 200 }
        @{ match = '^GET /issues/3$'; out = "{`"state`":`"$issue3`"}"; status = 200 }
        @{ match = '^GET /compare/main\.\.\.epic%2F7-x$'; out = '{"total_commits":0}'; status = 200 }
        @{ match = '^GET /branches/epic%2F7-x$'; out = '{"name":"epic/7-x"}'; status = 200 }
        @{ match = '^DELETE /branches/epic%2F7-x$'; status = 204 }
    )
}

function Invoke-GiteaMerge($rules) {
    $dir = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $dir | Out-Null
    $stubFile = Join-Path $dir 'curl-stub.ps1'
    Set-Content -Path $stubFile -Value $curlStub -Encoding UTF8
    $fixture = Join-Path $dir 'rules.json'
    [IO.File]::WriteAllText($fixture, (ConvertTo-Json -Depth 5 -InputObject @($rules)), (New-Object Text.UTF8Encoding $false))
    $log = Join-Path $dir 'calls.log'
    $env:MERGE_GH_FIXTURE = $fixture; $env:MERGE_GH_LOG = $log; $env:FLOTTE_FORGE_KOPF = 'token geheim'
    try { $out = & pwsh -NoProfile -File $script -Repo o/r -Pr 7 -Api 'http://gitea.invalid/api/v1/repos/o/r' -CurlCommand $stubFile -GhCommand 'kein-gh' -LeerMinuten 0 -TaktSekunden 0 2>$null }
    finally { Remove-Item Env:FLOTTE_FORGE_KOPF }
    $exit = $LASTEXITCODE
    $calls = if (Test-Path $log) { @(Get-Content $log -Encoding UTF8) } else { @() }
    @{ Exit = $exit; Out = (@($out) -join "`n"); Calls = $calls }
}

Describe 'merge.ps1: Gitea through its API (#127)' {
    It 'merges a gated pull request, names the closed issues and deletes the branch; the token goes on stdin' {
        $r = Invoke-GiteaMerge (New-GiteaRules ((New-GateBody) + "`n`nCloses #3"))
        $r.Exit | Should Be 0
        $r.Out | Should Be 'GEMERGT #7 -> main; Issues zu: #3; Branch epic/7-x geloescht'
        @($r.Calls | Where-Object { $_ -match "^POST /pulls/7/merge \| token geheim \| -sS --config - " }).Count | Should Be 1
        @($r.Calls | Where-Object { $_ -match 'geheim\s*$' -or ($_ -split ' \| ')[2] -match 'geheim' }).Count | Should Be 0
    }

    It 'names a Missionsziel that stayed open (HTTP 412 at a blocker) as still open' {
        $r = Invoke-GiteaMerge (New-GiteaRules ((New-GateBody) + "`n`nCloses #3") -issue3 'open')
        $r.Out | Should Match 'Issues zu: ; NOCH OFFEN: #3'
    }

    It 'refuses without a green gate, on a red commit status, on a draft and on a head behind the base' {
        (Invoke-GiteaMerge (New-GiteaRules 'kein Gate')).Out | Should Match "GATE FEHLT #7: kein Abschnitt '## Gate'"
        (Invoke-GiteaMerge (New-GiteaRules (New-GateBody) -statuses '[{"context":"ci","status":"failure"}]')).Out | Should Match 'CHECKS ROT #7: ci'
        (Invoke-GiteaMerge (New-GiteaRules (New-GateBody) -title 'WIP: Mission')).Out | Should Match 'NICHT GEMERGT #7: Entwurf'
        # a head without any status: Gitea sends statuses null (found by the probe against the throwaway Gitea)
        (Invoke-GiteaMerge (New-GiteaRules (New-GateBody) -statuses 'null')).Out | Should Match '^GEMERGT #7'
    }

    It 'reads a pull request that is not mergeable once more: Gitea may still check it after a push to the base (review of #127)' {
        # reads of /pulls/7: 0 the start, 1 mergeable, 2 the second read, 3 after the merge
        (Invoke-GiteaMerge (New-GiteaRules (New-GateBody) -unmergeable 1)).Out | Should Match '^GEMERGT #7'
        $r = Invoke-GiteaMerge (New-GiteaRules (New-GateBody) -unmergeable 1, 2)
        $r.Out | Should Be 'KONFLIKT #7: nicht mergebar'
        @($r.Calls | Where-Object { $_ -match '^POST /pulls/7/merge' }).Count | Should Be 0
        $r = Invoke-GiteaMerge (New-GiteaRules (New-GateBody) -behind '2')
        $r.Out | Should Match 'der Head enthaelt die aktuelle Basis nicht \(2 Commits dahinter\)'
        @($r.Calls | Where-Object { $_ -match '^POST /pulls/7/merge' }).Count | Should Be 0
    }
}

Describe 'merge.ps1: a refused merge names the reason of the forge (#229)' {
    function New-RefusedRules([string]$err) {
        @(New-Rules (New-GateBody) | ForEach-Object { if ($_.match -eq '^pr merge 7 ') { @{ match = '^pr merge 7 '; out = ''; err = $err; exit = 1 } } else { $_ } })
    }

    It 'prints the error output of gh on the same line, as one line' {
        $r = Invoke-Merge -Native (New-RefusedRules "GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)`nsecond line")
        $r.Exit | Should Be 1
        $r.Out | Should Be 'MERGE FEHLGESCHLAGEN #7: GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest) second line'
        (Get-DeleteCalls $r).Count | Should Be 0
    }

    It 'cuts a long reason and says so when gh gives none' {
        $r = Invoke-Merge -Native (New-RefusedRules ('x' * 1000))
        $r.Out | Should Match '^MERGE FEHLGESCHLAGEN #7: x{290,300}\.\.\.$'
        $r = Invoke-Merge -Native (New-RefusedRules '')
        $r.Out | Should Be 'MERGE FEHLGESCHLAGEN #7: keine Ausgabe der Forge'
    }

    It 'on Gitea names the status and the message of the API' {
        $rules = @(New-GiteaRules (New-GateBody) | ForEach-Object { if ($_.match -eq '^POST /pulls/7/merge$') { @{ match = '^POST /pulls/7/merge$'; out = '{"message":"Please try again later","url":"x"}'; status = 405 } } else { $_ } })
        $r = Invoke-GiteaMerge $rules
        $r.Exit | Should Be 1
        $r.Out | Should Be 'MERGE FEHLGESCHLAGEN #7: Status 405: Please try again later'
    }
}
