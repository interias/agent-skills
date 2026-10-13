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
