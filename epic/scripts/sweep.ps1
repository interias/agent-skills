<#
.SYNOPSIS
    Clears what runs leave behind outside a single repository: worktrees of dead sessions in every
    repository under -Root, stale temp folders, dangling docker images and old build cache.

.DESCRIPTION
    CleanupStale of worktree.ps1 only runs at the start of /epic and /epic-aufraeumen, and only
    for that one repository; nothing looked at temp folders or docker at all (found 2026-11-12:
    epic worktrees of dead sessions two weeks old in three repositories, 142 jest caches and 79
    headless browser profiles in the temp folder, 47 dangling images, 14 GB build cache). This
    script is the sweep over all of it. Three steps, each reported, none aborts the others:

    1. Repositories: every folder directly under -Root that is a main checkout (.git is a folder)
       and has .claude/epic.md with frontmatter gets `worktree.ps1 -Action CleanupStale`. Its
       entries are passed on with the repository name in `repo`. What CleanupStale protects stays
       protected: locks of living sessions, worktrees without lock, dirty worktrees.
    2. Temp: folders under -TempRoot older than -TempDays that match HeadlessEdg*, repo-guard-* or
       jest\jest-transform-cache-* are removed, and every swap.vhdx in a GUID folder except the
       newest one when no process holds it (WSL creates a new one per start and leaves the old).
       A folder with a reparse point inside is never removed: a recursive delete follows a
       junction into its target (references/worktree.md, KOKOS 2026-09-18).
    3. Docker (PATH, otherwise a running WSL distribution; WSL is never started): `docker image
       prune -f` removes dangling images, `docker builder prune -f --filter until=<hours>h` the
       build cache older than -BuildCacheDays. Tagged images, volumes and containers stay.

    stdout carries exactly one JSON array; each entry has kind (repo, lock, process, compose,
    worktree, temp, swap, docker), id, path, action (removed, stopped, skipped, failed), reason and,
    for step 1, repo. Messages go to stderr. Exit 1 when an entry failed, otherwise 0.

.PARAMETER Root
    Folder that holds the repositories, e.g. C:\Users\me\git.

.PARAMETER TempRoot
    Temp folder to sweep. Default: the temp folder of the user.

.PARAMETER TempDays
    Age in days from which a matching temp folder is removed. Default 7.

.PARAMETER BuildCacheDays
    Age in days from which docker build cache is removed. Default 7.

.PARAMETER SkipDocker
    Leaves docker alone.

.PARAMETER DryRun
    Removes nothing and calls neither CleanupStale nor a docker prune; reports what it would do.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File sweep.ps1 -Root C:\Users\me\git -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Root,
    [string]$TempRoot = [IO.Path]::GetTempPath(),
    [int]$TempDays = 7,
    [int]$BuildCacheDays = 7,
    [switch]$SkipDocker,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$entries = New-Object System.Collections.ArrayList
$would = if ($DryRun) { 'would be ' } else { '' }

function Add-Entry([string]$kind, $id, $path, [string]$action, [string]$reason, $repo = $null) {
    [void]$entries.Add([pscustomobject][ordered]@{ kind = $kind; id = $id; path = $path; action = $action; reason = $reason; repo = $repo })
}

if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    [Console]::Error.WriteLine("sweep.ps1: -Root $Root is not a folder.")
    exit 1
}

