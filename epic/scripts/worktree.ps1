<#
.SYNOPSIS
    Creates and removes /epic worktrees: env files copied, dependency folders linked, every
    step checked.

.DESCRIPTION
    Up: reads the YAML frontmatter of .claude/epic.md in -RepoRoot (worktree_root, link_dirs,
    always_link, env_files, test_isolation_env, port_env; unknown keys are ignored, missing keys
    take the defaults of epic/references/adapter.md) and then does what Add does at
    <worktree_root>/<Package>. In every copied env file it sets test_isolation_env to the package
    number, port_env to a free port (when the adapter names one) and COMPOSE_PROJECT_NAME to
    <repo>-<Package>. It writes a lock file to <git common dir>/epic-locks/<Package>.json, outside
    every worktree, so `git status` stays clean and a later cleanup finds all locks of the repo in
    one folder. stdout carries exactly one JSON object (path, branch, port, isolation, project,
    envFiles, lock, sessionPid, warnings); every message goes to stderr. Without an adapter or
    without frontmatter, Up stops with exit 1 and names what is missing.

    Down: stops what clearly belongs to <worktree_root>/<Package>, then does what Remove does and
    deletes the lock. Clearly belongs means: compose projects named <repo>-<Package> or whose
    com.docker.compose.project.working_dir lies in the worktree (`docker compose -p <name> down`,
    docker from PATH; without docker the compose step is skipped and reported, not an error), and
    processes whose command line, executable or working directory lies in the worktree. Paths are
    compared case-insensitively and only at a separator, so ...\35 never matches ...\350. The
    calling process and its ancestors are never stopped. Unless the path is a linked worktree of
    -RepoRoot with a manifest, Down stops nothing and ends with exit 1. Down reports every stopped
    project and process on stdout.

    CleanupStale (#36): clears what a dead session left behind, run at the start of every /epic and
    /epic-aufraeumen. It never merges, never starts an agent and never deletes a dirty worktree.
    - A lock in <git common dir>/epic-locks whose session is dead goes the way of Down (run as a
      child process). Dead means: the PID does not run, or it runs with a start time other than
      sessionStarted (the PID was reused). A dirty worktree stays, as do its lock and branch; it is
      reported with path, branch and reason (its processes are already stopped, as in Down). A lock
      whose worktree folder is gone or no longer registered: compose and processes of that path are
      stopped, a registered entry without folder is pruned (`git worktree prune`), the lock goes.
    - A lock whose session lives is left alone.
    - Narrowed reading of #36 AC 2: a worktree registered in `git worktree list` without a lock (the
      epic worktree epic-<nr>, or a package created by Add) is not touched - no process stopped, no
      compose project, nothing removed - and is reported as skipped with "no lock (epic worktree or
      created by Add)". Read literally, AC 2 would stop the test processes of every parallel run.
    - Orphans are stopped: processes whose command line, executable or working directory lies in
      <worktree_root>/<name>, and compose projects named <repo>-<name> or whose working_dir lies
      there, where <name> looks like a package (494, 490-p2, epic-490), is not the main checkout,
      is no registered worktree, has no lock left and is no repo or worktree of another repo (a
      .git directory, or a .git file naming a gitdir outside this repo). Anything else under
      worktree_root is not attributable to a run and stays untouched; a lock never makes such a
      folder a target either.
    Without docker on PATH the compose part is skipped and reported, not an error.
    stdout carries exactly one JSON array; each entry has kind (lock, process, compose, worktree),
    id, path, branch, action (stopped, removed, skipped) and reason. "Nothing to do" means no entry
    with stopped or removed; the list may still hold skipped entries (living locks, worktrees
    without lock, dirty worktrees), and stderr then says "CleanupStale: nothing to do". A step that
    fails is recorded as skipped with reason "failed: ...", the run goes on, and the exit code is 1;
    otherwise 0, a dirty worktree included.

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

    The script never installs dependencies, never deletes branches, never merges, never starts
    an agent and never uses --force.
    Any deviation ends with exit code 1 and a message on stderr; nothing is guessed.

    Array parameters accept comma-separated strings, because `powershell -File` passes an
    array argument as one string.

.PARAMETER Action
    Up, Down, CleanupStale, Add or Remove. Add and Remove take every path and setting as
    parameters and stay as aliases of the older call form. CleanupStale takes only -RepoRoot.

.PARAMETER RepoRoot
    Absolute path of the main checkout. Links point there; env files are copied from there.

.PARAMETER WorktreePath
    Add and Remove only. Absolute path of the worktree. Must not exist for Add. Up and Down
    derive it as <worktree_root>/<Package>.

.PARAMETER Package
    Up and Down only. Package number, e.g. 494 (or epic-490 for the epic worktree).

