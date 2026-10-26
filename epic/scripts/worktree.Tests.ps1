# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\epic\scripts\worktree.Tests.ps1
# Each test builds a throwaway repo with a fake node_modules and calls the script the way
# /epic does: as a separate process via `powershell -File`.

$script = Join-Path $PSScriptRoot 'worktree.ps1'

function New-TestRepo {
    $root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $repo = Join-Path $root 'repo'
    New-Item -ItemType Directory -Path (Join-Path $repo 'server\node_modules\dep') -Force | Out-Null
    Set-Content -Path (Join-Path $repo 'server\node_modules\dep\index.js') -Value 'module.exports = 1'
    Set-Content -Path (Join-Path $repo 'server\.env') -Value "DB=app`nTEST_DB_SUFFIX=main"
    Set-Content -Path (Join-Path $repo 'server\app.js') -Value 'require("dep")'
    Set-Content -Path (Join-Path $repo '.gitignore') -Value "node_modules/`n.env"
    git -C $repo init -q -b main
    git -C $repo -c core.autocrlf=false add .
    git -C $repo -c user.name=t -c user.email=t@t commit -q -m init
    @{ Repo = $repo; Worktree = (Join-Path $root 'wt\1') }
}

function Invoke-Worktree([string[]]$arguments) {
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $script @arguments 2>&1
    @{ Exit = $LASTEXITCODE; Output = ($output | Out-String) }
}

$fullAdapter = @'
---
forge: gitea
worktree_root: ../wt
link_dirs: [server/node_modules]
env_files:
  - server/.env
test_isolation_env: TEST_DB_SUFFIX
port_env: PORT   # one per worktree
test_commands:
  server: npm test
some_future_key: [a, b]
---

# Adapter
'@

# A test repo with .claude/epic.md committed; worktree_root ../wt puts package 1 at $t.Worktree.
function New-AdapterRepo([string]$adapter = $fullAdapter) {
    $t = New-TestRepo
    if ($adapter) {
        New-Item -ItemType Directory -Path (Join-Path $t.Repo '.claude') | Out-Null
        Set-Content -Path (Join-Path $t.Repo '.claude\epic.md') -Value $adapter
        git -C $t.Repo -c core.autocrlf=false add .claude
        git -C $t.Repo -c user.name=t -c user.email=t@t commit -q -m adapter
    }
    $t
}

# stdout and stderr apart: Up promises exactly one JSON object on stdout. The stderr file is
# wrapped at the console width, so whitespace is folded.
function Invoke-Up($t, [int]$sessionPid = $PID) {
    $errFile = Join-Path $TestDrive ([guid]::NewGuid().ToString('N') + '.err')
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Action Up -RepoRoot $t.Repo -Package 1 `
        -Branch agent/1-test -From main -SessionPid $sessionPid 2>$errFile
    @{ Exit = $LASTEXITCODE; Out = @($out | Where-Object { $_ -ne $null }); Err = ((Get-Content $errFile -Raw) -replace '\s+', ' ') }
}

function Invoke-Down($t) {
    Invoke-Worktree @('-Action', 'Down', '-RepoRoot', $t.Repo, '-Package', '1')
}

# Takes docker off PATH and puts a wsl.cmd without running distribution in front of the real
# wsl.exe, so no test reaches the docker of this machine.
function Get-PathWithoutDocker {
    $noWsl = New-DockerStub @() -Wsl -Running @()
    "$noWsl;" + (@($env:PATH -split ';' | Where-Object {
        $dir = $_
        $dir -and -not (@('docker.exe', 'docker.cmd', 'docker.bat') | Where-Object { try { [IO.File]::Exists([IO.Path]::Combine($dir, $_)) } catch { $false } })
    }) -join ';')
}

# A docker.cmd that logs every call and answers `ps` and `inspect` with the given containers.
# With -Wsl a wsl.cmd instead: it answers `--list --running --quiet` with -Running and runs
# `-d <distro> -e docker ...` like docker.cmd. Every docker call exits with -DockerExit.
function New-DockerStub($containers, [switch]$Wsl, [string[]]$Running = @('Ubuntu'), [int]$DockerExit = 0) {
    $dir = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8) + '-docker')
    New-Item -ItemType Directory -Path $dir | Out-Null
    if ($Wsl) {
        Set-Content -Path (Join-Path $dir 'wsl.cmd') -Encoding Ascii -Value (@'
@echo off
echo %*>>"%~dp0calls.log"
if "%1"=="--list" goto list
if "%5"=="ps" type "%~dp0ps.txt"
if "%5"=="inspect" type "%~dp0inspect.json"
exit /b EXIT
:list
type "%~dp0running.txt"
exit /b 0
'@).Replace('EXIT', "$DockerExit")
        $names = if ($Running) { $Running } else { 'There are no running distributions.' }
        Set-Content -Path (Join-Path $dir 'running.txt') -Encoding Ascii -Value $names
    } else {
        Set-Content -Path (Join-Path $dir 'docker.cmd') -Encoding Ascii -Value (@'
@echo off
echo %*>>"%~dp0calls.log"
if "%1"=="ps" type "%~dp0ps.txt"
if "%1"=="inspect" type "%~dp0inspect.json"
exit /b EXIT
'@).Replace('EXIT', "$DockerExit")
    }
    $i = 0
    $list = @(foreach ($c in $containers) {
        $i++
        @{ Id = "c$i"; Config = @{ Labels = @{ 'com.docker.compose.project' = $c.Project; 'com.docker.compose.project.working_dir' = $c.WorkingDir } } }
    })
    Set-Content -Path (Join-Path $dir 'ps.txt') -Encoding Ascii -Value ($list | ForEach-Object { $_.Id })
    Set-Content -Path (Join-Path $dir 'inspect.json') -Encoding Ascii -Value (ConvertTo-Json -InputObject $list -Depth 5)
    $dir
}

function Get-StubCalls([string]$stub) {
    $log = Join-Path $stub 'calls.log'
    if (Test-Path $log) { Get-Content $log -Raw } else { '' }
}

# C:\x\y as docker in WSL labels it: /mnt/c/x/y.
function ConvertTo-WslPath([string]$path) {
    '/mnt/' + $path.Substring(0, 1).ToLowerInvariant() + ($path.Substring(2) -replace '\\', '/')
}

function Invoke-DownWithPath($t, [string]$path) {
    $saved = $env:PATH
    try { $env:PATH = $path; Invoke-Down $t } finally { $env:PATH = $saved }
}

function Invoke-DownWithDocker($t, $containers) {
    $stub = New-DockerStub $containers
    $r = Invoke-DownWithPath $t "$stub;$(Get-PathWithoutDocker)"
    $r.Calls = Get-StubCalls $stub
    $r
}

# Down with docker only in WSL: no docker on PATH, the given wsl.cmd stub in front of wsl.exe.
function Invoke-DownWithWsl($t, $stub) {
    $r = Invoke-DownWithPath $t "$stub;$(Get-PathWithoutDocker)"
    $r.Calls = Get-StubCalls $stub
    $r
}

function Start-Sleeper([string]$workingDirectory, [string]$note = '') {
    Start-Process powershell -ArgumentList '-NoProfile', '-Command', "Start-Sleep 120 # $note" `
        -WorkingDirectory $workingDirectory -WindowStyle Hidden -PassThru
}

