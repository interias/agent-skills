<#
.SYNOPSIS
    Creates and removes /epic worktrees: env files copied, dependency folders linked, every
    step checked.

.DESCRIPTION
    Add: creates a git worktree at -WorktreePath on -Branch (reused when it exists, otherwise
    created from -From), copies -EnvFiles from the main checkout, sets -SetEnv variables in the
    copies, and links each -LinkDirs folder to its counterpart in the main checkout (Windows:
    directory junction, elsewhere: symlink). Each link is verified to be a link to the expected
    target - a copied folder is an error, not a success. The links are recorded in a manifest in
    the worktree's git dir, which `git status` does not see and `git worktree remove` deletes.

    Remove: refuses a dirty worktree, removes the links from the manifest one by one without
    recursion, refuses to go on while any reparse point is left, runs `git worktree remove`
    without --force, and only then deletes what is left of the folder. A recursive delete
    through a junction destroys the main checkout's node_modules (KOKOS, 2026-09-18).

    The script never installs dependencies, never deletes branches and never uses --force.
    Any deviation ends with exit code 1 and a message on stderr; nothing is guessed.

    Array parameters accept comma-separated strings, because `powershell -File` passes an
    array argument as one string.

.PARAMETER Action
    Add or Remove.

.PARAMETER RepoRoot
    Absolute path of the main checkout. Links point there; env files are copied from there.

.PARAMETER WorktreePath
    Absolute path of the worktree. Must not exist for Add.

.PARAMETER Branch
    Add only. Branch to check out. Reused when it exists; otherwise created from -From.

.PARAMETER From
    Add only. Start point for a new branch, e.g. the current epic head.

.PARAMETER LinkDirs
    Add only. Folders relative to the repo root to link, e.g. server/node_modules.

.PARAMETER EnvFiles
    Add only. Files relative to the repo root to copy, e.g. server/.env.

.PARAMETER SetEnv
    Add only. Entries of the form <env file>:<NAME>=<value>, e.g. server/.env:TEST_DB_SUFFIX=494.
    Replaces the NAME line in the copied file, or appends it. The file must be in -EnvFiles.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File worktree.ps1 -Action Add -RepoRoot C:\src\app -WorktreePath C:\src\app-worktrees\494 -Branch agent/494-slug -From epic/490-slug -LinkDirs server/node_modules,client/node_modules -EnvFiles server/.env -SetEnv server/.env:TEST_DB_SUFFIX=494

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File worktree.ps1 -Action Remove -RepoRoot C:\src\app -WorktreePath C:\src\app-worktrees\494
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Add', 'Remove')][string]$Action,
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)][string]$WorktreePath,
    [string]$Branch,
    [string]$From,
    [string[]]$LinkDirs = @(),
    [string[]]$EnvFiles = @(),
    [string[]]$SetEnv = @()
)

$ErrorActionPreference = 'Stop'
$onWindows = $PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows
$manifestName = 'epic-links.json'

function Fail([string]$message) {
    [Console]::Error.WriteLine("worktree.ps1: $message")
    exit 1
}