.PARAMETER SessionPid
    Up only. PID written to the lock as the owner of the package. It must outlive the package:
    the shell that runs this script exits right after the call, and a lock with its PID would
    look dead at once. Default: the nearest ancestor process named claude, i.e. the Claude Code
    session that runs the epic. Without such an ancestor, Up stops and asks for -SessionPid.

.PARAMETER Branch
    Add and Up. Branch to check out. Reused when it exists; otherwise created from -From.

.PARAMETER From
    Add and Up. Start point for a new branch, e.g. the current epic head.

.PARAMETER LinkDirs
    Add only. Folders relative to the repo root to link, e.g. server/node_modules.

.PARAMETER EnvFiles
    Add only. Files relative to the repo root to copy, e.g. server/.env.

.PARAMETER SetEnv
    Add only. Entries of the form <env file>:<NAME>=<value>, e.g. server/.env:TEST_DB_SUFFIX=494.
    Replaces the NAME line in the copied file, or appends it. The file must be in -EnvFiles.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File worktree.ps1 -Action Up -RepoRoot C:\src\app -Package 494 -Branch agent/494-slug -From epic/490-slug

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File worktree.ps1 -Action Down -RepoRoot C:\src\app -Package 494

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File worktree.ps1 -Action CleanupStale -RepoRoot C:\src\app

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File worktree.ps1 -Action Add -RepoRoot C:\src\app -WorktreePath C:\src\app-worktrees\494 -Branch agent/494-slug -From epic/490-slug -LinkDirs server/node_modules,client/node_modules -EnvFiles server/.env -SetEnv server/.env:TEST_DB_SUFFIX=494

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File worktree.ps1 -Action Remove -RepoRoot C:\src\app -WorktreePath C:\src\app-worktrees\494
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Up', 'Down', 'CleanupStale', 'Add', 'Remove')][string]$Action,
    [Parameter(Mandatory)][string]$RepoRoot,
    [string]$WorktreePath,
    [string]$Package,
    [int]$SessionPid = 0,
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

function ConvertFrom-YamlScalar([string]$text) {
    $text = $text.Trim()
    if ($text -match '^(["''])(?<inner>.*)\1$') { return $Matches.inner }
    $text = ($text -replace '\s+#.*$', '').Trim()
    if ($text -match '^(["''])(?<inner>.*)\1$') { return $Matches.inner }
    if (-not $text) { return $null }
    if ($text -match '^\[(?<items>.*)\]$') {
        return , @($Matches.items -split ',' | ForEach-Object { $_.Trim().Trim('"', "'") } | Where-Object { $_ })
    }
    $text
}

# Reads the flat YAML frontmatter of the adapter: `key: value`, `key: [a, b]` and `- item` lists.
# Nested maps such as test_commands are skipped; this script does not need them.
function Read-Adapter([string]$repo) {
    $path = Join-Path $repo '.claude\epic.md'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $old = Join-Path $repo '.claude\prd.md'
        if (-not (Test-Path -LiteralPath $old -PathType Leaf)) { Fail "No adapter at $path. $Action reads worktree_root, link_dirs, env_files, test_isolation_env and port_env from its YAML frontmatter; nothing is guessed." }
        [Console]::Error.WriteLine("worktree.ps1: reading the adapter under its old name $old; rename it to .claude/epic.md.")
        $path = $old
    }
    $lines = [IO.File]::ReadAllLines($path)
    $end = -1
    if ($lines.Count -gt 0 -and $lines[0].Trim() -eq '---') {
        for ($i = 1; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -eq '---') { $end = $i; break } }
    }
    if ($end -lt 0) { Fail "$path has no YAML frontmatter (a block between two --- lines at the top). $Action reads worktree_root, link_dirs, env_files, test_isolation_env and port_env from it; nothing is guessed." }
    $keys = @{}
    $current = $null
    for ($i = 1; $i -lt $end; $i++) {
        $line = $lines[$i]
        if ($line -match '^\s*(#|$)') { continue }
        if ($line -match '^(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*:(?<value>.*)$') {
            $current = $Matches.key
            $keys[$current] = ConvertFrom-YamlScalar $Matches.value
        } elseif ($current -and $line -match '^\s*-\s+(?<item>.+)$') {
            $item = ConvertFrom-YamlScalar $Matches.item
            if ($null -eq $keys[$current]) { $keys[$current] = @($item) } else { $keys[$current] = @($keys[$current]) + $item }
        }
        # Any other indented line belongs to a nested map and is skipped.
    }
    $keys
}

function Get-WorktreeRoot($adapter, [string]$repo) {
    $root = $adapter['worktree_root']
    if (-not $root) { $root = "../$(Split-Path -Leaf $repo)-worktrees" }
    if (-not [IO.Path]::IsPathRooted($root)) { $root = Join-Path $repo $root }
    Get-FullPath $root
}

