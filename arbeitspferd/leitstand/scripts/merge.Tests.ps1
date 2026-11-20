# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\arbeitspferd\leitstand\scripts\merge.Tests.ps1
# The script runs as a separate pwsh process, the way the Leitstand calls it. gh is a stub script
# (-GhCommand) that answers from a list of rules and logs every call; no test reaches GitHub.

$script = Join-Path $PSScriptRoot 'merge.ps1'
$green = "Gate gr$([char]0x00FC)n."

$stub = @'
$line = $args -join ' '
Add-Content -Path $env:MERGE_GH_LOG -Value $line -Encoding utf8
foreach ($rule in (Get-Content $env:MERGE_GH_FIXTURE -Raw -Encoding utf8 | ConvertFrom-Json)) {
    if ($line -match $rule.match) {
        if ($rule.out) { $rule.out }
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
        @{ match = '^api -X DELETE'; out = ''; exit = 0 }
    )
    $rules
}

function Invoke-Merge($rules, [switch]$Native, [double]$LeerMinuten = 0, [int]$TaktSekunden = 0) {
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
    $out = & pwsh -NoProfile -File $script -Repo o/r -Pr 7 -GhCommand $stubFile -LeerMinuten $LeerMinuten -TaktSekunden $TaktSekunden 2>$null
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

Describe 'merge.ps1: a last run of only the part that always runs (#14, B)' {
    $areas = "---`nmerge: nach_gate`ngate_areas:`n  - 'apps/web/ = web'`n  - apps/api/** = api   # the server`ngate_always_command: npm run gate -- --immer`n---`n"
    # full green run on base ccccccc and head eeeeeeee, then the part that always runs on the current state
    $body = "## Gate`n``````n== Gate: Basis origin/main @ ccccccc (HEAD eeeeeeee)`n$green`n== Gate: Immer-Teil, Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)`n  wurzel gr$([char]0x00FC)n`n$green`n``````"
    function New-Compare([string]$moved = 'apps/api/x.ts', [string]$epic = 'apps/web/y.ts', [string]$since = 'apps/api/x.ts') {
        $list = { param($f) $l = @($f -split ',' | Where-Object { $_ }); (@("$($l.Count)") + $l) -join "`n" }
        @(
            @{ match = "^api repos/o/r/compare/ccccccc\.\.\.$baseSha"; out = (& $list $moved); exit = 0 }
            @{ match = "^api repos/o/r/compare/$baseSha\.\.\.$headSha"; out = (& $list $epic); exit = 0 }
            @{ match = "^api repos/o/r/compare/eeeeeeee\.\.\.$headSha"; out = (& $list $since); exit = 0 }
        )
    }

    It 'merges when the base moved only in an area the epic does not touch' {
        $r = Invoke-Merge ((New-Compare) + (New-Rules $body $areas))
        $r.Out | Should Match 'GEMERGT #7'
    }

    It 'refuses when the base moved in an area of the epic' {
        $r = Invoke-Merge ((New-Compare -moved 'apps/web/z.ts' -since 'apps/web/z.ts') + (New-Rules $body $areas))
        $r.Out | Should Match 'GATE FEHLT #7: die Basis bewegte sich seit dem Voll-Lauf in Bereichen des Epics: web'
        (Get-MergeCalls $r).Count | Should Be 0
    }

    It 'refuses when the base moved a file outside every area' {
        $r = Invoke-Merge ((New-Compare -moved 'package.json' -since 'package.json') + (New-Rules $body $areas))
        $r.Out | Should Match 'Bereichen des Epics: \(ohne Bereich\)'
    }

    It 'refuses when the epic touches a file outside every area and the base moved' {
        $r = Invoke-Merge ((New-Compare -epic 'apps/web/y.ts,README.md') + (New-Rules $body $areas))
        $r.Out | Should Match 'Bereichen des Epics: .*\(ohne Bereich\)'
    }

    It 'refuses own changes after the full run' {
        $r = Invoke-Merge ((New-Compare -since 'apps/api/x.ts,apps/web/neu.ts') + (New-Rules $body $areas))
        $r.Out | Should Match 'nach dem Voll-Lauf kamen eigene Aenderungen: apps/web/neu.ts'
    }

    It 'refuses a renamed file whose old name lies in the area of the epic' {
        $r = Invoke-Merge ((New-Compare -moved 'apps/api/x.ts,apps/web/alt.ts' -since 'apps/api/x.ts,apps/web/alt.ts') + (New-Rules $body $areas))
        $r.Out | Should Match 'Bereichen des Epics: web'
    }

    It 'refuses when the forge cuts a file list' {
        $cut = @(@{ match = "^api repos/o/r/compare/ccccccc\.\.\.$baseSha"; out = "300`napps/api/x.ts"; exit = 0 }) + (New-Compare)
        $r = Invoke-Merge ($cut + (New-Rules $body $areas))
        $r.Out | Should Match 'Dateilisten fuer die Bereiche nicht lesbar'
    }

    It 'never merges when the check itself fails (an unreadable answer of the forge)' {
        $kaputt = @(@{ match = "^api repos/o/r/compare/ccccccc\.\.\.$baseSha"; out = "keine Zahl`napps/api/x.ts"; exit = 0 }) + (New-Compare)
        $r = Invoke-Merge ($kaputt + (New-Rules $body $areas))
        $r.Out | Should Match 'GATE FEHLT #7: Pruefung gescheitert'
        (Get-MergeCalls $r).Count | Should Be 0
    }

    It 'refuses a part run without gate_areas in the adapter' {
        $r = Invoke-Merge ((New-Compare) + (New-Rules $body))
        $r.Out | Should Match 'Teil-Lauf, der Adapter nennt keine gate_areas'
    }

    It 'refuses a part run without a green full run before it' {
        $nurTeil = "## Gate`n== Gate: Basis origin/main @ ccccccc (HEAD eeeeeeee)`nGate ROT.`n== Gate: Immer-Teil, Basis origin/main @ aaaaaaa (HEAD bbbbbbbb)`n$green"
        $r = Invoke-Merge ((New-Compare) + (New-Rules $nurTeil $areas))
        $r.Out | Should Match 'vor dem Teil-Lauf steht kein gruener Voll-Lauf'
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
}
