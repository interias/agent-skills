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

function Add-TestWorktree($t) {
    Invoke-Worktree @('-Action', 'Add', '-RepoRoot', $t.Repo, '-WorktreePath', $t.Worktree,
        '-Branch', 'agent/1-test', '-From', 'main', '-LinkDirs', 'server/node_modules',
        '-EnvFiles', 'server/.env', '-SetEnv', 'server/.env:TEST_DB_SUFFIX=1,server/.env:PORT=3001')
}

function Remove-TestWorktree($t) {
    Invoke-Worktree @('-Action', 'Remove', '-RepoRoot', $t.Repo, '-WorktreePath', $t.Worktree)
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

function Get-PathWithoutDocker {
    @($env:PATH -split ';' | Where-Object {
        $dir = $_
        $dir -and -not (@('docker.exe', 'docker.cmd', 'docker.bat') | Where-Object { try { [IO.File]::Exists([IO.Path]::Combine($dir, $_)) } catch { $false } })
    }) -join ';'
}

# A docker.cmd that logs every call and answers `ps` and `inspect` with the given containers.
function New-DockerStub($containers) {
    $dir = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8) + '-docker')
    New-Item -ItemType Directory -Path $dir | Out-Null
    Set-Content -Path (Join-Path $dir 'docker.cmd') -Encoding Ascii -Value @'
@echo off
echo %*>>"%~dp0calls.log"
if "%1"=="ps" type "%~dp0ps.txt"
if "%1"=="inspect" type "%~dp0inspect.json"
exit /b 0
'@
    $i = 0
    $list = @(foreach ($c in $containers) {
        $i++
        @{ Id = "c$i"; Config = @{ Labels = @{ 'com.docker.compose.project' = $c.Project; 'com.docker.compose.project.working_dir' = $c.WorkingDir } } }
    })
    Set-Content -Path (Join-Path $dir 'ps.txt') -Encoding Ascii -Value ($list | ForEach-Object { $_.Id })
    Set-Content -Path (Join-Path $dir 'inspect.json') -Encoding Ascii -Value (ConvertTo-Json -InputObject $list -Depth 5)
    $dir
}

function Invoke-DownWithPath($t, [string]$path) {
    $saved = $env:PATH
    try { $env:PATH = $path; Invoke-Down $t } finally { $env:PATH = $saved }
}

function Invoke-DownWithDocker($t, $containers) {
    $stub = New-DockerStub $containers
    $r = Invoke-DownWithPath $t "$stub;$(Get-PathWithoutDocker)"
    $log = Join-Path $stub 'calls.log'
    $r.Calls = if (Test-Path $log) { Get-Content $log -Raw } else { '' }
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
        $r = Invoke-DownWithDocker $t @(@{ Project = 'repo-1'; WorkingDir = 'C:\elsewhere' })
        $r.Exit | Should Be 0
        $r.Calls | Should Match '(?m)^compose -p repo-1 down'
        $r.Output | Should Match 'Stopped compose project repo-1'
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
}