function Get-ComposeProjectName([string]$repo, [string]$package) {
    # Compose accepts lowercase letters, digits, dashes and underscores.
    "$(Split-Path -Leaf $repo)-$package".ToLowerInvariant() -replace '[^a-z0-9_-]', '-'
}

function Get-LockPath([string]$repo, [string]$package) {
    $common = Invoke-Git @('-C', $repo, 'rev-parse', '--git-common-dir')
    if (-not [IO.Path]::IsPathRooted($common)) { $common = Join-Path $repo $common }
    Join-Path (Get-FullPath $common) "epic-locks\$package.json"
}

function Get-ParentPid([int]$id) {
    if ($onWindows) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
        if ($p) { return [int]$p.ParentProcessId }
        return 0
    }
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p -and $p.Parent) { return [int]$p.Parent.Id }
    0
}

# The calling process and all its ancestors, so Down never stops the shell or session that runs it.
function Get-AncestorPids {
    $ids = @($PID)
    $id = $PID
    for ($i = 0; $i -lt 64; $i++) {
        $parent = Get-ParentPid $id
        if ($parent -le 0 -or $ids -contains $parent) { break }
        $ids += $parent
        $id = $parent
    }
    $ids
}

function Find-SessionPid {
    foreach ($id in @(Get-AncestorPids | Select-Object -Skip 1)) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -eq 'claude') { return [int]$id }
    }
    0
}

function Get-FreePort {
    # Port 0 lets the OS hand out a port that is free right now.
    $listener = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}

$sep = [IO.Path]::DirectorySeparatorChar

function Test-UnderPath([string]$candidate, [string]$root) {
    if (-not $candidate) { return $false }
    if ($onWindows) { $candidate = $candidate -replace '/', '\' }
    $candidate = $candidate.TrimEnd($sep)
    $candidate.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
        $candidate.StartsWith("$root$sep", [StringComparison]::OrdinalIgnoreCase)
}

function Test-CommandLineUnderPath([string]$commandLine, [string]$root) {
    if (-not $commandLine) { return $false }
    if ($onWindows) { $commandLine = $commandLine -replace '/', '\' }
    # The path must end at a separator, a quote, whitespace or the end: ...\35 never matches ...\350.
    $commandLine -match ('(?i)' + [regex]::Escape($root) + '(?=[\\/"''\s]|$)')
}

function Get-ProcessCwd([int]$id) {
    if (-not $onWindows) {
        try { return (Get-Item -LiteralPath "/proc/$id/cwd" -Force -ErrorAction Stop).Target } catch { return $null }
    }
    if (-not ('EpicProcessCwd' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EpicProcessCwd {
    [StructLayout(LayoutKind.Sequential)]
    struct BasicInfo { public IntPtr ExitStatus; public IntPtr PebBaseAddress; public IntPtr Affinity; public IntPtr BasePriority; public IntPtr UniqueProcessId; public IntPtr ParentProcessId; }
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern bool IsWow64Process(IntPtr handle, out bool wow64);
    [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr handle, IntPtr address, byte[] buffer, IntPtr size, out IntPtr read);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle, int infoClass, ref BasicInfo info, int size, out int returned);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle, int infoClass, out IntPtr info, int size, out int returned);

    static byte[] Read(IntPtr handle, long address, int size) {
        byte[] buffer = new byte[size];
        IntPtr read;
        if (!ReadProcessMemory(handle, new IntPtr(address), buffer, new IntPtr(size), out read) || read.ToInt64() != size) return null;
        return buffer;
    }

    // Current directory from the process parameters in the PEB; null when it cannot be read.
    public static string Get(int pid) {
        if (IntPtr.Size != 8) return null;
        IntPtr handle = OpenProcess(0x0410, false, pid);
        if (handle == IntPtr.Zero) return null;
        try {
            bool wow64;
            int returned, length;
            long buffer;
            if (IsWow64Process(handle, out wow64) && wow64) {
                IntPtr peb32;
                if (NtQueryInformationProcess(handle, 26, out peb32, IntPtr.Size, out returned) != 0 || peb32 == IntPtr.Zero) return null;
                byte[] parameters = Read(handle, peb32.ToInt64() + 0x10, 4);
                if (parameters == null) return null;
                byte[] text = Read(handle, BitConverter.ToUInt32(parameters, 0) + 0x24, 8);
                if (text == null) return null;
                length = BitConverter.ToUInt16(text, 0);
                buffer = BitConverter.ToUInt32(text, 4);
            } else {
                BasicInfo info = new BasicInfo();
                if (NtQueryInformationProcess(handle, 0, ref info, Marshal.SizeOf(info), out returned) != 0) return null;
                byte[] parameters = Read(handle, info.PebBaseAddress.ToInt64() + 0x20, 8);
                if (parameters == null) return null;
                byte[] text = Read(handle, BitConverter.ToInt64(parameters, 0) + 0x38, 16);
                if (text == null) return null;
                length = BitConverter.ToUInt16(text, 0);
                buffer = BitConverter.ToInt64(text, 8);
            }
            if (length == 0 || length > 65534) return null;
            byte[] chars = Read(handle, buffer, length);
            return chars == null ? null : System.Text.Encoding.Unicode.GetString(chars);
        } finally { CloseHandle(handle); }
    }
}
'@
    }
    [EpicProcessCwd]::Get($id)
}

function Get-WorktreeProcesses([string]$root) {
    $skip = Get-AncestorPids
    $all = if ($onWindows) {
        Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ Id = [int]$_.ProcessId; Name = $_.Name; CommandLine = $_.CommandLine; Path = $_.ExecutablePath } }
    } else {
        Get-Process | ForEach-Object { [pscustomobject]@{ Id = $_.Id; Name = $_.ProcessName; CommandLine = $_.CommandLine; Path = $_.Path } }
    }
    foreach ($p in $all) {
        if ($p.Id -le 4 -or $skip -contains $p.Id) { continue }
        if ((Test-CommandLineUnderPath $p.CommandLine $root) -or (Test-UnderPath $p.Path $root) -or (Test-UnderPath (Get-ProcessCwd $p.Id) $root)) { $p }
    }
}

