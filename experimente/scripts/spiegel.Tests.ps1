# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\experimente\scripts\spiegel.Tests.ps1
# No network: the Gitea API (Invoke-Gitea), the push, the prompt and the output are mocked. Git runs
# for real, on throwaway repos in $TestDrive. The script is dot-sourced, so its functions are
# called in-process; the entry point runs only on a direct call.

. (Join-Path $PSScriptRoot 'spiegel.ps1')

$utf8 = New-Object Text.UTF8Encoding $false
$apiBase = 'http://mb-vsv-cast:3003/api/v1'

function New-SourceRepo([string]$adapter = $null, [string]$eol = "`n") {
    $root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $repo = Join-Path $root 'BRIQNET'
    New-Item -ItemType Directory -Path (Join-Path $repo '.claude') -Force | Out-Null
    if ($adapter) { $adapter = $adapter.Replace('{SRC}', ($repo -replace '\\', '/')) }
    if (-not $adapter) {
        $adapter = @(
            '---',
            'forge: gitea',
            'api: http://mb-vsv-cast:3003/api/v1/repos/Breuckmann/BRIQNET',
            'token_file: .env',
            'window: 3',
            '---',
            'Ein Satz ueber BRIQNET geht online.'
        ) -join $eol
        $adapter += $eol
    }
    [IO.File]::WriteAllText((Join-Path $repo '.claude\epic.md'), $adapter, $utf8)
    [IO.File]::WriteAllText((Join-Path $repo 'README.md'), "readme$eol", $utf8)
    git -C $repo init -q -b main
    git -C $repo -c core.autocrlf=false add .
    git -C $repo -c user.name=t -c user.email=t@t commit -q -m base
    @{ Repo = $repo; Base = (git -C $repo rev-parse HEAD); Root = $root }
}

function New-Rules($t, [string]$name = 'exp-523-a') {
    Get-AdapterRules $apiBase 'Breuckmann' 'BRIQNET' 'Breuckmann' $name $t.Repo $t.Root
}

function New-Commit($t, $rules, [string]$name = 'exp-523-a') {
    $work = Join-Path $t.Root 'work'
    New-WorkRepo $t.Repo $work
    $patterns = @('Breuckmann/BRIQNET')
    @{ Work = $work; Result = (New-AdapterCommit $work $t.Base '.claude/epic.md' $rules $patterns 'adapter') }
}

