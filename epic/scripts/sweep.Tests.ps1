# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\epic\scripts\sweep.Tests.ps1
# Every test sweeps a throwaway root and temp folder and calls the script as a separate process.
# Docker is a docker.cmd stub in front of PATH, or -SkipDocker; no test reaches the real docker.

$script = Join-Path $PSScriptRoot 'sweep.ps1'

function New-Sandbox {
    $base = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $s = @{ Root = (Join-Path $base 'git'); Temp = (Join-Path $base 'temp') }
    New-Item -ItemType Directory -Path $s.Root, $s.Temp -Force | Out-Null
    $s
}

function Invoke-Sweep($s, [string[]]$extra = @('-SkipDocker')) {
    $errFile = Join-Path $TestDrive ([guid]::NewGuid().ToString('N') + '.err')
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Root $s.Root -TempRoot $s.Temp @extra 2>$errFile
    $json = @($out | Where-Object { $_ -ne $null })[-1]
    @{ Exit = $LASTEXITCODE; Entries = @($json | ConvertFrom-Json | ForEach-Object { $_ }); Err = ((Get-Content $errFile -Raw) -replace '\s+', ' ') }
}

function New-OldFolder([string]$path, [int]$days) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    Set-Content -Path (Join-Path $path 'file.txt') -Value 'x'
    (Get-Item $path).LastWriteTime = (Get-Date).AddDays(-$days)
    $path
}

# A docker.cmd that logs every call and exits 0.
function New-DockerStub {
    $dir = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8) + '-docker')
    New-Item -ItemType Directory -Path $dir | Out-Null
    Set-Content -Path (Join-Path $dir 'docker.cmd') -Encoding Ascii -Value "@echo off`r`necho %*>>`"%~dp0calls.log`"`r`nif `"%1`"==`"image`" echo Total reclaimed space: 1.5GB`r`nexit /b 0"
    $dir
}

function Invoke-SweepWithDocker($s, [string[]]$extra = @()) {
    $stub = New-DockerStub
    $saved = $env:PATH
    try { $env:PATH = "$stub;$env:PATH"; $r = Invoke-Sweep $s $extra } finally { $env:PATH = $saved }
    $log = Join-Path $stub 'calls.log'
    $r.Calls = if (Test-Path $log) { Get-Content $log -Raw } else { '' }
    $r
}

Describe 'sweep.ps1 temp folders' {
    It 'removes matching folders older than -TempDays and keeps recent and foreign ones' {
        $s = New-Sandbox
        $old = New-OldFolder (Join-Path $s.Temp 'HeadlessEdge123') 30
        $guard = New-OldFolder (Join-Path $s.Temp 'repo-guard-abc') 30
        $jest = New-OldFolder (Join-Path $s.Temp 'jest\jest-transform-cache-aa-bb') 30
        $recent = New-OldFolder (Join-Path $s.Temp 'HeadlessEdge456') 1
        $foreign = New-OldFolder (Join-Path $s.Temp 'something-else') 30
        $r = Invoke-Sweep $s
        $r.Exit | Should Be 0
        (Test-Path $old) | Should Be $false
        (Test-Path $guard) | Should Be $false
        (Test-Path $jest) | Should Be $false
        (Test-Path $recent) | Should Be $true
        (Test-Path $foreign) | Should Be $true
        @($r.Entries | Where-Object { $_.kind -eq 'temp' -and $_.action -eq 'removed' }).Count | Should Be 3
    }

    It 'never removes a folder with a junction inside, and the target stays' {
        $s = New-Sandbox
        $target = Join-Path $s.Root 'real'
        New-Item -ItemType Directory -Path $target | Out-Null
        Set-Content -Path (Join-Path $target 'keep.txt') -Value 'keep'
        $old = Join-Path $s.Temp 'HeadlessEdge789'
        New-Item -ItemType Directory -Path $old | Out-Null
        cmd /c mklink /J (Join-Path $old 'link') $target | Out-Null
        (Get-Item $old).LastWriteTime = (Get-Date).AddDays(-30)
        $r = Invoke-Sweep $s
        (Test-Path $old) | Should Be $true
        (Test-Path (Join-Path $target 'keep.txt')) | Should Be $true
        @($r.Entries | Where-Object { $_.kind -eq 'temp' -and $_.action -eq 'skipped' })[0].reason | Should Match 'reparse point inside'
    }

    It 'removes every WSL swap file but the newest' {
        $s = New-Sandbox
        $stale = Join-Path $s.Temp '11111111-2222-3333-4444-555555555555'
        $current = Join-Path $s.Temp '66666666-7777-8888-9999-AAAAAAAAAAAA'
        New-Item -ItemType Directory -Path $stale, $current | Out-Null
        Set-Content -Path (Join-Path $stale 'swap.vhdx') -Value 'old'
        Set-Content -Path (Join-Path $current 'swap.vhdx') -Value 'new'
        (Get-Item (Join-Path $stale 'swap.vhdx')).LastWriteTime = (Get-Date).AddDays(-3)
        $r = Invoke-Sweep $s
        (Test-Path $stale) | Should Be $false
        (Test-Path (Join-Path $current 'swap.vhdx')) | Should Be $true
        @($r.Entries | Where-Object { $_.kind -eq 'swap' -and $_.action -eq 'removed' }).Count | Should Be 1
    }

    It 'removes nothing with -DryRun and still reports it' {
        $s = New-Sandbox
        $old = New-OldFolder (Join-Path $s.Temp 'HeadlessEdge123') 30
        $r = Invoke-Sweep $s @('-SkipDocker', '-DryRun')
        (Test-Path $old) | Should Be $true
        @($r.Entries | Where-Object { $_.kind -eq 'temp' })[0].reason | Should Match 'would be removed'
    }
}

