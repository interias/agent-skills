# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\epic\scripts\usage.Tests.ps1
# The transcripts are built in $TestDrive in the layout Claude Code writes; the script runs as a
# separate process, the way /epic calls it.

$script = Join-Path $PSScriptRoot 'usage.ps1'

function Invoke-Usage([string[]]$arguments) {
    $errFile = Join-Path $TestDrive ([guid]::NewGuid().ToString('N') + '.err')
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script @arguments 2>$errFile
    @{ Exit = $LASTEXITCODE; Out = @($out | Where-Object { $_ -ne $null }); Err = ((Get-Content $errFile -Raw) -replace '\s+', ' ') }
}

function New-AssistantLine([string]$id, [string]$time, [string]$model, [int]$in, [int]$write, [int]$read, [int]$out, [string]$toolUse) {
    $content = '[{"type":"text","text":"x"}]'
    if ($toolUse) { $content = '[{"type":"tool_use","id":"' + $toolUse + '","name":"Bash","input":{"command":"npm test"}}]' }
    '{"type":"assistant","timestamp":"' + $time + '","message":{"id":"' + $id + '","model":"' + $model + '","content":' + $content +
    ',"usage":{"input_tokens":' + $in + ',"cache_creation_input_tokens":' + $write + ',"cache_read_input_tokens":' + $read + ',"output_tokens":' + $out +
    ',"cache_creation":{"ephemeral_5m_input_tokens":' + $write + ',"ephemeral_1h_input_tokens":0}}}}'
}

function New-ResultLine([string]$time, [string]$toolUse, [string]$text) {
    '{"type":"user","timestamp":"' + $time + '","message":{"content":[{"type":"tool_result","tool_use_id":"' + $toolUse + '","content":[{"type":"text","text":"' + $text + '"}]}]}}'
}

# A project directory with one session: the host and two subagents of package 588, one scout.
function New-Run {
    $projects = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $repo = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $repo -Force | Out-Null
    $slug = (Resolve-Path $repo).Path -replace '[^A-Za-z0-9]', '-'
    $sub = Join-Path $projects "$slug\s1\subagents"
    New-Item -ItemType Directory -Path $sub -Force | Out-Null
    $transcript = Join-Path $projects "$slug\s1.jsonl"
    Set-Content -Path $transcript -Encoding UTF8 -Value @(
        '{"type":"user","timestamp":"2026-11-12T08:00:00.000Z","message":{"content":"/epic #580 epic/580-werkzeug"}}'
        (New-AssistantLine 'h1' '2026-11-12T08:00:10.000Z' 'claude-fable-5-2' 10 1000 0 100 '')
        # the same message in a second line: counted once
        (New-AssistantLine 'h1' '2026-11-12T08:00:11.000Z' 'claude-fable-5-2' 10 1000 0 100 't1')
        (New-ResultLine '2026-11-12T08:00:20.000Z' 't1' 'abcdefghij')
        (New-AssistantLine 'h2' '2026-11-12T10:00:00.000Z' 'claude-fable-5-2' 20 0 2000 200 '')
    )
    Set-Content -Path (Join-Path $sub 'agent-a1.jsonl') -Encoding UTF8 -Value (New-AssistantLine 'i1' '2026-11-12T08:30:00.000Z' 'claude-sonnet-5-5' 100 0 0 10 '')
    Set-Content -Path (Join-Path $sub 'agent-a1.meta.json') -Value '{"agentType":"epic-implementer-standard","description":"Implementer #588 Berechnung"}'
    Set-Content -Path (Join-Path $sub 'agent-a2.jsonl') -Encoding UTF8 -Value (New-AssistantLine 'r1' '2026-11-12T08:40:00.000Z' 'claude-sonnet-5-5' 50 0 0 10 '')
    Set-Content -Path (Join-Path $sub 'agent-a2.meta.json') -Value '{"agentType":"epic-reviewer-standard","description":"Reviewer #588 Berechnung"}'
    Set-Content -Path (Join-Path $sub 'agent-a3.jsonl') -Encoding UTF8 -Value (New-AssistantLine 'k1' '2026-11-12T08:35:00.000Z' 'claude-haiku-5-5' 10 0 0 2 '')
    Set-Content -Path (Join-Path $sub 'agent-a3.meta.json') -Value '{"agentType":"epic-kundschafter","description":"Schreibersuche Paket 588"}'
    @{ Projects = $projects; Repo = $repo; Transcript = $transcript }
}