Describe 'worktree.ps1 Up' {
    It 'reads the frontmatter and prints exactly one JSON object' {
        $t = New-AdapterRepo
        $r = Invoke-Up $t
        $r.Exit | Should Be 0
        $r.Out.Count | Should Be 1
        $j = $r.Out[0] | ConvertFrom-Json
        $j.path | Should Be $t.Worktree
        $j.branch | Should Be 'agent/1-test'
        $j.isolation | Should Be '1'
        $j.project | Should Be 'repo-1'
        $j.port -gt 0 | Should Be $true
        (Get-Item (Join-Path $t.Worktree 'server\node_modules') -Force).LinkType | Should Be 'Junction'
        $copy = Get-Content (Join-Path $t.Worktree 'server\.env') -Raw
        $copy | Should Match '(?m)^TEST_DB_SUFFIX=1\r?$'
        $copy | Should Match "(?m)^PORT=$($j.port)\r?$"
        $copy | Should Match '(?m)^COMPOSE_PROJECT_NAME=repo-1\r?$'
        $copy | Should Match '(?m)^DB=app\r?$'
        git -C $t.Worktree status --porcelain | Should BeNullOrEmpty
    }

    It 'hands out a port that is free' {
        $t = New-AdapterRepo
        $r = Invoke-Up $t
        $r.Exit | Should Be 0
        $port = ($r.Out[0] | ConvertFrom-Json).port
        $listener = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback, $port)
        { $listener.Start() } | Should Not Throw
        $listener.Stop()
    }

    It 'writes a lock with package, branch, session PID and time outside the worktree' {
        $t = New-AdapterRepo
        $r = Invoke-Up $t
        $r.Exit | Should Be 0
        $j = $r.Out[0] | ConvertFrom-Json
        $j.lock | Should Be (Join-Path $t.Repo '.git\epic-locks\1.json')
        $lock = Get-Content $j.lock -Raw | ConvertFrom-Json
        $lock.package | Should Be '1'
        $lock.branch | Should Be 'agent/1-test'
        $lock.sessionPid | Should Be $PID
        $lock.created | Should Not BeNullOrEmpty
        $lock.sessionStarted | Should Not BeNullOrEmpty
        git -C $t.Worktree status --porcelain | Should BeNullOrEmpty
        git -C $t.Repo status --porcelain | Should BeNullOrEmpty
    }

    It 'refuses a package whose lock exists' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $r = Invoke-Up $t
        $r.Exit | Should Be 1
        $r.Err | Should Match 'already exists'
    }

    It 'refuses a session PID that is not running' {
        $t = New-AdapterRepo
        $gone = Start-Process cmd -ArgumentList '/c', 'exit' -WindowStyle Hidden -PassThru
        $gone.WaitForExit()
        $r = Invoke-Up $t $gone.Id
        $r.Exit | Should Be 1
        $r.Err | Should Match 'not running'
        Test-Path $t.Worktree | Should Be $false
    }

    It 'stops without an adapter and names it' {
        $t = New-AdapterRepo ''
        $r = Invoke-Up $t
        $r.Exit | Should Be 1
        $r.Err | Should Match 'No adapter'
        $r.Out.Count | Should Be 0
        Test-Path $t.Worktree | Should Be $false
    }

    It 'stops on an adapter without frontmatter' {
        $t = New-AdapterRepo "# Adapter`n`nworktree_root: ../wt"
        $r = Invoke-Up $t
        $r.Exit | Should Be 1
        $r.Err | Should Match 'no YAML frontmatter'
        Test-Path $t.Worktree | Should Be $false
    }

    It 'takes the defaults for missing keys and writes no new env file' {
        $t = New-AdapterRepo "---`nforge: gitea`n---"
        $r = Invoke-Up $t
        $r.Exit | Should Be 0
        $j = $r.Out[0] | ConvertFrom-Json
        $j.path | Should Be (Join-Path (Split-Path $t.Repo) 'repo-worktrees\1')
        $j.port | Should BeNullOrEmpty
        $j.isolation | Should BeNullOrEmpty
        $j.warnings | Should Match 'no env_files'
        $r.Err | Should Match 'no env_files'
        git -C $j.path status --porcelain | Should BeNullOrEmpty
    }

    It 'reads test_isolation_env "keine" as no isolation and copies env files into untracked folders' {
        $t = New-AdapterRepo "---`nworktree_root: '../wt' # quoted`nenv_files: [config/.env]`ntest_isolation_env: keine`n---"
        New-Item -ItemType Directory -Path (Join-Path $t.Repo 'config') | Out-Null
        Set-Content -Path (Join-Path $t.Repo 'config\.env') -Value 'A=1'
        $r = Invoke-Up $t
        $r.Exit | Should Be 0
        $j = $r.Out[0] | ConvertFrom-Json
        $j.path | Should Be $t.Worktree
        $j.isolation | Should BeNullOrEmpty
        $copy = Get-Content (Join-Path $t.Worktree 'config\.env') -Raw
        $copy | Should Not Match 'keine'
        $copy | Should Match '(?m)^COMPOSE_PROJECT_NAME=repo-1\r?$'
        git -C $t.Worktree status --porcelain | Should BeNullOrEmpty
    }
}

