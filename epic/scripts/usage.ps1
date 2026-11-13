<#
.SYNOPSIS
    Sums the token usage of a /epic run per role, per package and per agent from the transcripts.

.DESCRIPTION
    Claude Code writes one transcript per session (<projects>/<slug>/<session>.jsonl) and one per
    subagent (<session>/subagents/agent-<id>.jsonl with agent-<id>.meta.json: agentType and
    description). Every assistant message carries its usage. This script reads them; it starts
    nothing and changes nothing.

    The host is the session transcript, role 'host'. Every subagent has the role of its
    agentType (epic-implementer-standard, epic-reviewer-urteil, epic-kundschafter, ...). The
    package is read from the description of the Agent call: '#588' or 'Paket 584', in mode spec
    '#41-p2'. An agent without such a number belongs to no package.

    A message is written as several lines with the same message id and the same usage; it is
    counted once.

    weighted is the usage in input-token equivalents: input + 1.25 x cache write (5 minutes) +
    2 x cache write (1 hour) + 0.1 x cache read + 5 x output, times the weight of the model.
    Without -ModelWeights every model weighs 1, and weighted compares agents of one model only.
    It is not the percentage of the plan limit; that comes from get_usage (/epic-flotte).

    tool_result_chars is the size of the tool results an agent received, in characters per tool,
    largest first. It shows what filled the context: test output (Bash, PowerShell) or reading
    (Read, Grep).

    stdout carries exactly one JSON object. Every message goes to stderr. Exit 1 when no
    transcript is found or the arguments are unusable.

.PARAMETER Transcript
    Path of the session transcript (.jsonl) of the host.

.PARAMETER RepoRoot
    Instead of -Transcript: the directory the session was started in. Takes the newest transcript
    of that project.

.PARAMETER Contains
    With -RepoRoot: take the newest transcript that contains this text, for example 'epic/574-'.
    Needed when several sessions ran in the same directory.

.PARAMETER ProjectsDir
    With -RepoRoot: the projects directory. Default $env:CLAUDE_CONFIG_DIR\projects, else
    ~\.claude\projects.

.PARAMETER Since
    Count only messages from this time on (ISO 8601). For a session that did more than the run.

.PARAMETER Until
    Count only messages up to this time (ISO 8601).