$epicBody = (@'
> **Reihenfolge:** Kinder #524 (A), #525 (B) ab Start parallel; #528 (E) nach #525. #530 (Neu, nachgetragen 20.10.2026) nach #528. #529 ist `ready-for-human` und blockiert den Abschluss nicht.
> **Basis:** `main`.

| Kind | Thema |
|---|---|
| #524 | ADRs |
| #528 | Patch Note |
| #530 | MP nach Reihenfolge |
| #529 | Manuelle Taetigkeiten |

## Out of Scope
- Altkopien (#529). Kein Massenlauf.
'@) -replace "`r", ''

$mapping = @{ 523 = 1; 524 = 2; 525 = 3; 526 = 4; 527 = 5; 528 = 6 }

function New-FakeApi([string[]]$existing = @(), [int]$issueOffset = 0) {
    $labels = @{
        epic  = @{ name = 'epic'; color = 'ff2bd6'; description = 'Epic: wartet' }
        ready = @{ name = 'ready-for-agent'; color = '0e8a16'; description = 'Spec ist vollstaendig' }
        enh   = @{ name = 'enhancement'; color = 'a2eeef'; description = 'Kategorie' }
    }
    $issues = @{}
    $issues[523] = @{ number = 523; title = 'Epic: Test'; body = $epicBody; labels = @($labels.enh, $labels.epic, $labels.ready); pull_request = $null }
    foreach ($n in 524..528) {
        $issues[$n] = @{ number = $n; title = "Kind $n"; body = "> **Reihenfolge:** Kind von #523. Nach #525.`n> **Grundlage:** Epic #523, ADR aus #524, #521."; labels = @($labels.enh, $labels.ready); pull_request = $null }
    }
    @{
        Calls = (New-Object System.Collections.ArrayList); Plan = (New-Object System.Collections.ArrayList)
        Json = $null; Existing = $existing; IssueOffset = $issueOffset; Counters = @{}; Issues = $issues
        # Edges of the original: the epic is blocked by its children and by #530; #528 by #525-#527.
        Deps = @{ 523 = @(524, 525, 526, 527, 528, 530); 528 = @(525, 526, 527) }
    }
}

$fakeGitea = {
    $fake.Calls.Add(@{ Method = $Method; Path = $Path; Body = $Body }) | Out-Null
    $route = $Path -replace '\?.*$', ''
    if ($Method -eq 'GET') {
        if ($route -match '^/repos/Breuckmann/(exp-[^/]+)$') {
            if ($fake.Existing -contains $Matches[1]) { return @{ Status = 200; Data = @{ name = $Matches[1] } } }
            return @{ Status = 404; Data = $null }
        }
        if ($route -match '^/repos/Breuckmann/BRIQNET/issues/(\d+)/dependencies$') {
            $list = @(); foreach ($n in @($fake.Deps[[int]$Matches[1]])) { if ($n) { $list += , @{ number = $n } } }
            return @{ Status = 200; Data = $list }
        }
        if ($route -match '^/repos/Breuckmann/BRIQNET/issues/(\d+)$') { return @{ Status = 200; Data = $fake.Issues[[int]$Matches[1]] } }
        return @{ Status = 404; Data = $null }
    }
    if ($Method -eq 'DELETE') { return @{ Status = 204; Data = $null } }
    if ($route -eq '/orgs/Breuckmann/repos') { return @{ Status = 201; Data = @{ name = $Body.name } } }
    if ($route -match '^/repos/Breuckmann/([^/]+)/labels$') {
        $key = "labels:$($Matches[1])"; $fake.Counters[$key] = 1 + [int]$fake.Counters[$key]
        return @{ Status = 201; Data = @{ id = 100 + $fake.Counters[$key] } }
    }
    if ($route -match '^/repos/Breuckmann/([^/]+)/issues$') {
        $key = "issues:$($Matches[1])"; $fake.Counters[$key] = 1 + [int]$fake.Counters[$key]
        return @{ Status = 201; Data = @{ number = $fake.Counters[$key] + $fake.IssueOffset } }
    }
    if ($route -match '/issues/\d+/dependencies$') { return @{ Status = 201; Data = $null } }
    @{ Status = 500; Data = 'unexpected call' }
}

# Dot-sourced inside an It, so the mocks belong to that test.
function Set-Mocks {
    Mock Invoke-Gitea -MockWith $fakeGitea
    Mock Invoke-GitPush { $fake.Calls.Add(@{ Method = 'PUSH'; Path = $url; Body = $commit }) | Out-Null }
    Mock Write-Plan { $fake.Plan.Add($text) | Out-Null }
    Mock Write-Json { $fake.Json = $json }
    Mock Write-Info { }
    Mock Write-Failure { $fake.Failure = $text }
    Mock Read-RepoNameConfirmation { $fake.Prompts = 1 + [int]$fake.Prompts; if ($fake.Answers) { $fake.Answers[$fake.Prompts - 1] } else { '' } }
}

function New-Params($t, [hashtable]$override = @{}) {
    $p = @{
        SourceRepo = $t.Repo; Base = $t.Base; Owner = 'Breuckmann'; Names = @('exp-523-a', 'exp-523-b'); Epic = 523
        Children = @('524', '525', '526', '527', '528'); Exclude = @('529', '530'); Api = $apiBase
        SourceOwner = 'Breuckmann'; SourceName = 'BRIQNET'; CloneRoot = $t.Root; WhatIf = $false; DoRemove = $false
    }
    foreach ($key in $override.Keys) { $p[$key] = $override[$key] }
    $p
}

function Get-Writes($fake) { @($fake.Calls | Where-Object { $_.Method -ne 'GET' }) }

Describe 'spiegel.ps1 -WhatIf' {
    It 'prints every planned write and executes none' {
        $t = New-SourceRepo; $fake = New-FakeApi; . Set-Mocks
        (Invoke-Main (New-Params $t @{ WhatIf = $true })) | Should Be 0
        Get-Writes $fake | Should BeNullOrEmpty
        Assert-MockCalled Invoke-GitPush -Times 0 -Scope It
        $plan = @($fake.Plan)
        # per mirror: 1 repo, 1 push, 3 labels, 6 issues, 8 dependencies
        $plan.Count | Should Be (2 * (1 + 1 + 3 + 6 + 8))
        @($plan | Where-Object { $_ -like 'POST /orgs/Breuckmann/repos *' }).Count | Should Be 2
        @($plan | Where-Object { $_ -like 'git push *exp-523-b.git *:refs/heads/main' }).Count | Should Be 1
        @($plan | Where-Object { $_ -like 'POST /repos/Breuckmann/exp-523-a/issues *' }).Count | Should Be 6
        $plan -join "`n" | Should Match 'original #528 -> #6'
        ($fake.Json | ConvertFrom-Json).Count | Should Be 2
    }

    It 'still reads: the original issues, their edges and whether the mirrors exist' {
        $t = New-SourceRepo; $fake = New-FakeApi; . Set-Mocks
        Invoke-Main (New-Params $t @{ WhatIf = $true }) | Out-Null
        @($fake.Calls | Where-Object { $_.Path -like '/repos/Breuckmann/BRIQNET/issues/523*' }).Count | Should Be 2
        @($fake.Calls | Where-Object { $_.Path -eq '/repos/Breuckmann/exp-523-a' }).Count | Should Be 1
    }
}

Describe 'spiegel.ps1 creating the mirrors' {
    It 'writes repo, push, labels, issues and edges in that order and reports the new numbers' {
        $t = New-SourceRepo; $fake = New-FakeApi; . Set-Mocks
        (Invoke-Main (New-Params $t)) | Should Be 0
        $writes = Get-Writes $fake
        @($writes | Where-Object { $_.Path -eq '/orgs/Breuckmann/repos' }).Count | Should Be 2
        @($writes | Where-Object { $_.Method -eq 'PUSH' }).Count | Should Be 2
        $order = @($writes | Select-Object -First 4 | ForEach-Object { $_.Method + ' ' + $_.Path })
        $order[0] | Should Be 'POST /orgs/Breuckmann/repos'
        $order[1] | Should Match '^PUSH .*exp-523-a\.git$'
        $order[2] | Should Match '/exp-523-a/labels$'
        $json = $fake.Json | ConvertFrom-Json
        $json[0].repo | Should Be 'Breuckmann/exp-523-a'
        $json[1].repo | Should Be 'Breuckmann/exp-523-b'
        $json[0].epic | Should Be 1
        $json[0].children.'524' | Should Be 2
        $json[0].children.'528' | Should Be 6
        $json[0].url | Should Be 'http://mb-vsv-cast:3003/Breuckmann/exp-523-a'
        $pushed = @($writes | Where-Object { $_.Method -eq 'PUSH' })[0]
        $pushed.Body | Should Be $json[0].base
        $json[0].base | Should Not Be $json[1].base
    }

    It 'sends the original title, the labels as ids and the rewritten body' {
        $t = New-SourceRepo; $fake = New-FakeApi; . Set-Mocks
        Invoke-Main (New-Params $t) | Out-Null
        $issues = @(Get-Writes $fake | Where-Object { $_.Path -eq '/repos/Breuckmann/exp-523-a/issues' })
        $issues.Count | Should Be 6
        $issues[0].Body.title | Should Be 'Epic: Test'
        $issues[0].Body.labels.Count | Should Be 3
        $issues[1].Body.title | Should Be 'Kind 524'
        $issues[1].Body.body | Should Match 'Kind von #1\. Nach #3\.'
        $issues[1].Body.body | Should Match 'ADR aus #2, #521\.'
    }

    It 'stops when Gitea hands out another number than the rewritten bodies assume' {
        $t = New-SourceRepo; $fake = New-FakeApi -issueOffset 1; . Set-Mocks
        (Invoke-Main (New-Params $t)) | Should Be 1
        $fake.Failure | Should Match 'expected 1'
    }

    It 'refuses a name that does not start with exp-, before any call' {
        $t = New-SourceRepo; $fake = New-FakeApi; . Set-Mocks
        (Invoke-Main (New-Params $t @{ Names = @('BRIQNET', 'exp-523-b') })) | Should Be 1
        $fake.Calls.Count | Should Be 0
    }

    It 'stops with exit 1 and writes nothing when one mirror already exists' {
        $t = New-SourceRepo; $fake = New-FakeApi -existing @('exp-523-b'); . Set-Mocks
        (Invoke-Main (New-Params $t)) | Should Be 1
        $fake.Failure | Should Match 'exp-523-b already exists'
        Get-Writes $fake | Should BeNullOrEmpty
        Assert-MockCalled Invoke-GitPush -Times 0 -Scope It
    }
}

Describe 'spiegel.ps1 reconstructing the bodies (story 5)' {
    It 'removes exactly the #530 sentence and the #530 row from the epic and reports both' {
        $r = Convert-IssueBody 523 $epicBody $mapping @(530)
        $r.Body | Should Not Match '#530'
        $r.Body | Should Match '#6 \(E\) nach #3\. #529 ist `ready-for-human`'
        $r.Body | Should Match '\| #2 \| ADRs \|'
        $r.Body | Should Match '\| #529 \|'
        $removed = @($r.Deviations | Where-Object { $_.kind -eq 'removed' })
        $removed.Count | Should Be 2
        $removed[0].rule | Should Be 'sentence naming #530'
        $removed[0].text | Should Be '#530 (Neu, nachgetragen 20.10.2026) nach #528.'
        $removed[1].rule | Should Be 'table row starting with | #530 |'
        $removed[1].text | Should Be '| #530 | MP nach Reihenfolge |'
    }

    It 'applies the same rule to #529: the sentence and the row go, the list item stays and is reported' {
        $r = Convert-IssueBody 523 $epicBody $mapping @(529, 530)
        $r.Body | Should Not Match 'ready-for-human'
        $r.Body | Should Not Match 'Manuelle'
        $r.Body | Should Match '- Altkopien \(#529\)\. Kein Massenlauf\.'
        @($r.Deviations | Where-Object { $_.kind -eq 'removed' }).Count | Should Be 4
        $dangling = @($r.Deviations | Where-Object { $_.kind -eq 'reference-without-target' })
        $dangling.Count | Should Be 1
        $dangling[0].ref | Should Be '#529'
    }

    It 'keeps a body without #529/#530 unchanged and reports nothing' {
        $body = "> **Reihenfolge:** Kein Bezug. Zweiter Satz.`n`n| a | b |`n|---|---|`n| x | y |`n"
        $r = Convert-IssueBody 524 $body @{} @(529, 530)
        $r.Body | Should Be $body
        @($r.Deviations).Count | Should Be 0
    }

    It 'keeps Windows line endings' {
        $r = Convert-IssueBody 524 "Satz eins. #530 ist neu. Satz drei.`r`nZeile zwei`r`n" @{} @(530)
        $r.Body | Should Be "Satz eins. Satz drei.`r`nZeile zwei`r`n"
    }

    It 'does not cut a sentence at an abbreviation' {
        $r = Convert-IssueBody 524 'Siehe ADR-0057 Pkt. 2 und #530 dazu. Rest.' @{} @(530)
        $r.Body | Should Be 'Rest.'
        $r.Deviations[0].text | Should Be 'Siehe ADR-0057 Pkt. 2 und #530 dazu.'
    }
}

Describe 'spiegel.ps1 rewriting the numbers' {
    It 'rewrites every mention of #523-#528 once and reports the count per number' {
        $body = 'Epic #523, Kinder #524-#528 und #525, #525 nochmal; Farbe #ff2bd6, Ticket 523 ohne Raute.'
        $r = Convert-IssueBody 524 $body $mapping @(529, 530)
        $r.Body | Should Be 'Epic #1, Kinder #2-#6 und #3, #3 nochmal; Farbe #ff2bd6, Ticket 523 ohne Raute.'
        $rewritten = @($r.Deviations | Where-Object { $_.kind -eq 'rewritten' })
        $rewritten.Count | Should Be 4
        (@($rewritten | Where-Object { $_.from -eq '#525' })[0]).count | Should Be 2
        (@($rewritten | Where-Object { $_.from -eq '#525' })[0]).to | Should Be '#3'
    }

    It 'does not rewrite twice: a new number that equals an old one stays' {
        $r = Convert-IssueBody 524 '#524 und #525' @{ 524 = 525; 525 = 526 } @()
        $r.Body | Should Be '#525 und #526'
    }

    It 'leaves a foreign reference alone and reports it as a reference without a target' {
        $r = Convert-IssueBody 524 "Grundlage: ADR aus #524.`nSiehe #521 und #521." $mapping @(529, 530)
        $r.Body | Should Match 'Siehe #521 und #521\.'
        $dangling = @($r.Deviations | Where-Object { $_.kind -eq 'reference-without-target' })
        $dangling.Count | Should Be 2
        $dangling[0].ref | Should Be '#521'
        $dangling[0].context | Should Be 'Siehe #521 und #521.'
    }

    It 'counts all rewrites in the report of a run' {
        $t = New-SourceRepo; $fake = New-FakeApi; . Set-Mocks
        Invoke-Main (New-Params $t) | Out-Null
        $json = $fake.Json | ConvertFrom-Json
        $sum = 0
        foreach ($d in @($json[0].deviations | Where-Object { $_.kind -eq 'rewritten' })) { $sum += $d.count }
        $json[0].rewrites | Should Be $sum
        $sum | Should BeGreaterThan 10
        @($json[0].deviations | Where-Object { $_.kind -eq 'reference-without-target' -and $_.ref -eq '#521' }).Count | Should Be 5
    }
}

Describe 'spiegel.ps1 adapter commit' {
    It 'points api: at the mirror and changes nothing else' {
        $t = New-SourceRepo
        $c = New-Commit $t (New-Rules $t)
        $c.Result.Parent | Should Be $t.Base
        $c.Result.Changes.Count | Should Be 1
        $c.Result.Changes[0].line | Should Be 3
        $old = @(git -C $c.Work show "$($t.Base):.claude/epic.md")
        $new = @(git -C $c.Work show "$($c.Result.Hash):.claude/epic.md")
        $new.Count | Should Be $old.Count
        $diff = @(0..($old.Count - 1) | Where-Object { $old[$_] -ne $new[$_] })
        $diff.Count | Should Be 1
        $new[$diff[0]] | Should Be 'api: http://mb-vsv-cast:3003/api/v1/repos/Breuckmann/exp-523-a'
        @(git -C $c.Work diff --name-only $t.Base $c.Result.Hash) | Should Be @('.claude/epic.md')
        @(git -C $c.Work diff --numstat $t.Base $c.Result.Hash)[0] | Should Be "1`t1`t.claude/epic.md"
        git -C $c.Work cat-file -t $c.Result.Hash | Should Be 'commit'
    }

    It 'keeps CRLF line endings' {
        $t = New-SourceRepo -eol "`r`n"
        $c = New-Commit $t (New-Rules $t)
        @(git -C $c.Work diff --numstat $t.Base $c.Result.Hash)[0] | Should Be "1`t1`t.claude/epic.md"
        $bytes = & git -C $c.Work cat-file blob "$($c.Result.Hash):.claude/epic.md" | Out-String
        $bytes | Should Match "exp-523-a`r`n"
    }

    It 'only reads the source repo' {
        $t = New-SourceRepo
        $before = (git -C $t.Repo count-objects -v) -join '|'
        $branches = (git -C $t.Repo branch -a) -join '|'
        $null = New-Commit $t (New-Rules $t)
        (git -C $t.Repo count-objects -v) -join '|' | Should Be $before
        (git -C $t.Repo branch -a) -join '|' | Should Be $branches
        git -C $t.Repo status --porcelain | Should BeNullOrEmpty
    }

    It 'also moves the paths of the original clone and reports every line' {
        $adapter = "---`napi: http://mb-vsv-cast:3003/api/v1/repos/Breuckmann/BRIQNET`nworktree_root: {SRC}-worktrees`n---`nToken aus ``{SRC}/.env`` laden.`n"
        $t2 = New-SourceRepo $adapter
        $c = New-Commit $t2 (New-Rules $t2)
        $c.Result.Changes.Count | Should Be 3
        $c.Result.Changes[1].to | Should Be ("worktree_root: " + ((Join-Path $t2.Root 'exp-523-a') -replace '\\', '/') + '-worktrees')
        $c.Result.Changes[2].to | Should Match 'exp-523-a/\.env'
        @(git -C $c.Work diff --numstat $t2.Base $c.Result.Hash)[0] | Should Be "3`t3`t.claude/epic.md"
    }

    It 'reports a line it cannot place instead of changing it' {
        $adapter = "---`napi: http://mb-vsv-cast:3003/api/v1/repos/Breuckmann/BRIQNET`nweb: http://mb-vsv-cast:3003/Breuckmann/BRIQNET`n---`n"
        $t = New-SourceRepo $adapter
        $c = New-Commit $t (New-Rules $t)
        $c.Result.Changes.Count | Should Be 1
        $c.Result.Residual.Count | Should Be 1
        $c.Result.Residual[0].line | Should Be 3
    }

    It 'refuses an adapter that does not name the original API' {
        $t = New-SourceRepo "---`nforge: gitea`n---`n"
        { New-Commit $t (New-Rules $t) } | Should Throw 'names the original API'
    }

    It 'refuses a base without adapter' {
        $t = New-SourceRepo
        git -C $t.Repo rm -q .claude/epic.md
        git -C $t.Repo -c user.name=t -c user.email=t@t commit -q -m 'no adapter'
        $base = git -C $t.Repo rev-parse HEAD
        $work = Join-Path $t.Root 'work'
        New-WorkRepo $t.Repo $work
        { New-AdapterCommit $work $base '.claude/epic.md' (New-Rules $t) @() 'x' } | Should Throw 'does not exist'
    }

    It 'finds other files that name the original repo' {
        $t = New-SourceRepo
        Add-Content -Path (Join-Path $t.Repo 'README.md') -Value 'see Breuckmann/BRIQNET'
        git -C $t.Repo -c user.name=t -c user.email=t@t commit -q -am docs
        $work = Join-Path $t.Root 'work'
        New-WorkRepo $t.Repo $work
        $head = git -C $t.Repo rev-parse HEAD
        @(Find-OriginalReferences $work $head @('Breuckmann/BRIQNET') '.claude/epic.md') | Should Be @('README.md')
    }

    It 'also finds files that name the path of the original clone' {
        $t = New-SourceRepo
        $path = $t.Repo -replace '\\', '/'
        [IO.File]::WriteAllText((Join-Path $t.Repo 'launch.json'), "{ `"cwd`": `"$path/service`" }`n", $utf8)
        git -C $t.Repo add launch.json
        git -C $t.Repo -c user.name=t -c user.email=t@t commit -q -m launch
        $work = Join-Path $t.Root 'work'
        New-WorkRepo $t.Repo $work
        $head = git -C $t.Repo rev-parse HEAD
        @(Find-OriginalReferences $work $head @('Breuckmann/BRIQNET', $path, $t.Repo) '.claude/epic.md') | Should Be @('launch.json')
    }

    It 'pushes the adapter commit as main, history included' {
        $t = New-SourceRepo
        $c = New-Commit $t (New-Rules $t)
        $bare = Join-Path $t.Root 'mirror.git'
        git init -q --bare -b main $bare
        Invoke-GitPush $c.Work $bare $c.Result.Hash
        git -C $bare rev-parse refs/heads/main | Should Be $c.Result.Hash
        git -C $bare rev-parse "refs/heads/main~1" | Should Be $t.Base
    }
}

Describe 'spiegel.ps1 dependency edges' {
    It 'creates them with the new numbers, blocked issue in the URL, blocker in the body' {
        $t = New-SourceRepo; $fake = New-FakeApi; . Set-Mocks
        Invoke-Main (New-Params $t) | Out-Null
        $edges = @(Get-Writes $fake | Where-Object { $_.Path -like '/repos/Breuckmann/exp-523-a/issues/*/dependencies' })
        $pairs = @($edges | ForEach-Object { ($_.Path -replace '.*/issues/(\d+)/dependencies', '$1') + '<-' + $_.Body.index } | Sort-Object)
        $pairs -join ' ' | Should Be '1<-2 1<-3 1<-4 1<-5 1<-6 6<-3 6<-4 6<-5'
        $edges[0].Body.owner | Should Be 'Breuckmann'
        $edges[0].Body.repo | Should Be 'exp-523-a'
    }

    It 'drops the edge to #530 and reports it' {
        $t = New-SourceRepo; $fake = New-FakeApi; . Set-Mocks
        Invoke-Main (New-Params $t) | Out-Null
        @(Get-Writes $fake | Where-Object { $_.Path -like '*/dependencies' }).Count | Should Be 16
        $json = $fake.Json | ConvertFrom-Json
        $dropped = @($json[0].deviations | Where-Object { $_.kind -eq 'edge-dropped' })
        $dropped.Count | Should Be 1
        $dropped[0].issue | Should Be 523
        $dropped[0].blockedBy | Should Be '#530'
        $json[0].edges.Count | Should Be 8
    }
}

Add-Type -TypeDefinition @'
public class SpiegelFakeResponse : System.Net.WebResponse {
    public int StatusCode { get { return 403; } }
    public override System.IO.Stream GetResponseStream() { return new System.IO.MemoryStream(); }
}
'@

Describe 'spiegel.ps1 Gitea errors' {
    It 'keeps the error text that Windows PowerShell puts into ErrorDetails' {
        # PS 5.1 reads the error body itself: the response stream is empty, the text is in ErrorDetails.
        Mock Get-GiteaAuth { 'Basic x' }
        Mock Invoke-WebRequest {
            $ex = New-Object System.Net.WebException('403', $null, 'ProtocolError', (New-Object SpiegelFakeResponse))
            $record = New-Object Management.Automation.ErrorRecord($ex, 'WebCmdletWebResponseException', 'InvalidOperation', $null)
            $record.ErrorDetails = New-Object Management.Automation.ErrorDetails('{"message":"token does not have at least one of required scope(s), required=[write:organization]"}')
            throw $record
        }
        $State.Api = $apiBase; $State.DryRun = $false
        $r = Invoke-Gitea 'POST' '/orgs/Breuckmann/repos' @{ name = 'exp-x' }
        $r.Status | Should Be 403
        $r.Data.message | Should Match 'required=\[write:organization\]'
    }
}

Describe 'spiegel.ps1 -Remove' {
    It 'deletes nothing when the input does not match' {
        $t = New-SourceRepo; $fake = New-FakeApi -existing @('exp-523-a', 'exp-523-b'); $fake.Answers = @('', 'exp-523-a'); . Set-Mocks
        (Invoke-Main (New-Params $t @{ DoRemove = $true })) | Should Be 1
        # the empty answer skipped a; the answer for b names a, so b stays too
        @(Get-Writes $fake).Count | Should Be 0
        $fake.Prompts | Should Be 2
    }

    It 'never offers to delete a repo that does not start with exp-' {
        $t = New-SourceRepo; $fake = New-FakeApi -existing @('BRIQNET'); $fake.Answers = @('BRIQNET'); . Set-Mocks
        (Invoke-Main (New-Params $t @{ DoRemove = $true; Names = @('BRIQNET') })) | Should Be 1
        $fake.Calls.Count | Should Be 0
        Assert-MockCalled Read-RepoNameConfirmation -Times 0 -Scope It
    }

    It 'deletes a mirror when its name is typed, and only that one' {
        $t = New-SourceRepo; $fake = New-FakeApi -existing @('exp-523-a', 'exp-523-b'); $fake.Answers = @('exp-523-a', 'nope'); . Set-Mocks
        (Invoke-Main (New-Params $t @{ DoRemove = $true })) | Should Be 1
        $deletes = @(Get-Writes $fake)
        $deletes.Count | Should Be 1
        $deletes[0].Method | Should Be 'DELETE'
        $deletes[0].Path | Should Be '/repos/Breuckmann/exp-523-a'
    }

    It 'deletes both when both names are typed' {
        $t = New-SourceRepo; $fake = New-FakeApi -existing @('exp-523-a', 'exp-523-b'); $fake.Answers = @('exp-523-a', 'exp-523-b'); . Set-Mocks
        (Invoke-Main (New-Params $t @{ DoRemove = $true })) | Should Be 0
        @(Get-Writes $fake | ForEach-Object { $_.Path }) -join ' ' | Should Be '/repos/Breuckmann/exp-523-a /repos/Breuckmann/exp-523-b'
    }

    It 'skips a mirror that does not exist without asking' {
        $t = New-SourceRepo; $fake = New-FakeApi -existing @('exp-523-b'); $fake.Answers = @('exp-523-b'); . Set-Mocks
        (Invoke-Main (New-Params $t @{ DoRemove = $true })) | Should Be 0
        $fake.Prompts | Should Be 1
        @(Get-Writes $fake).Count | Should Be 1
    }

    It 'asks no question and deletes nothing under -WhatIf' {
        $t = New-SourceRepo; $fake = New-FakeApi -existing @('exp-523-a', 'exp-523-b'); . Set-Mocks
        (Invoke-Main (New-Params $t @{ DoRemove = $true; WhatIf = $true })) | Should Be 0
        Assert-MockCalled Read-RepoNameConfirmation -Times 0 -Scope It
        @(Get-Writes $fake).Count | Should Be 0
        @($fake.Plan).Count | Should Be 2
    }
}