Describe 'worktree.ps1 Down' {
    It 'stops processes in the worktree, not in a sibling with the same prefix, and removes everything' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $sibling = "$($t.Worktree)0"
        New-Item -ItemType Directory -Path $sibling | Out-Null
        $byCwd = Start-Sleeper $t.Worktree
        $byCommandLine = Start-Sleeper $TestDrive (Join-Path $t.Worktree 'server')
        $outside = Start-Sleeper $sibling $sibling
        try {
            Start-Sleep -Milliseconds 500
            $r = Invoke-DownWithPath $t (Get-PathWithoutDocker)
            $r.Exit | Should Be 0
            $r.Output | Should Match "Stopped process $($byCwd.Id) "
            $r.Output | Should Match "Stopped process $($byCommandLine.Id) "
            $r.Output | Should Match 'Compose skipped: docker not reachable'
            $r.Output | Should Match 'Lock removed'
            Get-Process -Id $byCwd.Id -ErrorAction SilentlyContinue | Should BeNullOrEmpty
            Get-Process -Id $byCommandLine.Id -ErrorAction SilentlyContinue | Should BeNullOrEmpty
            Get-Process -Id $outside.Id -ErrorAction SilentlyContinue | Should Not BeNullOrEmpty
            Test-Path $t.Worktree | Should Be $false
            Test-Path (Join-Path $t.Repo '.git\epic-locks\1.json') | Should Be $false
            Test-Path (Join-Path $t.Repo 'server\node_modules\dep\index.js') | Should Be $true
        } finally {
            foreach ($p in @($byCwd, $byCommandLine, $outside)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
        }
    }

    It 'stops nothing when the package path is the main checkout or no worktree' {
        $t = New-AdapterRepo "---`nworktree_root: ..`n---"
        $other = Join-Path (Split-Path $t.Repo) 'other'
        New-Item -ItemType Directory -Path $other | Out-Null
        $inMain = Start-Sleeper $t.Repo
        $inOther = Start-Sleeper $other
        try {
            Start-Sleep -Milliseconds 500
            foreach ($package in 'repo', 'other') {
                $r = Invoke-Worktree @('-Action', 'Down', '-RepoRoot', $t.Repo, '-Package', $package)
                $r.Exit | Should Be 1
                $r.Output | Should Match 'not a linked worktree'
                $r.Output | Should Not Match 'Stopped (process|compose)'
            }
            Get-Process -Id $inMain.Id -ErrorAction SilentlyContinue | Should Not BeNullOrEmpty
            Get-Process -Id $inOther.Id -ErrorAction SilentlyContinue | Should Not BeNullOrEmpty
        } finally {
            foreach ($p in @($inMain, $inOther)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
        }
    }

    It 'leaves a dirty worktree and its lock in place' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        Add-Content -Path (Join-Path $t.Worktree 'server\app.js') -Value '// change'
        $r = Invoke-DownWithPath $t (Get-PathWithoutDocker)
        $r.Exit | Should Be 1
        $r.Output | Should Match 'not clean'
        Test-Path (Join-Path $t.Repo '.git\epic-locks\1.json') | Should Be $true
        (Get-Item (Join-Path $t.Worktree 'server\node_modules') -Force).LinkType | Should Be 'Junction'
    }

    It 'brings down the compose project named <repo>-<nr>' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $r = Invoke-DownWithDocker $t @(@{ Project = 'repo-1' })
        $r.Exit | Should Be 0
        $r.Calls | Should Match '(?m)^compose -p repo-1 down'
        $r.Output | Should Match 'Stopped compose project repo-1'
    }

    It 'leaves a name match alone whose working_dir lies outside worktree_root' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $sibling = Join-Path (Split-Path $t.Repo) 'repo-1'
        $r = Invoke-DownWithDocker $t @(@{ Project = 'repo-1'; WorkingDir = $sibling })
        $r.Exit | Should Be 0
        $r.Calls | Should Not Match '(?m)^compose '
        $r.Output | Should Match 'Compose: repo-1 matches the package name, but working_dir .*repo-1 lies outside worktree_root; left alone\.'
        $r.Output | Should Match 'no project belongs to this worktree'
        Test-Path $t.Worktree | Should Be $false
    }

    It 'brings down a name match with one container under worktree_root and one outside' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $sibling = Join-Path (Split-Path $t.Repo) 'repo-1'
        $r = Invoke-DownWithDocker $t @(@{ Project = 'repo-1'; WorkingDir = $sibling }, @{ Project = 'repo-1'; WorkingDir = (Join-Path (Split-Path $t.Worktree) 'other') })
        $r.Exit | Should Be 0
        $r.Calls | Should Match '(?m)^compose -p repo-1 down'
    }

    It 'brings down a compose project whose working_dir lies in the worktree' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $r = Invoke-DownWithDocker $t @(@{ Project = 'devstack'; WorkingDir = (Join-Path $t.Worktree 'server') })
        $r.Exit | Should Be 0
        $r.Calls | Should Match '(?m)^compose -p devstack down'
    }

    It 'leaves a foreign compose project alone, even with the same path prefix' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $r = Invoke-DownWithDocker $t @(@{ Project = 'repo-10'; WorkingDir = "$($t.Worktree)0" })
        $r.Exit | Should Be 0
        $r.Calls | Should Match '(?m)^ps '
        $r.Calls | Should Not Match '(?m)^compose '
        $r.Output | Should Match 'no project belongs to this worktree'
        Test-Path $t.Worktree | Should Be $false
    }

    It 'skips compose without docker and still removes the worktree' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $r = Invoke-DownWithPath $t (Get-PathWithoutDocker)
        $r.Exit | Should Be 0
        $r.Output | Should Match 'Compose skipped: docker not reachable'
        Test-Path $t.Worktree | Should Be $false
    }

    It 'takes docker from PATH before docker in WSL' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $docker = New-DockerStub @(@{ Project = 'repo-1' })
        $wsl = New-DockerStub @(@{ Project = 'repo-1' }) -Wsl
        $r = Invoke-DownWithPath $t "$docker;$wsl;$(Get-PathWithoutDocker)"
        $r.Exit | Should Be 0
        Get-StubCalls $docker | Should Match '(?m)^compose -p repo-1 down'
        Get-StubCalls $wsl | Should BeNullOrEmpty
    }

    It 'falls back to docker in a running WSL distribution and reads its /mnt path as a Windows path' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $stub = New-DockerStub @(@{ Project = 'devstack'; WorkingDir = (ConvertTo-WslPath (Join-Path $t.Worktree 'server')) }) -Wsl -Running @('Debian', 'Ubuntu')
        $r = Invoke-DownWithWsl $t $stub
        $r.Exit | Should Be 0
        $r.Calls | Should Match '(?m)^--list --running --quiet'
        $r.Calls | Should Match '(?m)^-d Debian -e docker compose -p devstack down'
        $r.Output | Should Match 'Stopped compose project devstack'
        Test-Path $t.Worktree | Should Be $false
    }

    It 'leaves a name match alone whose WSL working_dir lies outside worktree_root or on no Windows drive' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $sibling = ConvertTo-WslPath (Join-Path (Split-Path $t.Repo) 'repo-1')
        $stub = New-DockerStub @(@{ Project = 'repo-1'; WorkingDir = $sibling }, @{ Project = 'repo-1'; WorkingDir = '/home/u/repo-1' }) -Wsl
        $r = Invoke-DownWithWsl $t $stub
        $r.Exit | Should Be 0
        $r.Calls | Should Not Match 'compose '
        $r.Output | Should Match 'Compose: repo-1 matches the package name, but working_dir .*\\repo-1, /home/u/repo-1 lies outside worktree_root; left alone\.'
        Test-Path $t.Worktree | Should Be $false
    }

    It 'brings down a name match whose WSL working_dir lies under worktree_root' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $stub = New-DockerStub @(@{ Project = 'repo-1'; WorkingDir = (ConvertTo-WslPath (Join-Path (Split-Path $t.Worktree) 'other')) }) -Wsl
        $r = Invoke-DownWithWsl $t $stub
        $r.Exit | Should Be 0
        $r.Calls | Should Match '(?m)^-d Ubuntu -e docker compose -p repo-1 down'
    }

    It 'skips compose without a running WSL distribution and never starts one' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $stub = New-DockerStub @(@{ Project = 'repo-1' }) -Wsl -Running @()
        $r = Invoke-DownWithWsl $t $stub
        $r.Exit | Should Be 0
        $r.Output | Should Match 'Compose skipped: docker not reachable \(not on PATH, no running WSL distribution with docker\)'
        $r.Calls | Should Match '(?m)^--list --running --quiet'
        $r.Calls | Should Not Match '-e docker'
        Test-Path $t.Worktree | Should Be $false
    }

    It 'skips compose when the running WSL distribution has no docker' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $stub = New-DockerStub @(@{ Project = 'repo-1' }) -Wsl -DockerExit 1
        $r = Invoke-DownWithWsl $t $stub
        $r.Exit | Should Be 0
        $r.Output | Should Match 'Compose skipped: docker not reachable'
        $r.Calls | Should Match '(?m)^-d Ubuntu -e docker ps -q'
        $r.Calls | Should Not Match 'compose '
        Test-Path $t.Worktree | Should Be $false
    }
}