Describe 'usage.ps1 sums' {
    $run = New-Run
    $r = Invoke-Usage @('-Transcript', $run.Transcript)
    $j = $r.Out[0] | ConvertFrom-Json
    $hostRow = $j.agents | Where-Object { $_.id -eq 'host' }

    It 'writes exactly one JSON object and exits 0' {
        $r.Exit | Should Be 0
        $r.Out.Count | Should Be 1
    }
    It 'counts a message written in two lines once' {
        $hostRow.messages | Should Be 2
        $hostRow.input | Should Be 30
        $hostRow.cache_write | Should Be 1000
        $hostRow.cache_read | Should Be 2000
        $hostRow.output | Should Be 300
    }
    It 'weights input, cache write, cache read and output' {
        # 30 + 1.25 * 1000 + 0.1 * 2000 + 5 * 300
        $hostRow.weighted | Should Be 2980
    }
    It 'sums tool results per tool' {
        $hostRow.tool_result_chars.Bash | Should Be 10
    }
    It 'gives every subagent the role of its agent type' {
        ($j.roles | ForEach-Object { $_.role }) -contains 'epic-implementer-standard' | Should Be $true
        ($j.roles | Where-Object { $_.role -eq 'epic-kundschafter' }).agents | Should Be 1
    }
    It 'reads the package from the description and splits it by role' {
        $j.packages.Count | Should Be 1
        $p = $j.packages[0]
        $p.package | Should Be '588'
        $p.implementer_runs | Should Be 1
        $p.reviewer_runs | Should Be 1
        $p.implementer | Should Be 150
        $p.reviewer | Should Be 100
        $p.other | Should Be 20
        $p.weighted | Should Be 270
    }
    It 'adds the shares up to the total' {
        $j.weighted | Should Be 3250
        ($j.roles | Where-Object { $_.role -eq 'host' }).share | Should Be 91.7
    }
}

Describe 'usage.ps1 window and weights' {
    $run = New-Run

    It 'counts only messages from -Since on and drops agents outside the window' {
        $j = (Invoke-Usage @('-Transcript', $run.Transcript, '-Since', '2026-11-12T09:00:00Z')).Out[0] | ConvertFrom-Json
        @($j.agents).Count | Should Be 1
        $j.agents[0].messages | Should Be 1
        $j.agents[0].cache_read | Should Be 2000
    }
    It 'counts only messages up to -Until' {
        $j = (Invoke-Usage @('-Transcript', $run.Transcript, '-Until', '2026-11-12T08:32:00Z')).Out[0] | ConvertFrom-Json
        @($j.agents).Count | Should Be 2
        ($j.agents | Where-Object { $_.id -eq 'host' }).messages | Should Be 1
    }
    It 'applies the weight of the first matching model' {
        $j = (Invoke-Usage @('-Transcript', $run.Transcript, '-ModelWeights', 'fable=5;sonnet=3')).Out[0] | ConvertFrom-Json
        ($j.agents | Where-Object { $_.id -eq 'host' }).weighted | Should Be 14900
        ($j.agents | Where-Object { $_.id -eq 'a1' }).weighted | Should Be 450
        ($j.agents | Where-Object { $_.id -eq 'a3' }).weighted | Should Be 20
    }
}

Describe 'usage.ps1 finding the transcript' {
    $run = New-Run

    It 'takes the newest transcript of the project of -RepoRoot' {
        $j = (Invoke-Usage @('-RepoRoot', $run.Repo, '-ProjectsDir', $run.Projects)).Out[0] | ConvertFrom-Json
        $j.transcript | Should Be (Resolve-Path $run.Transcript).Path
    }
    It 'takes the transcript that contains the text of -Contains' {
        $other = Join-Path (Split-Path $run.Transcript) 's2.jsonl'
        Set-Content -Path $other -Encoding UTF8 -Value (New-AssistantLine 'x1' '2026-11-12T12:00:00.000Z' 'claude-fable-5-2' 1 0 0 1 '')
        (Get-Item $other).LastWriteTime = (Get-Date).AddMinutes(5)
        $j = (Invoke-Usage @('-RepoRoot', $run.Repo, '-ProjectsDir', $run.Projects, '-Contains', 'epic/580-')).Out[0] | ConvertFrom-Json
        $j.transcript | Should Be (Resolve-Path $run.Transcript).Path
    }
    It 'fails when no transcript contains the text' {
        $r = Invoke-Usage @('-RepoRoot', $run.Repo, '-ProjectsDir', $run.Projects, '-Contains', 'epic/999-')
        $r.Exit | Should Be 1
        $r.Out.Count | Should Be 0
        $r.Err | Should Match "contains 'epic/999-'"
    }
    It 'fails without -Transcript and -RepoRoot' {
        (Invoke-Usage @()).Exit | Should Be 1
    }
    It 'fails on unusable weights' {
        $r = Invoke-Usage @('-Transcript', $run.Transcript, '-ModelWeights', 'opus=many')
        $r.Exit | Should Be 1
        $r.Err | Should Match 'ModelWeights'
    }
}