# `powershell -File` hands an array argument over as one comma-separated string.
function Split-List([string[]]$values) {
    @($values | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Invoke-Git([string[]]$arguments) {
    $output = & git @arguments
    if ($LASTEXITCODE -ne 0) { Fail "git $($arguments -join ' ') failed (exit $LASTEXITCODE)." }
    $output
}

function Get-FullPath([string]$path) {
    [IO.Path]::GetFullPath($path).TrimEnd('\', '/')
}

function Test-ReparsePoint([string]$path) {
    [bool]((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Get-LinkTarget([string]$path) {
    $target = @((Get-Item -LiteralPath $path -Force).Target)[0]
    if (-not $target) { return $null }
    # Junction targets can come back with the \??\ prefix of the raw reparse data.
    Get-FullPath ($target -replace '^\\\?\?\\', '')
}

function Get-ReparsePoints([string]$path) {
    @(Get-ChildItem -LiteralPath $path -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue)
}

function Get-ManifestPath([string]$worktree) {
    $gitDir = Invoke-Git @('-C', $worktree, 'rev-parse', '--absolute-git-dir')
    Join-Path $gitDir $manifestName
}

function Save-Manifest([string]$path, $links) {
    $json = ConvertTo-Json -InputObject @{ links = @($links) } -Depth 3
    [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding $false))
}

foreach ($p in @($RepoRoot, $WorktreePath)) {
    if (-not [IO.Path]::IsPathRooted($p)) { Fail "'$p' is not an absolute path. Relative paths break once the shell's working directory moves." }
}
$RepoRoot = Get-FullPath $RepoRoot
$WorktreePath = Get-FullPath $WorktreePath
$LinkDirs = Split-List $LinkDirs
$EnvFiles = Split-List $EnvFiles
$SetEnv = Split-List $SetEnv

if ($Action -eq 'Add') {
    if (-not $Branch) { Fail 'Add needs -Branch.' }
    if (Test-Path -LiteralPath $WorktreePath) { Fail "$WorktreePath already exists. Not reusing or overwriting it." }

    # Check every input before the worktree exists, so a bad call leaves nothing behind.
    foreach ($dir in $LinkDirs) {
        $target = Join-Path $RepoRoot $dir
        if (-not (Test-Path -LiteralPath $target -PathType Container)) { Fail "Link target $target does not exist in the main checkout." }
    }
    foreach ($file in $EnvFiles) {
        $source = Join-Path $RepoRoot $file
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { Fail "Env file $source does not exist in the main checkout." }
    }
    $envSettings = foreach ($entry in $SetEnv) {
        if ($entry -notmatch '^(?<file>[^:]+):(?<name>[A-Za-z_][A-Za-z0-9_]*)=(?<value>.*)$') { Fail "-SetEnv entry '$entry' is not of the form <env file>:<NAME>=<value>." }
        if ($EnvFiles -notcontains $Matches.file) { Fail "-SetEnv names '$($Matches.file)', which is not in -EnvFiles." }
        [pscustomobject]@{ File = $Matches.file; Name = $Matches.name; Value = $Matches.value }
    }

    & git -C $RepoRoot rev-parse --verify --quiet "refs/heads/$Branch" | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Invoke-Git @('-C', $RepoRoot, 'worktree', 'add', $WorktreePath, $Branch) | Out-Null
    } else {
        if (-not $From) { Fail "Branch $Branch does not exist and no -From was given." }
        Invoke-Git @('-C', $RepoRoot, 'worktree', 'add', $WorktreePath, '-b', $Branch, $From) | Out-Null
    }

    foreach ($file in $EnvFiles) {
        $dest = Join-Path $WorktreePath $file
        if (Test-Path -LiteralPath $dest) { Fail "$dest is already in the worktree (tracked?). Not overwriting it." }
        Copy-Item -LiteralPath (Join-Path $RepoRoot $file) -Destination $dest
    }
    foreach ($setting in $envSettings) {
        $dest = Join-Path $WorktreePath $setting.File
        $text = [IO.File]::ReadAllText($dest)
        $line = "$($setting.Name)=$($setting.Value)"
        $pattern = "(?m)^$([regex]::Escape($setting.Name))=.*$"
        if ($text -match $pattern) {
            $text = [regex]::Replace($text, $pattern, $line.Replace('$', '$$'))
        } else {
            if ($text -and -not $text.EndsWith("`n")) { $text += [Environment]::NewLine }
            $text += $line + [Environment]::NewLine
        }
        [IO.File]::WriteAllText($dest, $text, (New-Object Text.UTF8Encoding $false))
    }

    # The manifest is written after every link, so a failure halfway still lets Remove find them.
    $manifestPath = Get-ManifestPath $WorktreePath
    $links = @()
    Save-Manifest $manifestPath $links
    foreach ($dir in $LinkDirs) {
        $link = Join-Path $WorktreePath $dir
        $target = Get-FullPath (Join-Path $RepoRoot $dir)
        if (Test-Path -LiteralPath $link) { Fail "$link already exists in the worktree. Not linking over it." }
        $parent = Split-Path -Parent $link
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
        $type = if ($onWindows) { 'Junction' } else { 'SymbolicLink' }
        New-Item -ItemType $type -Path $link -Target $target | Out-Null
        $links += [pscustomobject]@{ path = $link; target = $target }
        Save-Manifest $manifestPath $links
    }

    foreach ($entry in $links) {
        if (-not (Test-Path -LiteralPath $entry.path)) { Fail "$($entry.path) is missing after linking." }
        if (-not (Test-ReparsePoint $entry.path)) { Fail "$($entry.path) is a real folder, not a link (copied instead of linked?). Stop the package and report it; do not fix it by hand." }
        $actual = Get-LinkTarget $entry.path
        if ($actual -ne $entry.target) { Fail "$($entry.path) points to '$actual', expected '$($entry.target)'." }
    }

    Write-Host "Worktree ready: $WorktreePath on $Branch, $($links.Count) link(s), $($EnvFiles.Count) env file(s)."
    exit 0
}

# Remove
if (-not (Test-Path -LiteralPath $WorktreePath)) { Fail "$WorktreePath does not exist." }

# 1. Clean? A dirty worktree stays for a human to look at.
$status = Invoke-Git @('-C', $WorktreePath, 'status', '--porcelain')
if ($status) { Fail "$WorktreePath is not clean. Leaving it in place; the package counts as not accepted:`n$($status -join "`n")" }

# 2. Remove the links this run created, one by one, never recursively.
$manifestPath = Get-ManifestPath $WorktreePath
if (-not (Test-Path -LiteralPath $manifestPath)) { Fail "No manifest at $manifestPath - this worktree was not created by worktree.ps1. Nothing removed." }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
foreach ($entry in @($manifest.links)) {
    if (-not (Test-Path -LiteralPath $entry.path)) { continue }
    if (-not (Test-ReparsePoint $entry.path)) { Fail "$($entry.path) is listed as a link but is a real folder. Nothing removed from here on." }
    $before = @(Get-ChildItem -LiteralPath $entry.target -Force).Count
    # recursive=false cannot walk through the link: either the link goes, or the call throws.
    [IO.Directory]::Delete($entry.path, $false)
    if (Test-Path -LiteralPath $entry.path) { Fail "$($entry.path) is still there after removing the link." }
    $after = @(Get-ChildItem -LiteralPath $entry.target -Force).Count
    if ($after -ne $before) { Fail "$($entry.target) had $before entries before removing the link and $after after. Check the main checkout now." }
}

# 3. No reparse point may be left before anything is deleted recursively.
$left = Get-ReparsePoints $WorktreePath
if ($left) { Fail "Reparse points this run did not create are left; nothing deleted:`n$(($left | ForEach-Object FullName) -join "`n")" }

# 4. Let git remove the worktree, without --force.
Invoke-Git @('-C', $RepoRoot, 'worktree', 'remove', $WorktreePath) | Out-Null

# 5. Whatever git left behind goes only after a fresh check for reparse points.
if (Test-Path -LiteralPath $WorktreePath) {
    $left = Get-ReparsePoints $WorktreePath
    if ($left) { Fail "Reparse points left in the shell of ${WorktreePath}; not deleting it:`n$(($left | ForEach-Object FullName) -join "`n")" }
    Remove-Item -LiteralPath $WorktreePath -Recurse -Force -Confirm:$false
}

Write-Host "Worktree removed: $WorktreePath"
exit 0