# Compose containers as Name and WorkingDir. Reachable is false, and reported, without docker.
function Get-ComposeProjects {
    if (-not (Get-Command docker -CommandType Application -ErrorAction SilentlyContinue)) {
        Write-Host 'Compose skipped: docker not reachable (not on PATH).'
        return @{ Reachable = $false; Reason = 'docker not reachable (not on PATH)'; Projects = @() }
    }
    $ids = @(& docker ps -a -q --filter label=com.docker.compose.project)
    if ($LASTEXITCODE -ne 0) {
        $reason = "docker not reachable (docker ps exit $LASTEXITCODE)"
        Write-Host "Compose skipped: $reason."
        return @{ Reachable = $false; Reason = $reason; Projects = @() }
    }
    $ids = @($ids | Where-Object { $_ })
    $projects = @()
    if ($ids) {
        $inspect = (& docker inspect @ids) | Out-String
        if ($LASTEXITCODE -ne 0) { Fail "docker inspect failed (exit $LASTEXITCODE). Nothing removed." }
        # PowerShell 5.1 emits a JSON array as one object; ForEach-Object unrolls it.
        foreach ($container in @($inspect | ConvertFrom-Json | ForEach-Object { $_ })) {
            $labels = $container.Config.Labels
            $name = $labels.'com.docker.compose.project'
            if ($name) { $projects += [pscustomobject]@{ Name = $name; WorkingDir = $labels.'com.docker.compose.project.working_dir' } }
        }
    }
    @{ Reachable = $true; Projects = $projects }
}

function Stop-ComposeProject([string]$name) {
    & docker compose -p $name down | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "docker compose -p $name down failed (exit $LASTEXITCODE). Nothing removed." }
    Write-Host "Stopped compose project $name."
}

function Stop-WorktreeCompose([string]$root, [string]$project) {
    $compose = Get-ComposeProjects
    if (-not $compose.Reachable) { return }
    $names = @($compose.Projects | Where-Object { $_.Name -eq $project -or (Test-UnderPath $_.WorkingDir $root) } |
        ForEach-Object { $_.Name } | Select-Object -Unique)
    if (-not $names) { Write-Host 'Compose: no project belongs to this worktree.'; return }
    foreach ($name in $names) { Stop-ComposeProject $name }
}

function Stop-FoundProcesses($found) {
    foreach ($p in @($found)) {
        $proc = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        try { $proc.Kill() }
        catch { if (-not $proc.HasExited) { Fail "Could not stop process $($p.Id) ($($p.Name)): $($_.Exception.Message). Nothing removed." } }
        if (-not $proc.WaitForExit(10000)) { Fail "Process $($p.Id) ($($p.Name)) is still running. Nothing removed." }
        Write-Host "Stopped process $($p.Id) ($($p.Name))."
    }
}

if (-not [IO.Path]::IsPathRooted($RepoRoot)) { Fail "'$RepoRoot' is not an absolute path. Relative paths break once the shell's working directory moves." }
$RepoRoot = Get-FullPath $RepoRoot
$LinkDirs = Split-List $LinkDirs
$EnvFiles = Split-List $EnvFiles
$SetEnv = Split-List $SetEnv

