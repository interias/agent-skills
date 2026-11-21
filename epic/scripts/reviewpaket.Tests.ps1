# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\epic\scripts\reviewpaket.Tests.ps1

$script = Join-Path $PSScriptRoot 'reviewpaket.ps1'

function New-Worktree {
    $root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $repo = Join-Path $root 'repo'
    New-Item -ItemType Directory -Path $repo -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $repo 'a.txt'), "eins`nzwei`ndrei`n")
    [IO.File]::WriteAllText((Join-Path $repo '.gitignore'), "node_modules/`n")
    git -C $repo init -q -b main
    git -C $repo -c core.autocrlf=false add .
    git -C $repo -c user.name=t -c user.email=t@t commit -q -m init
    $wt = Join-Path $root 'wt\588'
    git -C $repo worktree add -q $wt -b agent/588-x main 2>$null
    $wt
}

function Invoke-Paket([string[]]$arguments) {
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script @arguments 2>$null
    @{ Exit = $LASTEXITCODE; Json = if ($out) { ($out -join '') | ConvertFrom-Json } else { $null } }
}

Describe 'reviewpaket.ps1' {
    It 'writes diff and new files into the git dir and leaves index and working tree alone' {
        $wt = New-Worktree
        [IO.File]::WriteAllText((Join-Path $wt 'a.txt'), "eins`nZWEI`ndrei`n")
        [IO.File]::WriteAllText((Join-Path $wt 'neu.ts'), "export const x = 1;`n")
        New-Item -ItemType Directory -Path (Join-Path $wt 'node_modules') | Out-Null
        [IO.File]::WriteAllText((Join-Path $wt 'node_modules\m.js'), 'x')
        $before = git -C $wt status --porcelain

        $r = Invoke-Paket @('-Worktree', $wt, '-Package', '588', '-Round', '1')
        $r.Exit | Should Be 0
        $r.Json.files | Should Be 2
        @($r.Json.new_files) | Should Be @('neu.ts')
        $r.Json.path | Should Match '/epic-review/588-r1\.md$'
        $r.Json.path | Should Not Match ([regex]::Escape(($wt -replace '\\', '/')))
        $text = [IO.File]::ReadAllText($r.Json.path)
        $text | Should Match '-zwei'
        $text | Should Match '\+ZWEI'
        $text | Should Match '### neu\.ts'
        $text | Should Match 'export const x = 1;'
        $text | Should Not Match 'node_modules'
        (git -C $wt status --porcelain) | Should Be $before
        (git -C $wt diff --cached --name-only) | Should BeNullOrEmpty
    }

    It 'shows only the fix since the previous round with -Since' {
        $wt = New-Worktree
        [IO.File]::WriteAllText((Join-Path $wt 'a.txt'), "eins`nZWEI`ndrei`n")
        $r1 = Invoke-Paket @('-Worktree', $wt, '-Package', '41-p2', '-Round', '1')
        [IO.File]::WriteAllText((Join-Path $wt 'a.txt'), "eins`nZWEI`nDREI`n")
        $r2 = Invoke-Paket @('-Worktree', $wt, '-Package', '41-p2', '-Round', '2', '-Since', $r1.Json.tree)
        $r2.Exit | Should Be 0
        $r2.Json.since | Should Be $r1.Json.tree
        $text = [IO.File]::ReadAllText($r2.Json.path)
        $text | Should Match '\+DREI'
        $text | Should Not Match '\+ZWEI'
        $r2.Json.path | Should Match '41-p2-r2\.md$'
    }

    It 'cuts a long diff and says so' {
        $wt = New-Worktree
        [IO.File]::WriteAllText((Join-Path $wt 'a.txt'), ((1..300 | ForEach-Object { "zeile $_" }) -join "`n"))
        $r = Invoke-Paket @('-Worktree', $wt, '-Package', '1', '-MaxLines', '50')
        $r.Json.cut | Should Be $true
        [IO.File]::ReadAllText($r.Json.path) | Should Match 'Gekürzt nach 50 Zeilen'
    }

    It 'fails with exit 1 outside a git worktree' {
        (Invoke-Paket @('-Worktree', $TestDrive, '-Package', '1')).Exit | Should Be 1
    }
}