# CleanupStale with stdout and stderr apart; docker is taken out of PATH unless a stub is given.
function Invoke-Cleanup($t, $containers = $null, [switch]$Wsl) {
    $saved = $env:PATH
    $stub = $null
    if ($null -ne $containers) { $stub = New-DockerStub $containers -Wsl:$Wsl; $env:PATH = "$stub;$(Get-PathWithoutDocker)" } else { $env:PATH = Get-PathWithoutDocker }
    $errFile = Join-Path $TestDrive ([guid]::NewGuid().ToString('N') + '.err')
    try {
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Action CleanupStale -RepoRoot $t.Repo 2>$errFile
    } finally { $env:PATH = $saved }
    $out = @($out | Where-Object { $_ -ne $null })
    $r = @{ Exit = $LASTEXITCODE; Out = $out; Err = ((Get-Content $errFile -Raw) -replace '\s+', ' ') }
    $r.Entries = if ($out.Count -eq 1) { @($out[0] | ConvertFrom-Json) } else { $null }
    if ($stub) { $r.Calls = Get-StubCalls $stub }
    $r
}

function Find-Entry($r, [string]$kind, $id) {
    @($r.Entries | Where-Object { $_.kind -eq $kind -and "$($_.id)" -eq "$id" })
}

# A session that dies: Up needs a running PID, the test then kills it.
function Start-Session { Start-Sleeper $TestDrive 'session' }

function Stop-Session($session) {
    Stop-Process -Id $session.Id -Force
    $session.WaitForExit()
}

# A registered worktree without lock, as one that Up did not create.
function Add-UnlockedWorktree($t, [string]$nr) {
    $path = Join-Path (Split-Path $t.Worktree) $nr
    git -C $t.Repo worktree add -q $path -b "agent/$nr-test" main | Out-Null
    $null = $LASTEXITCODE | Should Be 0
    $path
}