Describe 'worktree.ps1 Add' {
    It 'creates the worktree with a junction, not a copy' {
        $t = New-TestRepo
        $r = Add-TestWorktree $t
        $r.Exit | Should Be 0
        $link = Get-Item (Join-Path $t.Worktree 'server\node_modules') -Force
        $link.LinkType | Should Be 'Junction'
        @($link.Target)[0] | Should Be (Join-Path $t.Repo 'server\node_modules')
        git -C $t.Worktree status --porcelain | Should BeNullOrEmpty
    }

    It 'copies env files and sets the variables in the copy only' {
        $t = New-TestRepo
        (Add-TestWorktree $t).Exit | Should Be 0
        $copy = Get-Content (Join-Path $t.Worktree 'server\.env') -Raw
        $copy | Should Match '(?m)^TEST_DB_SUFFIX=1\r?$'
        $copy | Should Match '(?m)^PORT=3001\r?$'
        $copy | Should Match '(?m)^DB=app\r?$'
        Get-Content (Join-Path $t.Repo 'server\.env') -Raw | Should Match 'TEST_DB_SUFFIX=main'
    }

    It 'creates junctions when called from Git Bash too' {
        $bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
        if (-not (Test-Path $bash)) { Set-TestInconclusive 'Git Bash not found' }
        $t = New-TestRepo
        $cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File '$($script -replace '\\','/')' -Action Add " +
            "-RepoRoot '$($t.Repo -replace '\\','/')' -WorktreePath '$($t.Worktree -replace '\\','/')' " +
            "-Branch agent/1-test -From main -LinkDirs server/node_modules -EnvFiles server/.env"
        & $bash -lc $cmd 2>$null | Out-Null
        $LASTEXITCODE | Should Be 0
        (Get-Item (Join-Path $t.Worktree 'server\node_modules') -Force).LinkType | Should Be 'Junction'
    }

    It 'reuses an existing branch' {
        $t = New-TestRepo
        git -C $t.Repo branch agent/1-test main
        $r = Invoke-Worktree @('-Action', 'Add', '-RepoRoot', $t.Repo, '-WorktreePath', $t.Worktree, '-Branch', 'agent/1-test')
        $r.Exit | Should Be 0
        git -C $t.Worktree rev-parse --abbrev-ref HEAD | Should Be 'agent/1-test'
    }

    It 'refuses an existing path' {
        $t = New-TestRepo
        New-Item -ItemType Directory -Path $t.Worktree -Force | Out-Null
        $r = Add-TestWorktree $t
        $r.Exit | Should Be 1
        $r.Output | Should Match 'already exists'
    }

    It 'refuses a missing link target before creating anything' {
        $t = New-TestRepo
        $r = Invoke-Worktree @('-Action', 'Add', '-RepoRoot', $t.Repo, '-WorktreePath', $t.Worktree,
            '-Branch', 'agent/1-test', '-From', 'main', '-LinkDirs', 'client/node_modules')
        $r.Exit | Should Be 1
        Test-Path $t.Worktree | Should Be $false
    }

    It 'refuses relative paths' {
        $t = New-TestRepo
        $r = Invoke-Worktree @('-Action', 'Add', '-RepoRoot', $t.Repo, '-WorktreePath', 'wt\1', '-Branch', 'x', '-From', 'main')
        $r.Exit | Should Be 1
        $r.Output | Should Match 'not an absolute path'
    }
}

Describe 'worktree.ps1 Remove' {
    It 'removes the junction, not its target, and keeps the branch' {
        $t = New-TestRepo
        (Add-TestWorktree $t).Exit | Should Be 0
        $before = @(Get-ChildItem (Join-Path $t.Repo 'server\node_modules') -Recurse -Force).Count
        $r = Remove-TestWorktree $t
        $r.Exit | Should Be 0
        Test-Path $t.Worktree | Should Be $false
        @(Get-ChildItem (Join-Path $t.Repo 'server\node_modules') -Recurse -Force).Count | Should Be $before
        Test-Path (Join-Path $t.Repo 'server\node_modules\dep\index.js') | Should Be $true
        git -C $t.Repo branch --list agent/1-test | Should Match 'agent/1-test'
    }

    It 'leaves a dirty worktree alone' {
        $t = New-TestRepo
        (Add-TestWorktree $t).Exit | Should Be 0
        Add-Content -Path (Join-Path $t.Worktree 'server\app.js') -Value '// change'
        $r = Remove-TestWorktree $t
        $r.Exit | Should Be 1
        $r.Output | Should Match 'not clean'
        (Get-Item (Join-Path $t.Worktree 'server\node_modules') -Force).LinkType | Should Be 'Junction'
    }

    It 'stops at a junction it did not create, without deleting through it' {
        $t = New-TestRepo
        (Add-TestWorktree $t).Exit | Should Be 0
        New-Item -ItemType Directory -Path (Join-Path $t.Worktree 'extra') | Out-Null
        New-Item -ItemType Junction -Path (Join-Path $t.Worktree 'extra\node_modules') -Value (Join-Path $t.Repo 'server\node_modules') | Out-Null
        $r = Remove-TestWorktree $t
        $r.Exit | Should Be 1
        $r.Output | Should Match 'Reparse points'
        Test-Path (Join-Path $t.Repo 'server\node_modules\dep\index.js') | Should Be $true
        [IO.Directory]::Delete((Join-Path $t.Worktree 'extra\node_modules'), $false)
    }

    It 'refuses a worktree without manifest' {
        $t = New-TestRepo
        git -C $t.Repo worktree add -q $t.Worktree -b agent/1-test main
        $r = Remove-TestWorktree $t
        $r.Exit | Should Be 1
        $r.Output | Should Match 'No manifest'
        Test-Path $t.Worktree | Should Be $true
    }
}