if ($Action -eq 'CleanupStale') {
    if ($Package -or $WorktreePath) { Fail 'CleanupStale works on the whole repo; do not pass -Package or -WorktreePath.' }
    $adapter = Read-Adapter $RepoRoot
    $worktreeRoot = Get-WorktreeRoot $adapter $RepoRoot
    $lockDir = Split-Path -Parent (Get-LockPath $RepoRoot 'x')
    $commonDir = Split-Path -Parent $lockDir
    $composePrefix = Get-ComposeProjectName $RepoRoot ''
    # Package folders carry the run ID: 494, 490-p2 (spec package), epic-490 (epic worktree).
    $packagePattern = '^(epic-)?\d+(-p\d+)?$'
    $entries = New-Object Collections.ArrayList
    $failed = $false
    $hostLines = @()

    # From here on a failing step is recorded and the run goes on: stdout carries only the JSON
    # list, so the messages of the shared functions go to stderr and are kept for the entries.
    function Fail([string]$message) { throw $message }
    function Write-Host([string]$Object) {
        [Console]::Error.WriteLine("worktree.ps1: $Object")
        $script:hostLines += $Object
    }

    function Add-Entry([string]$kind, $id, $path, [string]$action, [string]$reason, $branch = $null) {
        [void]$entries.Add([pscustomobject][ordered]@{ kind = $kind; id = $id; path = $path; branch = $branch; action = $action; reason = $reason })
    }

    function Add-Failure([string]$kind, $id, $path, [string]$message) {
        $script:failed = $true
        [Console]::Error.WriteLine("worktree.ps1: $message")
        Add-Entry $kind $id $path 'skipped' "failed: $message"
    }

    # Turns the messages of Down and of the shared stop functions into entries.
    function Add-StopEntries([string[]]$lines, [string]$package, [string]$reason, $branch) {
        foreach ($line in $lines) {
            if ($line -match '^Stopped compose project (?<name>.+)\.$') { Add-Entry 'compose' $Matches.name $null 'stopped' "package ${package}: $reason" }
            elseif ($line -match '^Stopped process (?<id>\d+) \((?<name>.*)\)\.$') { Add-Entry 'process' ([int]$Matches.id) $null 'stopped' "$($Matches.name) in package ${package}: $reason" }
            elseif ($line -match '^Worktree removed: (?<path>.+)$') { Add-Entry 'worktree' $package $Matches.path 'removed' $reason $branch }
            elseif ($line -match '^Lock removed: (?<path>.+)$') { Add-Entry 'lock' $package $Matches.path 'removed' $reason }
        }
    }

    function Get-LinkedWorktrees {
        $list = @()
        $current = $null
        foreach ($line in @(Invoke-Git @('-C', $RepoRoot, 'worktree', 'list', '--porcelain'))) {
            if ($line -like 'worktree *') {
                $current = [pscustomobject]@{ Path = (Get-FullPath $line.Substring(9)); Branch = $null }
                $list += $current
            } elseif ($current -and $line -like 'branch *') {
                $current.Branch = $line.Substring(7) -replace '^refs/heads/', ''
            }
        }
        @($list | Select-Object -Skip 1)
    }

    # $null while the session lives; otherwise why it counts as dead.
    function Get-DeadSessionReason($lock) {
        $id = [int]$lock.sessionPid
        if ($id -le 0) { return 'lock names no session PID' }
        $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
        if (-not $proc) { return "session $id is gone" }
        if (-not $lock.sessionStarted) { return $null }
        $expected = $lock.sessionStarted
        if ($expected -isnot [datetime]) {
            $expected = [datetime]::Parse([string]$expected, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
        }
        # A start time that cannot be read is taken as the same process: stop nothing on a guess.
        try { $actual = $proc.StartTime } catch { return $null }
        if ([Math]::Abs(($actual.ToUniversalTime() - $expected.ToUniversalTime()).TotalSeconds) -lt 1) { return $null }
        "PID $id was reused (started $($actual.ToString('o')), the lock says $($lock.sessionStarted))"
    }

    # A folder with a .git of its own is a repo, or a worktree of another repo, when its .git is a
    # directory or names a gitdir outside this repo's common dir. With worktree_root: .. or a
    # worktree_root shared by several repos, such folders sit next to the package folders.
    function Test-ForeignGitFolder([string]$folder) {
        $dotGit = Join-Path $folder '.git'
        if (Test-Path -LiteralPath $dotGit -PathType Container) { return $true }
        if (-not (Test-Path -LiteralPath $dotGit -PathType Leaf)) { return $false }
        $gitdir = ([IO.File]::ReadAllText($dotGit) -replace '^\s*gitdir:\s*', '').Trim()
        if (-not $gitdir) { return $true }
        if (-not [IO.Path]::IsPathRooted($gitdir)) { $gitdir = Join-Path $folder $gitdir }
        -not (Test-UnderPath (Get-FullPath $gitdir) $commonDir)
    }

    # Top-level folder names under worktree_root that a path or command line points into.
    function Get-PackageNames([string[]]$texts) {
        $pattern = '(?i)' + [regex]::Escape($worktreeRoot) + '[\\/](?<name>[^\\/"''\s]+)'
        $names = @()
        foreach ($text in $texts) {
            if (-not $text) { continue }
            if ($onWindows) { $text = $text -replace '/', '\' }
            foreach ($m in [regex]::Matches($text, $pattern)) { $names += $m.Groups['name'].Value.ToLowerInvariant() }
        }
        @($names | Select-Object -Unique)
    }

    $keptLocks = @{}
    try {
        # 1. Locks: a dead session's package goes the way of Down.
        $linked = Get-LinkedWorktrees
        $lockFiles = if (Test-Path -LiteralPath $lockDir) { @(Get-ChildItem -LiteralPath $lockDir -Filter '*.json' -File) } else { @() }
        foreach ($file in $lockFiles) {
            $name = $file.BaseName.ToLowerInvariant()
            $keptLocks[$name] = 'cleanup failed'
            try {
                if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9-]*$') { throw "Lock $($file.FullName) does not name a package. Left in place." }
                $lock = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
                $reason = Get-DeadSessionReason $lock
                if (-not $reason) {
                    $keptLocks[$name] = "session $($lock.sessionPid) is alive"
                    Add-Entry 'lock' $name $file.FullName 'skipped' $keptLocks[$name]
                    continue
                }
                $wt = Join-Path $worktreeRoot $file.BaseName
                $registered = @($linked | Where-Object { $_.Path -eq $wt })[0]
                $branch = if ($registered) { $registered.Branch } else { $lock.branch }
                [Console]::Error.WriteLine("worktree.ps1: lock $($file.FullName): $reason.")
                if ($registered -and (Test-Path -LiteralPath $wt)) {
                    $eap = $ErrorActionPreference
                    $ErrorActionPreference = 'Continue'
                    try {
                        $out = @(& (Get-Process -Id $PID).Path -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Action Down -RepoRoot $RepoRoot -Package $file.BaseName 2>&1 | ForEach-Object { "$_" })
                        $code = $LASTEXITCODE
                    } finally { $ErrorActionPreference = $eap }
                    foreach ($line in $out) { if ($line -like 'worktree.ps1:*') { [Console]::Error.WriteLine($line) } else { [Console]::Error.WriteLine("worktree.ps1: $line") } }
                    Add-StopEntries $out $name $reason $branch
                    if ($code -eq 0) { $keptLocks.Remove($name); continue }
                    $status = @(& git -C $wt status --porcelain)
                    if ($status) {
                        $keptLocks[$name] = 'worktree is dirty'
                        Add-Entry 'worktree' $name $wt 'skipped' "dirty, left for a human ($($status.Count) change(s): $(($status | Select-Object -First 5) -join '; '))" $branch
                        Add-Entry 'lock' $name $file.FullName 'skipped' "kept while worktree $wt is dirty"
                        continue
                    }
                    throw "Down for package $name failed: $((@($out | Where-Object { $_ -like 'worktree.ps1:*' }) -join ' ') -replace '^worktree\.ps1: ', '')"
                }
                # No registered worktree with a folder: stop what still runs there, then let the lock go.
                if (Test-UnderPath $RepoRoot $wt) { throw "$wt holds the main checkout. Nothing stopped." }
                if (Test-ForeignGitFolder $wt) { throw "$wt is a repo or a worktree of another repo. Nothing stopped." }
                $script:hostLines = @()
                Stop-WorktreeCompose $wt (Get-ComposeProjectName $RepoRoot $file.BaseName)
                Stop-FoundProcesses @(Get-WorktreeProcesses $wt)
                Add-StopEntries $hostLines $name $reason $branch
                if ($registered) {
                    Invoke-Git @('-C', $RepoRoot, 'worktree', 'prune') | Out-Null
                    Add-Entry 'worktree' $name $wt 'removed' "folder was gone; git worktree prune dropped the entry" $branch
                } elseif (Test-Path -LiteralPath $wt) {
                    Add-Entry 'worktree' $name $wt 'skipped' 'folder is no registered worktree; a remnant on disk (references/worktree.md, "Worktrees ohne Manifest und Reste auf der Platte")' $branch
                }
                Remove-Item -LiteralPath $file.FullName -Force
                Add-Entry 'lock' $name $file.FullName 'removed' $reason
                $keptLocks.Remove($name)
            } catch {
                Add-Failure 'lock' $name $file.FullName $_.Exception.Message
            }
        }

        # 2. Orphans: what points into a package folder that no registered worktree and no lock claims.
        $linked = Get-LinkedWorktrees
        $protection = {
            param([string]$name)
            $folder = Join-Path $worktreeRoot $name
            if ($name -notmatch $packagePattern) { return 'foreign' }
            if (Test-UnderPath $RepoRoot $folder) { return 'foreign' }
            if (Test-ForeignGitFolder $folder) { return 'foreign' }
            if ($keptLocks.ContainsKey($name)) { return "lock kept: $($keptLocks[$name])" }
            if (@($linked | Where-Object { $_.Path -eq $folder })) { return 'no lock (epic worktree or created by Add)' }
            $null
        }

        foreach ($p in @(Get-WorktreeProcesses $worktreeRoot)) {
            $names = Get-PackageNames @($p.CommandLine, $p.Path, (Get-ProcessCwd $p.Id))
            if (-not $names -or @($names | Where-Object { & $protection $_ })) { continue }
            try {
                $script:hostLines = @()
                Stop-FoundProcesses @($p)
                Add-StopEntries $hostLines ($names -join ', ') 'orphan, no registered worktree and no lock' $null
            } catch {
                Add-Failure 'process' $p.Id $null $_.Exception.Message
            }
        }

        $compose = Get-ComposeProjects
        if (-not $compose.Reachable) {
            Add-Entry 'compose' $null $null 'skipped' $compose.Reason
        } else {
            foreach ($group in @($compose.Projects | Group-Object Name)) {
                $names = @()
                if ($group.Name -like "$composePrefix*") { $names += $group.Name.Substring($composePrefix.Length).ToLowerInvariant() }
                $names = @(@($names) + @(Get-PackageNames @($group.Group | ForEach-Object { $_.WorkingDir })) | Select-Object -Unique)
                if (-not $names) { continue }
                $reasons = @($names | ForEach-Object { & $protection $_ } | Where-Object { $_ })
                if ($reasons) {
                    $ours = @($reasons | Where-Object { $_ -ne 'foreign' })
                    if ($ours) { Add-Entry 'compose' $group.Name $null 'skipped' ($ours -join '; ') }
                    continue
                }
                try {
                    $script:hostLines = @()
                    Stop-ComposeProject $group.Name
                    Add-StopEntries $hostLines ($names -join ', ') 'orphan, no registered worktree and no lock' $null
                } catch {
                    Add-Failure 'compose' $group.Name $null $_.Exception.Message
                }
            }
        }

        # 3. Registered worktrees without lock are reported and left alone.
        foreach ($w in $linked) {
            if (-not (Test-UnderPath $w.Path $worktreeRoot)) { continue }
            $name = (Split-Path -Leaf $w.Path).ToLowerInvariant()
            if ((Split-Path -Parent $w.Path) -eq $worktreeRoot -and $keptLocks.ContainsKey($name)) { continue }
            Add-Entry 'worktree' $name $w.Path 'skipped' 'no lock (epic worktree or created by Add)' $w.Branch
        }
    } catch {
        Add-Failure 'worktree' $null $null $_.Exception.Message
    }

    $done = @($entries | Where-Object { $_.action -ne 'skipped' }).Count
    if ($done) {
        [Console]::Error.WriteLine("worktree.ps1: CleanupStale: $done stopped or removed, $($entries.Count - $done) skipped.")
    } else {
        [Console]::Error.WriteLine("worktree.ps1: CleanupStale: nothing to do ($($entries.Count) skipped).")
    }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject @($entries) -Depth 3 -Compress))
    if ($failed) { exit 1 }
    exit 0
}