Describe 'worktree.ps1 CleanupStale' {
    It 'removes the package of a lock whose session is gone, with its processes' {
        $t = New-AdapterRepo
        $session = Start-Session
        (Invoke-Up $t $session.Id).Exit | Should Be 0
        $inWorktree = Start-Sleeper $t.Worktree
        try {
            Start-Sleep -Milliseconds 500
            Stop-Session $session
            $r = Invoke-Cleanup $t
            $r.Exit | Should Be 0
            $r.Out.Count | Should Be 1
            (Find-Entry $r 'lock' '1')[0].action | Should Be 'removed'
            (Find-Entry $r 'lock' '1')[0].reason | Should Match "session $($session.Id) is gone"
            (Find-Entry $r 'worktree' '1')[0].action | Should Be 'removed'
            (Find-Entry $r 'worktree' '1')[0].branch | Should Be 'agent/1-test'
            (Find-Entry $r 'process' $inWorktree.Id)[0].action | Should Be 'stopped'
            (Find-Entry $r 'compose' '')[0].reason | Should Match 'docker not reachable'
            Get-Process -Id $inWorktree.Id -ErrorAction SilentlyContinue | Should BeNullOrEmpty
            Test-Path $t.Worktree | Should Be $false
            Test-Path (Join-Path $t.Repo '.git\epic-locks\1.json') | Should Be $false
            Test-Path (Join-Path $t.Repo 'server\node_modules\dep\index.js') | Should Be $true
        } finally {
            foreach ($p in @($session, $inWorktree)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
        }
    }

    It 'reports nothing to do on a second run' {
        $t = New-AdapterRepo
        $session = Start-Session
        (Invoke-Up $t $session.Id).Exit | Should Be 0
        Stop-Session $session
        (Invoke-Cleanup $t).Exit | Should Be 0
        $r = Invoke-Cleanup $t
        $r.Exit | Should Be 0
        $r.Err | Should Match 'CleanupStale: nothing to do'
        @($r.Entries | Where-Object { $_.action -ne 'skipped' }).Count | Should Be 0
    }

    It 'leaves a lock whose session lives untouched' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $inWorktree = Start-Sleeper $t.Worktree
        try {
            Start-Sleep -Milliseconds 500
            $r = Invoke-Cleanup $t
            $r.Exit | Should Be 0
            (Find-Entry $r 'lock' '1')[0].action | Should Be 'skipped'
            (Find-Entry $r 'lock' '1')[0].reason | Should Match 'alive'
            $r.Err | Should Match 'nothing to do'
            Get-Process -Id $inWorktree.Id -ErrorAction SilentlyContinue | Should Not BeNullOrEmpty
            Test-Path $t.Worktree | Should Be $true
            Test-Path (Join-Path $t.Repo '.git\epic-locks\1.json') | Should Be $true
        } finally {
            Stop-Process -Id $inWorktree.Id -Force -ErrorAction SilentlyContinue
        }
    }

    It 'counts a reused PID as dead' {
        $t = New-AdapterRepo
        $session = Start-Session
        try {
            (Invoke-Up $t $session.Id).Exit | Should Be 0
            $lockPath = Join-Path $t.Repo '.git\epic-locks\1.json'
            $lock = Get-Content $lockPath -Raw | ConvertFrom-Json
            $lock.sessionStarted = $session.StartTime.AddHours(-1).ToString('o')
            Set-Content -Path $lockPath -Value (ConvertTo-Json $lock)
            $r = Invoke-Cleanup $t
            $r.Exit | Should Be 0
            (Find-Entry $r 'lock' '1')[0].reason | Should Match 'reused'
            Test-Path $t.Worktree | Should Be $false
            Test-Path $lockPath | Should Be $false
            Get-Process -Id $session.Id -ErrorAction SilentlyContinue | Should Not BeNullOrEmpty
        } finally {
            Stop-Process -Id $session.Id -Force -ErrorAction SilentlyContinue
        }
    }

    It 'reports a dirty worktree with path, branch and reason and keeps it' {
        $t = New-AdapterRepo
        $session = Start-Session
        (Invoke-Up $t $session.Id).Exit | Should Be 0
        Stop-Session $session
        Add-Content -Path (Join-Path $t.Worktree 'server\app.js') -Value '// change'
        $r = Invoke-Cleanup $t
        $r.Exit | Should Be 0
        $w = (Find-Entry $r 'worktree' '1')[0]
        $w.action | Should Be 'skipped'
        $w.path | Should Be $t.Worktree
        $w.branch | Should Be 'agent/1-test'
        $w.reason | Should Match 'dirty'
        (Find-Entry $r 'lock' '1')[0].action | Should Be 'skipped'
        Test-Path (Join-Path $t.Worktree 'server\app.js') | Should Be $true
        Test-Path (Join-Path $t.Repo '.git\epic-locks\1.json') | Should Be $true
        (Get-Item (Join-Path $t.Worktree 'server\node_modules') -Force).LinkType | Should Be 'Junction'
        $again = Invoke-Cleanup $t
        $again.Err | Should Match 'nothing to do'
        (Find-Entry $again 'worktree' '1')[0].reason | Should Match 'dirty'
    }

    It 'leaves a registered worktree without lock and its processes alone' {
        $t = New-AdapterRepo
        $unlocked = Add-UnlockedWorktree $t '2'
        $inUnlocked = Start-Sleeper $unlocked
        try {
            Start-Sleep -Milliseconds 500
            $r = Invoke-Cleanup $t
            $r.Exit | Should Be 0
            $w = (Find-Entry $r 'worktree' '2')[0]
            $w.action | Should Be 'skipped'
            $w.reason | Should Be 'no lock (not created by Up)'
            $w.branch | Should Be 'agent/2-test'
            Find-Entry $r 'process' $inUnlocked.Id | Should BeNullOrEmpty
            Get-Process -Id $inUnlocked.Id -ErrorAction SilentlyContinue | Should Not BeNullOrEmpty
            Test-Path $unlocked | Should Be $true
        } finally {
            Stop-Process -Id $inUnlocked.Id -Force -ErrorAction SilentlyContinue
        }
    }

    It 'stops processes in a package folder no worktree claims, not in a foreign folder' {
        $t = New-AdapterRepo
        $root = Split-Path $t.Worktree
        $orphanDir = Join-Path $root '9'
        $foreignDir = Join-Path $root 'tools'
        New-Item -ItemType Directory -Path $orphanDir, $foreignDir -Force | Out-Null
        $orphan = Start-Sleeper $orphanDir
        $foreign = Start-Sleeper $foreignDir
        try {
            Start-Sleep -Milliseconds 500
            $r = Invoke-Cleanup $t
            $r.Exit | Should Be 0
            (Find-Entry $r 'process' $orphan.Id)[0].action | Should Be 'stopped'
            Get-Process -Id $orphan.Id -ErrorAction SilentlyContinue | Should BeNullOrEmpty
            Get-Process -Id $foreign.Id -ErrorAction SilentlyContinue | Should Not BeNullOrEmpty
        } finally {
            foreach ($p in @($orphan, $foreign)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
        }
    }

    It 'leaves a repo and a worktree of another repo under worktree_root alone, even with a lock' {
        $t = New-AdapterRepo
        $root = Split-Path $t.Worktree
        $siblingRepo = Join-Path $root '5'
        New-Item -ItemType Directory -Path $siblingRepo -Force | Out-Null
        git -C $siblingRepo init -q -b main
        $other = New-TestRepo
        $otherWorktree = Join-Path $root '6'
        git -C $other.Repo worktree add -q $otherWorktree -b agent/6 main 2>$null
        $lockDir = Join-Path $t.Repo '.git\epic-locks'
        New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
        Set-Content -Path (Join-Path $lockDir '5.json') -Value '{ "package": "5", "sessionPid": 999999 }'
        $inRepo = Start-Sleeper $siblingRepo
        $inOther = Start-Sleeper $otherWorktree
        try {
            Start-Sleep -Milliseconds 500
            $r = Invoke-Cleanup $t
            $r.Exit | Should Be 1
            $r.Out.Count | Should Be 1
            (Find-Entry $r 'lock' '5')[0].reason | Should Match 'repo or a worktree of another repo'
            Find-Entry $r 'process' $inRepo.Id | Should BeNullOrEmpty
            Find-Entry $r 'process' $inOther.Id | Should BeNullOrEmpty
            Get-Process -Id $inRepo.Id -ErrorAction SilentlyContinue | Should Not BeNullOrEmpty
            Get-Process -Id $inOther.Id -ErrorAction SilentlyContinue | Should Not BeNullOrEmpty
        } finally {
            foreach ($p in @($inRepo, $inOther)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
        }
    }

    It 'prunes a lock whose worktree folder is gone and removes the lock' {
        $t = New-AdapterRepo
        $session = Start-Session
        (Invoke-Up $t $session.Id).Exit | Should Be 0
        Stop-Session $session
        [IO.Directory]::Delete((Join-Path $t.Worktree 'server\node_modules'), $false)
        Remove-Item -LiteralPath $t.Worktree -Recurse -Force
        $r = Invoke-Cleanup $t
        $r.Exit | Should Be 0
        (Find-Entry $r 'worktree' '1')[0].action | Should Be 'removed'
        (Find-Entry $r 'lock' '1')[0].action | Should Be 'removed'
        Test-Path (Join-Path $t.Repo '.git\epic-locks\1.json') | Should Be $false
        @(git -C $t.Repo worktree list --porcelain | Where-Object { $_ -like 'worktree *' }).Count | Should Be 1
        Test-Path (Join-Path $t.Repo 'server\node_modules\dep\index.js') | Should Be $true
    }

    It 'brings down an orphan compose project, not one with a living lock or an unlocked worktree' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $unlocked = Add-UnlockedWorktree $t '2'
        $r = Invoke-Cleanup $t @(
            @{ Project = 'repo-7'; WorkingDir = (Join-Path (Split-Path $t.Worktree) '7') },
            @{ Project = 'repo-1'; WorkingDir = $t.Worktree },
            @{ Project = 'repo-2'; WorkingDir = $unlocked },
            @{ Project = 'devstack'; WorkingDir = 'C:\elsewhere' })
        $r.Exit | Should Be 0
        $r.Calls | Should Match '(?m)^compose -p repo-7 down'
        $r.Calls | Should Not Match '(?m)^compose -p repo-1 '
        $r.Calls | Should Not Match '(?m)^compose -p repo-2 '
        $r.Calls | Should Not Match '(?m)^compose -p devstack '
        (Find-Entry $r 'compose' 'repo-7')[0].action | Should Be 'stopped'
        (Find-Entry $r 'compose' 'repo-1')[0].reason | Should Match 'alive'
        (Find-Entry $r 'compose' 'repo-2')[0].reason | Should Be 'no lock (not created by Up)'
        Find-Entry $r 'compose' 'devstack' | Should BeNullOrEmpty
    }

    It 'leaves a name match alone whose working_dir lies outside worktree_root, and counts a missing working_dir or one container under it' {
        $t = New-AdapterRepo
        $sibling = Join-Path (Split-Path $t.Repo) 'repo-2'
        $r = Invoke-Cleanup $t @(
            @{ Project = 'repo-2'; WorkingDir = $sibling },
            @{ Project = 'repo-3'; WorkingDir = '' },
            @{ Project = 'repo-4' },
            @{ Project = 'repo-5'; WorkingDir = 'C:\odd|dir' },
            @{ Project = 'repo-6'; WorkingDir = $sibling },
            @{ Project = 'repo-6'; WorkingDir = (Join-Path (Split-Path $t.Worktree) '6') })
        $r.Exit | Should Be 0
        $r.Calls | Should Not Match '(?m)^compose -p repo-5 '
        (Find-Entry $r 'compose' 'repo-5')[0].action | Should Be 'skipped'
        $r.Calls | Should Match '(?m)^compose -p repo-6 down'
        $r.Calls | Should Not Match '(?m)^compose -p repo-2 '
        (Find-Entry $r 'compose' 'repo-2')[0].action | Should Be 'skipped'
        (Find-Entry $r 'compose' 'repo-2')[0].reason | Should Match 'name matches repo-<nr>, but working_dir .*repo-2 lies outside worktree_root'
        $r.Calls | Should Match '(?m)^compose -p repo-3 down'
        $r.Calls | Should Match '(?m)^compose -p repo-4 down'
    }

    It 'brings down an orphan through docker in WSL and keeps the path protection for WSL paths' {
        $t = New-AdapterRepo
        $root = Split-Path $t.Worktree
        $r = Invoke-Cleanup $t @(
            @{ Project = 'repo-7'; WorkingDir = (ConvertTo-WslPath (Join-Path $root '7')) },
            @{ Project = 'repo-2'; WorkingDir = (ConvertTo-WslPath (Join-Path (Split-Path $t.Repo) 'repo-2')) },
            @{ Project = 'repo-3'; WorkingDir = '/home/u/repo-3' },
            @{ Project = 'stack'; WorkingDir = (ConvertTo-WslPath (Join-Path (Split-Path $t.Repo) 'stack')) }) -Wsl
        $r.Exit | Should Be 0
        $r.Calls | Should Match '(?m)^-d Ubuntu -e docker compose -p repo-7 down'
        (Find-Entry $r 'compose' 'repo-7')[0].action | Should Be 'stopped'
        $r.Calls | Should Not Match 'compose -p repo-2 '
        (Find-Entry $r 'compose' 'repo-2')[0].reason | Should Match 'name matches repo-<nr>, but working_dir .*\\repo-2 lies outside worktree_root'
        $r.Calls | Should Not Match 'compose -p repo-3 '
        (Find-Entry $r 'compose' 'repo-3')[0].reason | Should Match 'working_dir /home/u/repo-3 lies outside worktree_root'
        $r.Calls | Should Not Match 'compose -p stack '
        Find-Entry $r 'compose' 'stack' | Should BeNullOrEmpty
    }

    It 'skips compose without docker, exits 0 and still clears a dead lock' {
        $t = New-AdapterRepo
        $session = Start-Session
        (Invoke-Up $t $session.Id).Exit | Should Be 0
        Stop-Session $session
        $r = Invoke-Cleanup $t
        $r.Exit | Should Be 0
        $r.Err | Should Match 'Compose skipped: docker not reachable'
        (Find-Entry $r 'compose' '')[0].action | Should Be 'skipped'
        Test-Path $t.Worktree | Should Be $false
    }

    It 'prints an empty list and nothing to do on a clean repo' {
        $t = New-AdapterRepo
        $r = Invoke-Cleanup $t @()
        $r.Exit | Should Be 0
        $r.Out[0] | Should Be '[]'
        $r.Err | Should Match 'nothing to do'
    }
}


# The protections the older Add and Remove had, ported to Up and Down (#38). Every call goes
# through the adapter now: link_dirs, env_files, test_isolation_env and port_env of $fullAdapter.
Describe 'worktree.ps1 Up: protections carried over from Add' {
    It 'creates the worktree with a junction, not a copy' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $link = Get-Item (Join-Path $t.Worktree 'server\node_modules') -Force
        $link.LinkType | Should Be 'Junction'
        @($link.Target)[0] | Should Be (Join-Path $t.Repo 'server\node_modules')
        git -C $t.Worktree status --porcelain | Should BeNullOrEmpty
    }

    It 'copies env files and sets the variables in the copy only' {
        $t = New-AdapterRepo
        $r = Invoke-Up $t
        $r.Exit | Should Be 0
        $port = ($r.Out[0] | ConvertFrom-Json).port
        $copy = Get-Content (Join-Path $t.Worktree 'server\.env') -Raw
        $copy | Should Match '(?m)^TEST_DB_SUFFIX=1\r?$'
        $copy | Should Match "(?m)^PORT=$port\r?$"
        $copy | Should Match '(?m)^DB=app\r?$'
        $main = Get-Content (Join-Path $t.Repo 'server\.env') -Raw
        $main | Should Match 'TEST_DB_SUFFIX=main'
        $main | Should Not Match 'PORT='
        $main | Should Not Match 'COMPOSE_PROJECT_NAME'
    }

    It 'creates junctions when called from Git Bash too' {
        $bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
        if (-not (Test-Path $bash)) { Set-TestInconclusive 'Git Bash not found' }
        $t = New-AdapterRepo
        $cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File '$($script -replace '\\','/')' -Action Up " +
            "-RepoRoot '$($t.Repo -replace '\\','/')' -Package 1 -Branch agent/1-test -From main -SessionPid $PID"
        & $bash -lc $cmd 2>$null | Out-Null
        $LASTEXITCODE | Should Be 0
        (Get-Item (Join-Path $t.Worktree 'server\node_modules') -Force).LinkType | Should Be 'Junction'
    }

    It 'reuses an existing branch' {
        $t = New-AdapterRepo
        git -C $t.Repo branch agent/1-test main
        $r = Invoke-Worktree @('-Action', 'Up', '-RepoRoot', $t.Repo, '-Package', '1', '-Branch', 'agent/1-test', '-SessionPid', $PID)
        $r.Exit | Should Be 0
        git -C $t.Worktree rev-parse --abbrev-ref HEAD | Should Be 'agent/1-test'
    }

    It 'refuses an existing path' {
        $t = New-AdapterRepo
        New-Item -ItemType Directory -Path $t.Worktree -Force | Out-Null
        $r = Invoke-Up $t
        $r.Exit | Should Be 1
        $r.Err | Should Match 'already exists'
        Test-Path (Join-Path $t.Repo '.git\epic-locks\1.json') | Should Be $false
    }

    It 'refuses a missing link target before creating anything' {
        $t = New-AdapterRepo "---`nworktree_root: ../wt`nlink_dirs: [client/node_modules]`n---"
        $r = Invoke-Up $t
        $r.Exit | Should Be 1
        $r.Err | Should Match 'does not exist in the main checkout'
        Test-Path $t.Worktree | Should Be $false
        Test-Path (Join-Path $t.Repo '.git\epic-locks\1.json') | Should Be $false
    }

    It 'refuses a relative repo root' {
        $r = Invoke-Worktree @('-Action', 'Up', '-RepoRoot', 'repo', '-Package', '1', '-Branch', 'x', '-From', 'main', '-SessionPid', $PID)
        $r.Exit | Should Be 1
        $r.Output | Should Match 'not an absolute path'
    }
}

