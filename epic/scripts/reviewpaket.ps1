<#
.SYNOPSIS
    Writes the review package of a /epic package: diff statistics, the diff and every new file in
    one Markdown file, so the reviewer reads one file instead of running git himself.

.DESCRIPTION
    The implementer does not commit (SKILL.md, Phase 4a), so the work is the working tree of the
    package worktree against its HEAD. The script takes a snapshot of that working tree, untracked
    files included, as a git tree object: a temporary index file, `git add -A`, `git write-tree`.
    The real index, the working tree and the stash stay untouched.

    The package file holds, in this order:
      - head: the epic head the worktree stands on, and the snapshot tree
      - `git diff --stat` and the diff with three lines of context
      - every new file in full (a new file is all additions; this keeps it readable as code)
    Binary files appear in the statistics only. A diff over -MaxLines lines is cut there, and
    the file says so; the reviewer then reads the remaining files himself.

    Round 2 and later (narrow re-review, SKILL.md, Phase 4b): -Since takes the tree of the
    snapshot the previous review saw. The diff then shows only what changed since - the fix -
    and the file names the earlier tree.

    The file lies in the git directory of the worktree (<git dir>/epic-review/), not in the
    working tree: a file there would show up in the next diff and make the worktree dirty.

    stdout carries exactly one JSON object: path, tree (pass it as -Since in the next round),
    head, since, files, new_files, lines, cut. Exit 1 with the reason on stderr when the worktree
    is not a git worktree or git fails.

.PARAMETER Worktree
    Absolute path of the package worktree.

.PARAMETER Package
    Package name for the file name, e.g. 588 or 41-p2.

.PARAMETER Round
    Review round, 1 for the first review.

.PARAMETER Since
    Tree of the previous round's package (its "tree" output). Only for round 2 and later.

.PARAMETER MaxLines
    Cut the diff after this many lines. Default 4000.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File reviewpaket.ps1 -Worktree C:\src\app-wt\588 -Package 588 -Round 1
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Worktree,
    [Parameter(Mandatory)][string]$Package,
    [int]$Round = 1,
    [string]$Since,
    [int]$MaxLines = 4000
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8

function Fail([string]$message) {
    [Console]::Error.WriteLine("reviewpaket.ps1: $message")
    exit 1
}

function Invoke-Git([string[]]$arguments) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $out = & git -C $Worktree -c core.quotepath=off -c core.safecrlf=false @arguments 2>$null
        if ($LASTEXITCODE -ne 0) { Fail "git $($arguments -join ' ') endete mit Exit $LASTEXITCODE." }
        , @($out | ForEach-Object { [string]$_ })
    } finally { $ErrorActionPreference = $eap }
}

if (-not (Test-Path -LiteralPath $Worktree -PathType Container)) { Fail "Worktree not found: $Worktree" }
$gitDir = (Invoke-Git @('rev-parse', '--path-format=absolute', '--git-dir'))[0]
$head = (Invoke-Git @('rev-parse', 'HEAD'))[0]

# Snapshot of the working tree with a temporary index: the real index stays as it is.
$index = Join-Path ([IO.Path]::GetTempPath()) "reviewpaket-$([guid]::NewGuid().ToString('N')).index"
$before = $env:GIT_INDEX_FILE
try {
    $env:GIT_INDEX_FILE = $index
    Invoke-Git @('read-tree', 'HEAD') | Out-Null
    Invoke-Git @('add', '-A') | Out-Null
    $tree = (Invoke-Git @('write-tree'))[0]
} finally {
    $env:GIT_INDEX_FILE = $before
    Remove-Item -LiteralPath $index -ErrorAction SilentlyContinue
}

$from = if ($Since) { $Since } else { "$head^{tree}" }
if ($Since) { Invoke-Git @('cat-file', '-e', "$Since^{tree}") | Out-Null }

$stat = Invoke-Git @('diff', '--stat=200', $from, $tree)
$status = Invoke-Git @('diff', '--name-status', '--no-renames', $from, $tree)
$added = @($status | Where-Object { $_ -match '^A\t' } | ForEach-Object { $_.Substring(2) })
$changed = @($status | Where-Object { $_ -match '^[MDT]\t' } | ForEach-Object { $_.Substring(2) })
$diff = if ($changed.Count) { Invoke-Git (@('diff', '-U3', $from, $tree, '--') + $changed) } else { @() }

$out = New-Object Collections.Generic.List[string]
$out.Add("# Review-Paket $Package, Runde $Round")
$out.Add('')
$out.Add("- Epic-Kopf des Worktrees (HEAD): ``$head``")
$out.Add("- Stand dieses Pakets (Tree): ``$tree``")
if ($Since) { $out.Add("- Nur die Änderungen seit dem Stand der Vorrunde: ``$Since``") }
$out.Add("- Erzeugt mit ``reviewpaket.ps1``; die Dateien liegen im Worktree ``$Worktree``")
$out.Add('')
$out.Add('## Statistik')
$out.Add('')
$out.Add('```')
foreach ($line in $stat) { $out.Add($line) }
$out.Add('```')
$out.Add('')
$out.Add("## Diff der geänderten Dateien ($($changed.Count))")
$out.Add('')
$cut = $false
if ($diff.Count) {
    $out.Add('```diff')
    $n = 0
    foreach ($line in $diff) {
        if ($n -ge $MaxLines) { $cut = $true; break }
        $out.Add($line); $n++
    }
    $out.Add('```')
    if ($cut) { $out.Add(''); $out.Add("**Gekürzt nach $MaxLines Zeilen.** Den Rest liest du selbst: ``git -C $Worktree diff $from $tree``.") }
} else { $out.Add('keine') }
$out.Add('')
$out.Add("## Neue Dateien ($($added.Count)), vollständig")
foreach ($file in $added) {
    $out.Add('')
    $out.Add("### $file")
    $out.Add('')
    $blob = Invoke-Git @('cat-file', '-p', "${tree}:$file")
    $text = $blob -join "`n"
    if ($text.IndexOf([char]0) -ge 0) { $out.Add('(binär, nur in der Statistik)'); continue }
    $ext = [IO.Path]::GetExtension($file).TrimStart('.')
    $out.Add('```' + $ext)
    foreach ($line in $blob) { $out.Add($line) }
    $out.Add('```')
}

$dir = Join-Path $gitDir 'epic-review'
if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$path = Join-Path $dir ("{0}-r{1}.md" -f ($Package -replace '[^A-Za-z0-9_-]', '-'), $Round)
[IO.File]::WriteAllText($path, (($out -join "`n") + "`n"), $utf8)

[ordered]@{
    path      = $path -replace '\\', '/'
    tree      = $tree
    head      = $head
    since     = if ($Since) { $Since } else { $null }
    files     = $changed.Count + $added.Count
    new_files = $added
    lines     = $out.Count
    cut       = $cut
} | ConvertTo-Json -Compress