if ($Action -in 'Up', 'Down') {
    if ($Package -notmatch '^[A-Za-z0-9][A-Za-z0-9-]*$') { Fail "$Action needs -Package, a package number such as 494 (got '$Package')." }
    if ($WorktreePath) { Fail "$Action derives the worktree path from worktree_root; do not pass -WorktreePath." }
    $adapter = Read-Adapter $RepoRoot
    $WorktreePath = Join-Path (Get-WorktreeRoot $adapter $RepoRoot) $Package
    $project = Get-ComposeProjectName $RepoRoot $Package
    $lockPath = Get-LockPath $RepoRoot $Package
} else {
    if (-not $WorktreePath) { Fail "$Action needs -WorktreePath." }
    if (-not [IO.Path]::IsPathRooted($WorktreePath)) { Fail "'$WorktreePath' is not an absolute path. Relative paths break once the shell's working directory moves." }
    $WorktreePath = Get-FullPath $WorktreePath
}

if ($Action -eq 'Up') {
    $dotted = @($WorktreePath -split '[\\/]' | Where-Object { $_ -like '.*' })
    if ($dotted) { Fail "$WorktreePath contains the dot directory '$($dotted[0])'. worktree_root must not lie in one." }
    if (Test-Path -LiteralPath $lockPath) { Fail "Lock $lockPath already exists. Package $Package is taken; run Down or remove the stale lock first." }
    if ($SessionPid -eq 0) {
        $SessionPid = Find-SessionPid
        if ($SessionPid -eq 0) { Fail 'No Claude session among the ancestors of this process. Pass -SessionPid with a PID that lives as long as the package.' }
    }
    $session = Get-Process -Id $SessionPid -ErrorAction SilentlyContinue
    if (-not $session) { Fail "Session PID $SessionPid is not running. The lock needs a PID that lives as long as the package." }

    $LinkDirs = @(@(Split-List @($adapter['link_dirs'])) + @(Split-List @($adapter['always_link'])) | Select-Object -Unique)
    $EnvFiles = Split-List @($adapter['env_files'])
    $isolation = $null
    $port = $null
    $variables = @()
    # Old notation (adapter.md): a value starting with "keine" (German for none) means isolation: none-needed.
    if ($adapter['test_isolation_env'] -and $adapter['test_isolation_env'] -notmatch '^keine') {
        $isolation = $Package
        $variables += "$($adapter['test_isolation_env'])=$Package"
    }
    if ($adapter['port_env']) {
        $port = Get-FreePort
        $variables += "$($adapter['port_env'])=$port"
    }
    $variables += "COMPOSE_PROJECT_NAME=$project"
    $SetEnv = @(foreach ($file in $EnvFiles) { foreach ($v in $variables) { "${file}:$v" } })
    $warnings = @()
    if (-not $EnvFiles) {
        # No env file to carry the values; creating one would leave an untracked file in the worktree.
        $warnings += "The adapter names no env_files, so $(($variables | ForEach-Object { ($_ -split '=')[0] }) -join ', ') went into no file. Set them in the environment of what you start in the worktree."
        foreach ($w in $warnings) { [Console]::Error.WriteLine("worktree.ps1: $w") }
    }
}