Describe 'worktree.ps1 Down: protections carried over from Remove' {
    It 'removes the junction, not its target, and keeps the branch' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        $before = @(Get-ChildItem (Join-Path $t.Repo 'server\node_modules') -Recurse -Force).Count
        $r = Invoke-DownWithPath $t (Get-PathWithoutDocker)
        $r.Exit | Should Be 0
        Test-Path $t.Worktree | Should Be $false
        @(Get-ChildItem (Join-Path $t.Repo 'server\node_modules') -Recurse -Force).Count | Should Be $before
        Test-Path (Join-Path $t.Repo 'server\node_modules\dep\index.js') | Should Be $true
        git -C $t.Repo branch --list agent/1-test | Should Match 'agent/1-test'
    }

    It 'leaves a dirty worktree alone, with its links, its change and its branch' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        Add-Content -Path (Join-Path $t.Worktree 'server\app.js') -Value '// change'
        $r = Invoke-DownWithPath $t (Get-PathWithoutDocker)
        $r.Exit | Should Be 1
        $r.Output | Should Match 'not clean'
        (Get-Item (Join-Path $t.Worktree 'server\node_modules') -Force).LinkType | Should Be 'Junction'
        Get-Content (Join-Path $t.Worktree 'server\app.js') -Raw | Should Match '// change'
        git -C $t.Repo branch --list agent/1-test | Should Match 'agent/1-test'
    }

    It 'stops at a junction it did not create, without deleting through it' {
        $t = New-AdapterRepo
        (Invoke-Up $t).Exit | Should Be 0
        New-Item -ItemType Directory -Path (Join-Path $t.Worktree 'extra') | Out-Null
        New-Item -ItemType Junction -Path (Join-Path $t.Worktree 'extra\node_modules') -Value (Join-Path $t.Repo 'server\node_modules') | Out-Null
        $r = Invoke-DownWithPath $t (Get-PathWithoutDocker)
        $r.Exit | Should Be 1
        $r.Output | Should Match 'Reparse points'
        Test-Path (Join-Path $t.Repo 'server\node_modules\dep\index.js') | Should Be $true
        [IO.Directory]::Delete((Join-Path $t.Worktree 'extra\node_modules'), $false)
    }

    It 'refuses a worktree without manifest' {
        $t = New-AdapterRepo
        git -C $t.Repo worktree add -q $t.Worktree -b agent/1-test main
        $r = Invoke-DownWithPath $t (Get-PathWithoutDocker)
        $r.Exit | Should Be 1
        $r.Output | Should Match 'No manifest'
        Test-Path $t.Worktree | Should Be $true
    }
}