Describe 'sweep.ps1 repositories' {
    It 'runs CleanupStale in a repository with adapter frontmatter and passes its entries on' {
        $s = New-Sandbox
        $repo = Join-Path $s.Root 'app'
        New-Item -ItemType Directory -Path (Join-Path $repo '.claude') -Force | Out-Null
        Set-Content -Path (Join-Path $repo '.claude\epic.md') -Value "---`nworktree_root: ../app-worktrees`n---`n`n# Adapter"
        git -C $repo init -q -b main
        git -C $repo -c core.autocrlf=false add .
        git -C $repo -c user.name=t -c user.email=t@t commit -q -m init
        git -C $repo worktree add -q (Join-Path $s.Root 'app-worktrees\byhand') -b byhand
        $plain = Join-Path $s.Root 'plain'
        New-Item -ItemType Directory -Path $plain | Out-Null
        git -C $plain init -q -b main
        $r = Invoke-Sweep $s
        $r.Exit | Should Be 0
        $entry = @($r.Entries | Where-Object { $_.kind -eq 'worktree' })[0]
        $entry.repo | Should Be 'app'
        $entry.action | Should Be 'skipped'
        $entry.reason | Should Match 'no lock'
        @($r.Entries | Where-Object { $_.repo -eq 'plain' }).Count | Should Be 0
    }

    It 'fails for a -Root that is no folder' {
        $s = New-Sandbox
        $s.Root = Join-Path $s.Root 'missing'
        $errFile = Join-Path $TestDrive 'root.err'
        & powershell -NoProfile -ExecutionPolicy Bypass -File $script -Root $s.Root -SkipDocker 2>$errFile | Out-Null
        $LASTEXITCODE | Should Be 1
    }
}

Describe 'sweep.ps1 docker' {
    It 'prunes dangling images and build cache older than -BuildCacheDays' {
        $s = New-Sandbox
        $r = Invoke-SweepWithDocker $s
        $r.Exit | Should Be 0
        $r.Calls | Should Match '(?m)^image prune -f'
        $r.Calls | Should Match '(?m)^builder prune -f --filter until=168h'
        @($r.Entries | Where-Object { $_.id -eq 'image prune' })[0].reason | Should Match 'Total reclaimed space: 1.5GB'
    }

    It 'calls no prune with -DryRun' {
        $s = New-Sandbox
        $r = Invoke-SweepWithDocker $s @('-DryRun')
        $r.Calls | Should Not Match 'prune'
        @($r.Entries | Where-Object { $_.kind -eq 'docker' }).Count | Should Be 2
    }

    It 'leaves docker alone with -SkipDocker' {
        $s = New-Sandbox
        $r = Invoke-SweepWithDocker $s @('-SkipDocker')
        $r.Calls | Should Be ''
    }
}
