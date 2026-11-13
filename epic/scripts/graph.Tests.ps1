# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\epic\scripts\graph.Tests.ps1
# graphify is replaced by a .cmd stub through -GraphifyCommand; the script runs as a separate
# process, the way /epic calls it. Needs git.

$script = Join-Path $PSScriptRoot 'graph.ps1'

function Invoke-Graph([string[]]$arguments) {
    $errFile = Join-Path $TestDrive ([guid]::NewGuid().ToString('N') + '.err')
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script @arguments 2>$errFile
    @{ Exit = $LASTEXITCODE; Out = @($out | Where-Object { $_ -ne $null }); Err = ((Get-Content $errFile -Raw) -replace '\s+', ' ') }
}

function New-Repo([string]$frontmatter) {
    $repo = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $repo -Force | Out-Null
    & git -C $repo init -q 2>$null | Out-Null
    if ($frontmatter) {
        New-Item -ItemType Directory -Path (Join-Path $repo '.claude') -Force | Out-Null
        Set-Content -Path (Join-Path $repo '.claude\epic.md') -Value "---`n$frontmatter`n---`n`n# Adapter"
    }
    $repo
}

# A stand-in for graphify: writes graph.json below the --out directory (argument 6) and prints
# the summary line of the real tool; with -Failing it exits 2 instead.
function New-Stub([switch]$Failing) {
    $path = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8) + '.cmd')
    if ($Failing) { Set-Content -Path $path -Value "@echo off`r`necho boom 1>&2`r`nexit /b 2" }
    else { Set-Content -Path $path -Value "@echo off`r`nmkdir `"%~6\graphify-out`" 2>nul`r`necho {} > `"%~6\graphify-out\graph.json`"`r`necho [graphify extract] wrote graph.json - 120 nodes, 340 edges (no clustering)`r`necho ARGS %*" }
    $path
}

Describe 'graph.ps1 Build' {
    It 'builds into the git common dir and reports the graph' {
        $repo = New-Repo
        $r = Invoke-Graph @('-RepoRoot', $repo, '-Worktree', $repo, '-Package', 'epic-41', '-GraphifyCommand', (New-Stub))
        $r.Exit | Should Be 0
        $r.Out.Count | Should Be 1
        $j = $r.Out[0] | ConvertFrom-Json
        $j.available | Should Be $true
        $j.nodes | Should Be 120
        $j.edges | Should Be 340
        $j.graph | Should Be (Join-Path (Resolve-Path $repo).Path '.git\epic-graph\epic-41\graphify-out\graph.json')
        Test-Path $j.graph | Should Be $true
    }
    It 'calls graphify for code only, without clustering, and leaves the source tree alone' {
        $repo = New-Repo
        $r = Invoke-Graph @('-RepoRoot', $repo, '-Worktree', $repo, '-Package', 'epic-41', '-GraphifyCommand', (New-Stub))
        $r.Err | Should Match 'ARGS extract .* --code-only --no-cluster --out '
        (& git -C $repo status --porcelain) | Should BeNullOrEmpty
    }
    It 'reports available=false and exits 0 when the adapter switches the graph off' {
        $repo = New-Repo 'code_graph: off  # too small to matter'
        $r = Invoke-Graph @('-RepoRoot', $repo, '-Worktree', $repo, '-Package', 'epic-41', '-GraphifyCommand', (New-Stub))
        $r.Exit | Should Be 0
        $j = $r.Out[0] | ConvertFrom-Json
        $j.available | Should Be $false
        $j.reason | Should Match 'code_graph'
        Test-Path (Join-Path $repo '.git\epic-graph') | Should Be $false
    }
    It 'fails when graphify fails' {
        $repo = New-Repo
        $r = Invoke-Graph @('-RepoRoot', $repo, '-Worktree', $repo, '-Package', 'epic-41', '-GraphifyCommand', (New-Stub -Failing))
        $r.Exit | Should Be 1
        $r.Out.Count | Should Be 0
        $r.Err | Should Match 'exit code 2'
    }
    It 'refuses a package name that could leave the graph directory' {
        $repo = New-Repo
        $r = Invoke-Graph @('-RepoRoot', $repo, '-Worktree', $repo, '-Package', '..\x', '-GraphifyCommand', (New-Stub))
        $r.Exit | Should Be 1
    }
    It 'fails outside a git repository' {
        $dir = Join-Path $TestDrive 'plain'
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        (Invoke-Graph @('-RepoRoot', $dir, '-Worktree', $dir, '-Package', 'epic-41', '-GraphifyCommand', (New-Stub))).Exit | Should Be 1
    }
}

Describe 'graph.ps1 Remove' {
    It 'removes the graph of the package and only that' {
        $repo = New-Repo
        $stub = New-Stub
        Invoke-Graph @('-RepoRoot', $repo, '-Worktree', $repo, '-Package', 'epic-41', '-GraphifyCommand', $stub) | Out-Null
        Invoke-Graph @('-RepoRoot', $repo, '-Worktree', $repo, '-Package', 'epic-42', '-GraphifyCommand', $stub) | Out-Null
        $r = Invoke-Graph @('-Action', 'Remove', '-RepoRoot', $repo, '-Package', 'epic-41')
        $r.Exit | Should Be 0
        ($r.Out[0] | ConvertFrom-Json).removed | Should Be $true
        Test-Path (Join-Path $repo '.git\epic-graph\epic-41') | Should Be $false
        Test-Path (Join-Path $repo '.git\epic-graph\epic-42') | Should Be $true
    }
    It 'reports removed=false when there is no graph' {
        $repo = New-Repo
        $r = Invoke-Graph @('-Action', 'Remove', '-RepoRoot', $repo, '-Package', 'epic-41')
        $r.Exit | Should Be 0
        ($r.Out[0] | ConvertFrom-Json).removed | Should Be $false
    }
}