if ($Action -eq 'Down') {
    if (-not (Test-Path -LiteralPath $WorktreePath)) { Fail "$WorktreePath does not exist." }
    # A wrong -Package or worktree_root must not point the path boundary at the main checkout or a
    # foreign folder: stop nothing unless the path is a linked worktree this script created.
    $linked = @(Invoke-Git @('-C', $RepoRoot, 'worktree', 'list', '--porcelain') | Where-Object { $_ -like 'worktree *' } |
        ForEach-Object { Get-FullPath $_.Substring(9) } | Select-Object -Skip 1)
    if ($linked -notcontains $WorktreePath) { Fail "$WorktreePath is not a linked worktree of $RepoRoot. Nothing stopped, nothing removed." }
    if (-not (Test-Path -LiteralPath (Get-ManifestPath $WorktreePath))) { Fail "No manifest for $WorktreePath - this worktree was not created by worktree.ps1. Nothing stopped, nothing removed." }
    # Stop what clearly belongs to the worktree before anything is removed.
    Stop-WorktreeCompose $WorktreePath $project
    $found = @(Get-WorktreeProcesses $WorktreePath)
    Stop-FoundProcesses $found
    if (-not $found) { Write-Host 'Processes: none ran in this worktree.' }
}

if ($Action -in 'Add', 'Up') {
    if (-not $Branch) { Fail "$Action needs -Branch." }
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
        # The folder of an env file may hold nothing tracked and then is missing in the checkout.
        $parent = Split-Path -Parent $dest
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
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

    if ($Action -eq 'Up') {
        $started = $null
        try { $started = $session.StartTime.ToString('o') } catch { }
        $lock = [ordered]@{
            package = $Package; branch = $Branch; sessionPid = $SessionPid; sessionStarted = $started
            created = (Get-Date).ToString('o'); worktree = $WorktreePath; repoRoot = $RepoRoot
            port = $port; project = $project
        }
        $lockDir = Split-Path -Parent $lockPath
        if (-not (Test-Path -LiteralPath $lockDir)) { New-Item -ItemType Directory -Path $lockDir | Out-Null }
        [IO.File]::WriteAllText($lockPath, (ConvertTo-Json -InputObject $lock), (New-Object Text.UTF8Encoding $false))
        [Console]::Error.WriteLine("worktree.ps1: worktree ready: $WorktreePath on $Branch, $($links.Count) link(s), $($EnvFiles.Count) env file(s), lock $lockPath.")
        $result = [ordered]@{
            path = $WorktreePath; branch = $Branch; port = $port; isolation = $isolation; project = $project
            envFiles = @($EnvFiles | ForEach-Object { Join-Path $WorktreePath $_ }); lock = $lockPath
            sessionPid = $SessionPid; warnings = @($warnings)
        }
        [Console]::Out.WriteLine((ConvertTo-Json -InputObject $result -Compress))
        exit 0
    }
    Write-Host "Worktree ready: $WorktreePath on $Branch, $($links.Count) link(s), $($EnvFiles.Count) env file(s)."
    exit 0
}

# Remove, and the second half of Down
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
if ($Action -eq 'Down') {
    if (Test-Path -LiteralPath $lockPath) {
        Remove-Item -LiteralPath $lockPath -Force
        Write-Host "Lock removed: $lockPath"
    } else {
        Write-Host "No lock at $lockPath."
    }
}
exit 0