# 1. Repositories
$worktreeScript = Join-Path $PSScriptRoot 'worktree.ps1'
foreach ($repo in @(Get-ChildItem -LiteralPath $Root -Directory)) {
    $adapter = Join-Path $repo.FullName '.claude\epic.md'
    if (-not (Test-Path -LiteralPath (Join-Path $repo.FullName '.git') -PathType Container)) { continue }
    if (-not (Test-Path -LiteralPath $adapter -PathType Leaf)) { continue }
    if ("$(Get-Content -LiteralPath $adapter -TotalCount 1)".Trim() -ne '---') { continue }
    if ($DryRun) { Add-Entry 'repo' $repo.Name $repo.FullName 'skipped' 'dry run: CleanupStale not called' $repo.Name; continue }
    $errFile = [IO.Path]::GetTempFileName()
    try {
        $ErrorActionPreference = 'Continue'   # stderr of the child must not end this script
        $out = & (Get-Process -Id $PID).Path -NoProfile -ExecutionPolicy Bypass -File $worktreeScript -Action CleanupStale -RepoRoot $repo.FullName 2>$errFile
        $code = $LASTEXITCODE
        $json = @($out | Where-Object { "$_".StartsWith('[') })[-1]
        if ($json) {
            # PowerShell 5.1 emits a JSON array as one object; ForEach-Object unrolls it.
            foreach ($e in @($json | ConvertFrom-Json | ForEach-Object { $_ })) { Add-Entry $e.kind $e.id $e.path $e.action $e.reason $repo.Name }
        }
        if ($code -ne 0 -and -not @($entries | Where-Object { $_.repo -eq $repo.Name -and $_.action -eq 'failed' })) {
            Add-Entry 'repo' $repo.Name $repo.FullName 'failed' ("CleanupStale exit ${code}: " + ((Get-Content -LiteralPath $errFile -Raw) -replace '\s+', ' ')) $repo.Name
        }
    } finally {
        $ErrorActionPreference = 'Stop'
        Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue
    }
}

# 2. Temp
function Remove-OldFolders([string]$dir, [string]$filter) {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return }
    $limit = (Get-Date).AddDays(-$TempDays)
    $count = 0; $bytes = 0; $kept = @()
    foreach ($folder in @(Get-ChildItem -LiteralPath $dir -Directory -Filter $filter -Force | Where-Object { $_.LastWriteTime -lt $limit })) {
        try {
            if (($folder.Attributes -band [IO.FileAttributes]::ReparsePoint) -or @(Get-ChildItem -LiteralPath $folder.FullName -Recurse -Force -Attributes ReparsePoint)) {
                $kept += "$($folder.Name): reparse point inside"
                continue
            }
            $size = (Get-ChildItem -LiteralPath $folder.FullName -Recurse -Force -File | Measure-Object Length -Sum).Sum
            if (-not $DryRun) { Remove-Item -LiteralPath $folder.FullName -Recurse -Force -Confirm:$false }
            $count++; $bytes += $size
        } catch {
            $kept += "$($folder.Name): $($_.Exception.Message)"
        }
    }
    $id = Join-Path (Split-Path -Leaf $dir) $filter
    if ($count) { Add-Entry 'temp' $id $dir 'removed' "$count folder(s) older than $TempDays days ${would}removed, $([math]::Round($bytes / 1MB)) MB" }
    if ($kept) { Add-Entry 'temp' $id $dir 'skipped' ("$($kept.Count) folder(s) left: " + (($kept | Select-Object -First 3) -join '; ')) }
}

if (Test-Path -LiteralPath $TempRoot -PathType Container) {
    Remove-OldFolders $TempRoot 'HeadlessEdg*'
    Remove-OldFolders $TempRoot 'repo-guard-*'
    Remove-OldFolders (Join-Path $TempRoot 'jest') 'jest-transform-cache-*'

    # WSL swap files: the newest belongs to the running (or next) VM, an older one is a leftover.
    $swaps = @(Get-ChildItem -LiteralPath $TempRoot -Directory -Force |
        Where-Object { $_.Name -match '^\{?[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}\}?$' } |
        ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -File -Filter 'swap.vhdx' -Force } |
        Sort-Object LastWriteTime -Descending)
    foreach ($swap in @($swaps | Select-Object -Skip 1)) {
        try {
            # Opening without sharing fails while a VM holds the file.
            ([IO.File]::Open($swap.FullName, 'Open', 'ReadWrite', 'None')).Close()
            $size = $swap.Length
            if (-not $DryRun) {
                Remove-Item -LiteralPath $swap.FullName -Force -Confirm:$false
                if (-not @(Get-ChildItem -LiteralPath $swap.DirectoryName -Force)) { [IO.Directory]::Delete($swap.DirectoryName, $false) }
            }
            Add-Entry 'swap' $swap.Directory.Name $swap.FullName 'removed' "stale WSL swap file ${would}removed, $([math]::Round($size / 1MB)) MB"
        } catch {
            Add-Entry 'swap' $swap.Directory.Name $swap.FullName 'skipped' "in use or not removable: $($_.Exception.Message)"
        }
    }
}

