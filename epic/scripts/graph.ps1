<#
.SYNOPSIS
    Builds or removes the code graph of a /epic run with Graphify (AST only, no LLM).

.DESCRIPTION
    The code graph is a map for the orchestrator, implementers and reviewers: who calls, imports
    or depends on a symbol or file, answered in a few hundred characters instead of a search
    through the tree. It is built from the Epic worktree with
    `graphify extract <worktree> --code-only --no-cluster`, which parses the code locally; no
    model is called and no API key is needed (GRAPHIFY_BACKEND=none is set for the call).

    The graph lies in the git common dir, next to the locks of worktree.ps1:
    <common>/epic-graph/<Package>/graphify-out/graph.json. It is never tracked, shows up in no
    worktree and writes nothing into the source tree.

    Build rebuilds the graph in place; unchanged files come from Graphify's cache. Remove deletes
    <common>/epic-graph/<Package>.

    The graph is optional. Build reports available=false and exits 0 when graphify is not
    installed or the adapter says `code_graph: off` (YAML frontmatter of <RepoRoot>/.claude/epic.md;
    a missing adapter or key means on). The run then works without a graph.

    stdout carries exactly one JSON object. Build: available, reason (when not available), graph,
    nodes, edges, seconds. Remove: removed, path. The output of graphify goes to stderr. Exit 1
    when the arguments are unusable or graphify fails.

    Queries, from any directory:
        graphify explain  "<symbol or file>" --graph <graph>
        graphify affected "<symbol or file>" --depth 1 --graph <graph>
        graphify path "<A>" "<B>" --graph <graph>
    Exit 3 means the name is ambiguous (the candidates are listed), 4 that no node matches.

.PARAMETER Action
    Build (default) or Remove.

.PARAMETER RepoRoot
    Main checkout. Its git common dir holds the graph, its adapter may switch it off.

.PARAMETER Worktree
    Build only. The tree to index, normally the Epic worktree.

.PARAMETER Package
    Name of the graph, normally epic-<nr>.

.PARAMETER GraphifyCommand
    Test only. Executable to call instead of graphify.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File graph.ps1 -RepoRoot C:\src\app -Worktree C:\src\app-worktrees\epic-41 -Package epic-41

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File graph.ps1 -Action Remove -RepoRoot C:\src\app -Package epic-41
#>
[CmdletBinding()]
param(
    [ValidateSet('Build', 'Remove')]
    [string]$Action = 'Build',
    [string]$RepoRoot,
    [string]$Worktree,
    [string]$Package,
    [string]$GraphifyCommand
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false

function Fail([string]$message) {
    [Console]::Error.WriteLine("graph.ps1: $message")
    exit 1
}

# Reads the flat YAML frontmatter of the adapter: only `key: value` lines, which is all this
# script needs (copied from ram.ps1; this script must not depend on it).
function Read-Adapter([string]$repo) {
    $path = Join-Path $repo '.claude\epic.md'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $path = Join-Path $repo '.claude\prd.md' }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return @{} }
    $lines = [IO.File]::ReadAllLines($path)
    $keys = @{}
    if ($lines.Count -eq 0 -or $lines[0].Trim() -ne '---') { return $keys }
    for ($i = 1; $i -lt $lines.Count -and $lines[$i].Trim() -ne '---'; $i++) {
        if ($lines[$i] -match '^(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*:(?<value>.*)$') {
            $keys[$Matches.key] = (($Matches.value -replace '\s+#.*$', '').Trim()).Trim('"', "'")
        }
    }
    $keys
}

function Find-Graphify {
    if ($GraphifyCommand) { return $GraphifyCommand }
    $found = Get-Command graphify -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.Source }
    # uv and pipx install here; a shell started before the installation does not have it on PATH.
    $local = Join-Path $HOME '.local\bin\graphify.exe'
    if (Test-Path -LiteralPath $local -PathType Leaf) { return $local }
    $null
}

if (-not $RepoRoot) { Fail '-RepoRoot is required.' }
if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) { Fail "RepoRoot not found: $RepoRoot" }
if (-not $Package -or $Package -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { Fail "-Package must be a plain name such as epic-41, got '$Package'." }

$common = & git -C $RepoRoot rev-parse --git-common-dir 2>$null
if ($LASTEXITCODE -ne 0 -or -not $common) { Fail "$RepoRoot is not a git repository." }
if (-not [IO.Path]::IsPathRooted($common)) { $common = Join-Path $RepoRoot $common }
$target = Join-Path ([IO.Path]::GetFullPath($common)) "epic-graph\$Package"

if ($Action -eq 'Remove') {
    $existed = Test-Path -LiteralPath $target
    if ($existed) { Remove-Item -LiteralPath $target -Recurse -Force -Confirm:$false }
    [ordered]@{ removed = $existed; path = $target } | ConvertTo-Json -Compress
    exit 0
}

if (-not $Worktree) { Fail '-Worktree is required for Build.' }
if (-not (Test-Path -LiteralPath $Worktree -PathType Container)) { Fail "Worktree not found: $Worktree" }

$adapter = Read-Adapter $RepoRoot
if ($adapter['code_graph'] -match '^(off|false|no)$') {
    [ordered]@{ available = $false; reason = 'code_graph: off in the adapter' } | ConvertTo-Json -Compress
    exit 0
}
$graphify = Find-Graphify
if (-not $graphify) {
    [ordered]@{ available = $false; reason = 'graphify is not installed (uv tool install graphifyy)' } | ConvertTo-Json -Compress
    exit 0
}

$env:GRAPHIFY_BACKEND = 'none'
$env:GRAPHIFY_QUERY_LOG_DISABLE = '1'
$env:PYTHONIOENCODING = 'utf-8'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$watch = [Diagnostics.Stopwatch]::StartNew()
$ErrorActionPreference = 'Continue'
$output = & $graphify extract (Resolve-Path -LiteralPath $Worktree).Path --code-only --no-cluster --out $target 2>&1 | ForEach-Object { [string]$_ }
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
foreach ($line in $output) { [Console]::Error.WriteLine($line) }
$graph = Join-Path $target 'graphify-out\graph.json'
if ($code -ne 0) { Fail "graphify extract ended with exit code $code." }
if (-not (Test-Path -LiteralPath $graph -PathType Leaf)) { Fail "graphify extract wrote no graph at $graph." }

$nodes = $null
$edges = $null
foreach ($line in $output) {
    if ($line -match '(?<nodes>\d+) nodes, (?<edges>\d+) edges') { $nodes = [int]$Matches.nodes; $edges = [int]$Matches.edges }
}
[ordered]@{
    available = $true
    graph     = $graph
    nodes     = $nodes
    edges     = $edges
    seconds   = [int][math]::Round($watch.Elapsed.TotalSeconds)
} | ConvertTo-Json -Compress