# The switch-over (#38): the repo's adapter is prose only, the confirmed frontmatter lies elsewhere.
Describe 'worktree.ps1 -AdapterFile' {
    function New-SwitchOverRepo {
        $t = New-AdapterRepo "# Adapter`n`nworktree_root: ../wt"
        $t.AdapterFile = Join-Path (Split-Path $t.Repo) 'epic.md'
        Set-Content -Path $t.AdapterFile -Value "---`nworktree_root: ../alt`nlink_dirs: [server/node_modules]`n---"
        $t.Worktree = Join-Path (Split-Path $t.Repo) 'alt\1'
        $t
    }

    function Invoke-WithAdapter($t, [string[]]$arguments, [string]$adapterFile = $t.AdapterFile) {
        $saved = $env:PATH
        try {
            $env:PATH = Get-PathWithoutDocker
            Invoke-Worktree (@($arguments) + @('-RepoRoot', $t.Repo, '-AdapterFile', $adapterFile))
        } finally { $env:PATH = $saved }
    }

    It 'stops without it on a repo whose adapter has no frontmatter' {
        $t = New-SwitchOverRepo
        $r = Invoke-Up $t
        $r.Exit | Should Be 1
        $r.Err | Should Match 'no YAML frontmatter'
    }

    It 'creates the worktree at the worktree_root of the file, and Down removes it' {
        $t = New-SwitchOverRepo
        $r = Invoke-WithAdapter $t @('-Action', 'Up', '-Package', '1', '-Branch', 'agent/1-test', '-From', 'main', '-SessionPid', $PID)
        $r.Exit | Should Be 0
        Test-Path (Join-Path (Split-Path $t.Repo) 'wt\1') | Should Be $false
        (Get-Item (Join-Path $t.Worktree 'server\node_modules') -Force).LinkType | Should Be 'Junction'
        $r = Invoke-WithAdapter $t @('-Action', 'Down', '-Package', '1')
        $r.Exit | Should Be 0
        Test-Path $t.Worktree | Should Be $false
        Test-Path (Join-Path $t.Repo '.git\epic-locks\1.json') | Should Be $false
        Test-Path (Join-Path $t.Repo 'server\node_modules\dep\index.js') | Should Be $true
    }

    It 'lets CleanupStale clear a dead lock, Down included' {
        $t = New-SwitchOverRepo
        $session = Start-Session
        $r = Invoke-WithAdapter $t @('-Action', 'Up', '-Package', '1', '-Branch', 'agent/1-test', '-From', 'main', '-SessionPid', $session.Id)
        $r.Exit | Should Be 0
        Stop-Session $session
        $r = Invoke-WithAdapter $t @('-Action', 'CleanupStale')
        $r.Exit | Should Be 0
        $r.Output | Should Match 'Worktree removed'
        Test-Path $t.Worktree | Should Be $false
        Test-Path (Join-Path $t.Repo '.git\epic-locks\1.json') | Should Be $false
    }

    It 'refuses a relative or missing file, or one without frontmatter' {
        $t = New-SwitchOverRepo
        foreach ($file in 'epic.md', (Join-Path $TestDrive 'missing.md')) {
            $r = Invoke-WithAdapter $t @('-Action', 'Up', '-Package', '1', '-Branch', 'agent/1-test', '-From', 'main', '-SessionPid', $PID) $file
            $r.Exit | Should Be 1
            $r.Output | Should Match '-AdapterFile'
            Test-Path $t.Worktree | Should Be $false
        }
        (Invoke-WithAdapter $t @('-Action', 'CleanupStale') 'epic.md').Exit | Should Be 1
        $prose = Join-Path $TestDrive 'prose.md'
        Set-Content -Path $prose -Value "# Adapter`n`nworktree_root: ../alt"
        foreach ($arguments in @(@('-Action', 'Up', '-Package', '1', '-Branch', 'agent/1-test', '-From', 'main', '-SessionPid', $PID), @('-Action', 'CleanupStale'))) {
            $r = Invoke-WithAdapter $t $arguments $prose
            $r.Exit | Should Be 1
            $r.Output | Should Match 'no YAML frontmatter'
        }
        Test-Path $t.Worktree | Should Be $false
    }
}

Describe 'worktree.ps1 removed actions' {
    It 'rejects Add and Remove, which #38 removed' {
        $t = New-AdapterRepo
        foreach ($action in 'Add', 'Remove') {
            $r = Invoke-Worktree @('-Action', $action, '-RepoRoot', $t.Repo, '-Package', '1')
            $r.Exit | Should Not Be 0
            $r.Output | Should Match 'ValidateSet|Up, Down, CleanupStale'
        }
    }
}