# 3. Docker. The command lookup is copied from worktree.ps1; this script must not depend on its
# internals: docker from PATH, otherwise docker in a running WSL distribution, never a started one.
function Get-DockerCommand {
    $docker = @(Get-Command docker -CommandType Application -ErrorAction SilentlyContinue)[0]
    if ($docker) { return @{ Exe = $docker.Source; Prefix = @() } }
    $wsl = @(Get-Command wsl -CommandType Application -ErrorAction SilentlyContinue)[0]
    if (-not $wsl) { return $null }
    # wsl.exe writes UTF-16; read in the console code page, every other byte is a NUL.
    $running = @(& $wsl.Source --list --running --quiet | ForEach-Object { "$_".Replace("`0", '').Trim() } | Where-Object { $_ -match '^[\w.-]+$' })
    if ($LASTEXITCODE -ne 0) { return $null }
    foreach ($distro in $running) {
        $candidate = @{ Exe = $wsl.Source; Prefix = @('-d', $distro, '-e', 'docker') }
        & $candidate.Exe @($candidate.Prefix + @('ps', '-q')) | Out-Null
        if ($LASTEXITCODE -eq 0) { return $candidate }
    }
    $null
}

if (-not $SkipDocker) {
    $ErrorActionPreference = 'Continue'   # docker writes progress to stderr
    $docker = Get-DockerCommand
    if (-not $docker) {
        Add-Entry 'docker' $null $null 'skipped' 'docker not reachable (not on PATH, no running WSL distribution with docker)'
    } elseif ($DryRun) {
        $dangling = @(& $docker.Exe @($docker.Prefix + @('images', '-f', 'dangling=true', '-q')) | Where-Object { $_ }).Count
        Add-Entry 'docker' 'image prune' $null 'skipped' "dry run: $dangling dangling image(s) would be removed"
        Add-Entry 'docker' 'builder prune' $null 'skipped' "dry run: build cache older than $BuildCacheDays days would be removed"
    } else {
        foreach ($step in @(
                @{ Id = 'image prune'; Args = @('image', 'prune', '-f') },
                @{ Id = 'builder prune'; Args = @('builder', 'prune', '-f', '--filter', "until=$($BuildCacheDays * 24)h") })) {
            $out = @(& $docker.Exe @($docker.Prefix + $step.Args) 2>$null | ForEach-Object { "$_" })
            if ($LASTEXITCODE -ne 0) { Add-Entry 'docker' $step.Id $null 'failed' "docker $($step.Args -join ' ') exit $LASTEXITCODE"; continue }
            $total = @($out | Where-Object { $_ -match '^Total' })[-1]
            Add-Entry 'docker' $step.Id $null 'removed' $(if ($total) { $total } else { 'nothing reported' })
        }
    }
}

$failed = @($entries | Where-Object { $_.action -eq 'failed' }).Count
$done = @($entries | Where-Object { $_.action -in @('removed', 'stopped') }).Count
[Console]::Error.WriteLine("sweep.ps1: $done removed or stopped, $failed failed, $($entries.Count - $done - $failed) skipped.")
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @($entries) -Depth 3 -Compress))
if ($failed) { exit 1 }
exit 0