.PARAMETER ModelWeights
    Weight per model, matched as part of the model id, first match wins: 'opus=5;sonnet=3;haiku=1'.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File usage.ps1 -RepoRoot C:\src\app -Contains 'epic/574-'

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File usage.ps1 -Transcript C:\...\2b47834d.jsonl -Since 2026-11-12T06:00:00Z
#>
[CmdletBinding()]
param(
    [string]$Transcript,
    [string]$RepoRoot,
    [string]$Contains,
    [string]$ProjectsDir,
    [string]$Since,
    [string]$Until,
    [string]$ModelWeights
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false

function Fail([string]$message) {
    [Console]::Error.WriteLine("usage.ps1: $message")
    exit 1
}

function ConvertTo-Utc([string]$text, [string]$name) {
    $parsed = [datetimeoffset]::MinValue
    if (-not [datetimeoffset]::TryParse($text, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$parsed)) {
        Fail "-$name is not a time: '$text'."
    }
    $parsed.UtcDateTime
}

# ConvertFrom-Json leaves the timestamp a string in Windows PowerShell and makes it a DateTime in
# PowerShell 7.
function Get-EntryTime($entry) {
    if ($entry.timestamp -is [datetime]) { return $entry.timestamp.ToUniversalTime() }
    $parsed = [datetimeoffset]::MinValue
    if ([datetimeoffset]::TryParse([string]$entry.timestamp, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$parsed)) { return $parsed.UtcDateTime }
    $null
}

function Get-ModelWeight([string]$model) {
    foreach ($rule in $script:weights) {
        if ($model.IndexOf($rule.Part, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $rule.Weight }
    }
    1.0
}

function Get-Number($object, [string]$name) {
    if ($null -ne $object -and $null -ne $object.$name) { return [long]$object.$name }
    [long]0
}

# One transcript: usage per message id (counted once), tool result sizes per tool, first and last
# time inside the window.
function Read-Transcript([string]$path) {
    $messages = @{}
    $toolNames = @{}
    $toolChars = @{}
    $first = $null
    $last = $null
    foreach ($line in [IO.File]::ReadLines($path)) {
        if ($line.IndexOf('"usage"') -lt 0 -and $line.IndexOf('"tool_result"') -lt 0) { continue }
        try { $entry = $line | ConvertFrom-Json } catch { $script:skipped++; continue }
        $content = @($entry.message.content)
        if ($entry.type -eq 'assistant') {
            foreach ($block in $content) {
                if ($block.type -eq 'tool_use') { $toolNames[[string]$block.id] = [string]$block.name }
            }
        }
        $at = Get-EntryTime $entry
        if ($null -eq $at) { continue }
        if ($null -ne $script:sinceUtc -and $at -lt $script:sinceUtc) { continue }
        if ($null -ne $script:untilUtc -and $at -gt $script:untilUtc) { continue }
        if ($entry.type -eq 'assistant' -and $entry.message.usage -and $entry.message.model -ne '<synthetic>') {
            $messages[[string]$entry.message.id] = @{ Usage = $entry.message.usage; Model = [string]$entry.message.model }
        } elseif ($entry.type -eq 'user') {
            foreach ($block in $content) {
                if ($block.type -ne 'tool_result') { continue }
                $chars = 0
                if ($block.content -is [string]) { $chars = $block.content.Length }
                else { foreach ($part in @($block.content)) { if ($part.text) { $chars += ([string]$part.text).Length } } }
                $tool = $toolNames[[string]$block.tool_use_id]
                if (-not $tool) { $tool = 'unknown' }
                $toolChars[$tool] = [long]$toolChars[$tool] + $chars
            }
        } else { continue }
        if ($null -eq $first -or $at -lt $first) { $first = $at }
        if ($null -eq $last -or $at -gt $last) { $last = $at }
    }

    $sum = @{ input = [long]0; cache_write = [long]0; cache_read = [long]0; output = [long]0; weighted = 0.0 }
    $models = @{}
    foreach ($message in $messages.Values) {
        $usage = $message.Usage
        $fresh = Get-Number $usage 'input_tokens'
        $read = Get-Number $usage 'cache_read_input_tokens'
        $output = Get-Number $usage 'output_tokens'
        $write1h = Get-Number $usage.cache_creation 'ephemeral_1h_input_tokens'
        $write5m = (Get-Number $usage 'cache_creation_input_tokens') - $write1h
        $sum.input += $fresh
        $sum.cache_write += $write5m + $write1h
        $sum.cache_read += $read
        $sum.output += $output
        $sum.weighted += ($fresh +1.25 * $write5m + 2 * $write1h + 0.1 * $read + 5 * $output) * (Get-ModelWeight $message.Model)
        $models[$message.Model] = $true
    }
    $tools = [ordered]@{}
    foreach ($pair in ($toolChars.GetEnumerator() | Sort-Object Value -Descending)) { $tools[$pair.Key] = $pair.Value }
    $minutes = 0
    if ($null -ne $first) { $minutes = [math]::Round(($last - $first).TotalMinutes, 1) }
    @{ Messages = $messages.Count; Sum = $sum; Models = (@($models.Keys | Sort-Object) -join ','); Tools = $tools; Minutes = $minutes }
}

function New-AgentRow([string]$id, [string]$role, [string]$description, $data) {
    $package = $null
    if ($description -match '(?:#|Paket\s+)(\d+(?:-p\d+)?)') { $package = $Matches[1] }
    [ordered]@{
        id                = $id
        role              = $role
        description       = $description
        package           = $package
        model             = $data.Models
        messages          = $data.Messages
        input             = $data.Sum.input
        cache_write       = $data.Sum.cache_write
        cache_read        = $data.Sum.cache_read
        output            = $data.Sum.output
        weighted          = [long][math]::Round($data.Sum.weighted)
        minutes           = $data.Minutes
        tool_result_chars = $data.Tools
    }
}

function Measure-Weighted($rows) {
    $total = [long]0
    foreach ($row in $rows) { $total += $row.weighted }
    $total
}

$script:skipped = 0
$script:sinceUtc = $null
$script:untilUtc = $null
if ($Since) { $script:sinceUtc = ConvertTo-Utc $Since 'Since' }
if ($Until) { $script:untilUtc = ConvertTo-Utc $Until 'Until' }

$script:weights = @()
if ($ModelWeights) {
    foreach ($rule in ($ModelWeights -split '[;,]' | Where-Object { $_.Trim() })) {
        $weight = 0.0
        if ($rule -notmatch '^\s*(?<part>[^=\s]+)\s*=\s*(?<weight>\S+)\s*$' -or
            -not [double]::TryParse($Matches.weight, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$weight) -or
            $weight -le 0) {
            Fail "-ModelWeights expects 'part=number;part=number' with positive numbers, got '$rule'."
        }
        $script:weights += @{ Part = $Matches.part; Weight = $weight }
    }
}

if ($Transcript -and $RepoRoot) { Fail '-Transcript and -RepoRoot exclude each other.' }
if (-not $Transcript) {
    if (-not $RepoRoot) { Fail 'Give -Transcript or -RepoRoot.' }
    if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) { Fail "RepoRoot not found: $RepoRoot" }
    if (-not $ProjectsDir) {
        if ($env:CLAUDE_CONFIG_DIR) { $ProjectsDir = Join-Path $env:CLAUDE_CONFIG_DIR 'projects' }
        else { $ProjectsDir = Join-Path $HOME '.claude\projects' }
    }
    $slug = (Resolve-Path -LiteralPath $RepoRoot).Path.TrimEnd('\', '/') -replace '[^A-Za-z0-9]', '-'
    $projectDir = Join-Path $ProjectsDir $slug
    if (-not (Test-Path -LiteralPath $projectDir -PathType Container)) { Fail "No transcripts for $RepoRoot (looked in $projectDir)." }
    $candidates = @(Get-ChildItem -LiteralPath $projectDir -Filter *.jsonl -File | Sort-Object LastWriteTime -Descending)
    foreach ($candidate in $candidates) {
        if (-not $Contains -or (Select-String -LiteralPath $candidate.FullName -SimpleMatch -Pattern $Contains -Quiet)) {
            $Transcript = $candidate.FullName
            break
        }
    }
    if (-not $Transcript) { Fail "No transcript in $projectDir$(if ($Contains) { " contains '$Contains'" })." }
}
if (-not (Test-Path -LiteralPath $Transcript -PathType Leaf)) { Fail "Transcript not found: $Transcript" }
$Transcript = (Resolve-Path -LiteralPath $Transcript).Path

$agents = @()
$agents += New-AgentRow 'host' 'host' '' (Read-Transcript $Transcript)

$subagentDir = Join-Path ([IO.Path]::ChangeExtension($Transcript, $null).TrimEnd('.')) 'subagents'
if (Test-Path -LiteralPath $subagentDir -PathType Container) {
    foreach ($file in (Get-ChildItem -LiteralPath $subagentDir -Filter 'agent-*.jsonl' -File | Sort-Object Name)) {
        $role = 'unknown'
        $description = ''
        $metaPath = [IO.Path]::ChangeExtension($file.FullName, '.meta.json')
        if (Test-Path -LiteralPath $metaPath -PathType Leaf) {
            try {
                $meta = [IO.File]::ReadAllText($metaPath) | ConvertFrom-Json
                if ($meta.agentType) { $role = [string]$meta.agentType }
                if ($meta.description) { $description = [string]$meta.description }
            } catch { $script:skipped++ }
        }
        $data = Read-Transcript $file.FullName
        # An agent that did nothing inside the window is not part of the run.
        if ($data.Messages -eq 0) { continue }
        $agents += New-AgentRow ($file.BaseName -replace '^agent-', '') $role $description $data
    }
}

$total = Measure-Weighted $agents

$roles = @()
foreach ($group in ($agents | Group-Object { $_.role })) {
    $rows = $group.Group
    $weighted = Measure-Weighted $rows
    $share = 0
    if ($total -gt 0) { $share = [math]::Round($weighted * 100 / $total, 1) }
    $roles += [ordered]@{
        role        = $group.Name
        agents      = $rows.Count
        messages    = ($rows | ForEach-Object { $_.messages } | Measure-Object -Sum).Sum
        input       = ($rows | ForEach-Object { $_.input } | Measure-Object -Sum).Sum
        cache_write = ($rows | ForEach-Object { $_.cache_write } | Measure-Object -Sum).Sum
        cache_read  = ($rows | ForEach-Object { $_.cache_read } | Measure-Object -Sum).Sum
        output      = ($rows | ForEach-Object { $_.output } | Measure-Object -Sum).Sum
        weighted    = $weighted
        share       = $share
    }
}
$roles = @($roles | Sort-Object { $_.weighted } -Descending)

$packages = @()
foreach ($group in ($agents | Where-Object { $_.package } | Group-Object { $_.package })) {
    $implementers = @($group.Group | Where-Object { $_.role -like '*implementer*' })
    $reviewers = @($group.Group | Where-Object { $_.role -like '*reviewer*' })
    $others = @($group.Group | Where-Object { $_.role -notlike '*implementer*' -and $_.role -notlike '*reviewer*' })
    $packages += [ordered]@{
        package          = $group.Name
        implementer_runs = $implementers.Count
        reviewer_runs    = $reviewers.Count
        implementer      = Measure-Weighted $implementers
        reviewer         = Measure-Weighted $reviewers
        other            = Measure-Weighted $others
        weighted         = Measure-Weighted $group.Group
    }
}
$packages = @($packages | Sort-Object { $_.package })

[ordered]@{
    transcript    = $Transcript
    since         = $Since
    until         = $Until
    model_weights = $ModelWeights
    skipped_lines = $script:skipped
    weighted      = $total
    roles         = $roles
    packages      = $packages
    agents        = @($agents)
} | ConvertTo-Json -Depth 6 -Compress
