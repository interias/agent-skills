# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\experimente\scripts\blind.Tests.ps1
# Each test builds a throwaway repo with a reference commit and two branches that change,
# add, delete and (binary) replace files, and calls the script as a separate process via
# `powershell -File`.

$script = Join-Path $PSScriptRoot 'blind.ps1'
$branchA = 'lauf/alpha-mit-epic'
$branchB = 'lauf/beta-schlank'
$utf8 = New-Object Text.UTF8Encoding $false
$umlautName ="Pr$([char]0xFC)fung-$([char]0xE4).txt"

function New-TestRepo {
    $root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $repo = Join-Path $root 'repo'
    New-Item -ItemType Directory -Path $repo -Force | Out-Null
    $git = { git -C $repo -c core.autocrlf=false -c user.name=t -c user.email=t@t @args }
    git -C $repo init -q -b main
    Set-Content -Path (Join-Path $repo 'changed.txt') -Value "one`ntwo`nthree"
    Set-Content -Path (Join-Path $repo 'gone.txt') -Value 'to be deleted'
    [IO.File]::WriteAllBytes((Join-Path $repo 'data.bin'), [byte[]](0, 1, 2, 255, 0, 7))
    # Awkward cases for a complete diff: a rename, CRLF line ends, trailing blanks, umlauts in a name.
    Set-Content -Path (Join-Path $repo 'rename-me.txt') -Value (1..10 | ForEach-Object { "stable line $_" })
    [IO.File]::WriteAllText((Join-Path $repo 'crlf.txt'), "first`r`nsecond`r`n")
    [IO.File]::WriteAllText((Join-Path $repo 'trail.txt'), "kept   `nplain`n")
    [IO.File]::WriteAllText((Join-Path $repo $umlautName), "alt`n", $utf8)
    & $git add .
    & $git commit -q -m reference
    $ref = (& $git rev-parse HEAD)

    # Branch A: modifies, adds, deletes, replaces the binary file.
    & $git checkout -q -b $branchA
    Add-Content -Path (Join-Path $repo 'changed.txt') -Value 'four-appended'
    Set-Content -Path (Join-Path $repo 'extra-1.txt') -Value 'new file one'
    Remove-Item (Join-Path $repo 'gone.txt')
    [IO.File]::WriteAllBytes((Join-Path $repo 'data.bin'), [byte[]](9, 0, 0, 255, 254))
    & $git mv rename-me.txt renamed-one.txt
    Add-Content -Path (Join-Path $repo 'renamed-one.txt') -Value 'tail one'
    [IO.File]::AppendAllText((Join-Path $repo 'crlf.txt'), "third-one`r`n")
    [IO.File]::AppendAllText((Join-Path $repo 'trail.txt'), "blanks-one  `t`n")
    [IO.File]::WriteAllText((Join-Path $repo $umlautName), "alt`nneu-eins`n", $utf8)
    & $git add -A
    & $git commit -q -m alpha

    # Branch B: its own set of changes.
    & $git checkout -q -b $branchB $ref
    Set-Content -Path (Join-Path $repo 'changed.txt') -Value "one`nTWO`nthree"
    Set-Content -Path (Join-Path $repo 'extra-2.txt') -Value 'new file two'
    Remove-Item (Join-Path $repo 'gone.txt')
    [IO.File]::WriteAllBytes((Join-Path $repo 'data.bin'), [byte[]](5, 5, 0, 0, 1))
    & $git mv rename-me.txt renamed-two.txt
    Add-Content -Path (Join-Path $repo 'renamed-two.txt') -Value 'tail two'
    [IO.File]::AppendAllText((Join-Path $repo 'crlf.txt'), "third-two`r`n")
    [IO.File]::AppendAllText((Join-Path $repo 'trail.txt'), "blanks-two  `t`n")
    [IO.File]::WriteAllText((Join-Path $repo $umlautName), "alt`nneu-zwei`n", $utf8)
    & $git add -A
    & $git commit -q -m beta
    & $git checkout -q main

    @{ Repo = $repo; Ref = $ref; Out = (Join-Path $root 'out') }
}

function Invoke-Blind([string[]]$arguments) {
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $script @arguments 2>&1
    @{ Exit = $LASTEXITCODE; Output = ($output | Out-String) }
}

function Invoke-BlindDefault($t, [string[]]$extra = @()) {
    Invoke-Blind (@('-RepoRoot', $t.Repo, '-Branches', "$branchA,$branchB", '-Reference', $t.Ref, '-OutDir', $t.Out) + $extra)
}

function Get-Mapping($t) {
    Get-Content -LiteralPath (Join-Path $t.Out 'zuordnung-erst-nach-dem-urteil\zuordnung.json') -Raw | ConvertFrom-Json
}

function Get-ExpectedDiff($t, [string]$branch, [string]$name) {
    $file = Join-Path (Split-Path $t.Repo -Parent) "$name.expected"
    git -C $t.Repo --no-pager -c core.quotepath=false diff --binary --no-color --no-ext-diff --no-textconv "--output=$file" $t.Ref $branch
    $file
}

function Test-SameBytes([string]$one, [string]$two) {
    $x = [IO.File]::ReadAllBytes($one)
    $y = [IO.File]::ReadAllBytes($two)
    if ($x.Length -ne $y.Length) { return $false }
    for ($i = 0; $i -lt $x.Length; $i++) { if ($x[$i] -ne $y[$i]) { return $false } }
    $true
}

Describe 'blind.ps1 random order' {
    It 'yields both assignments under a fixed seed, repeatably' {
        $seen = @{}
        foreach ($seed in 1..12) {
            $t = New-TestRepo
            (Invoke-BlindDefault $t @('-Seed', $seed)).Exit | Should Be 0
            $seen[(Get-Mapping $t).A] = $true
            $t2 = New-TestRepo
            (Invoke-BlindDefault $t2 @('-Seed', $seed)).Exit | Should Be 0
            (Get-Mapping $t2).A | Should Be (Get-Mapping $t).A
            if ($seen.Count -eq 2) { break }
        }
        $seen.ContainsKey($branchA) | Should Be $true
        $seen.ContainsKey($branchB) | Should Be $true
    }

    It 'shows both orders without a seed (20 runs; false alarm 2^-19)' {
        $t = New-TestRepo
        $seen = @{}
        foreach ($i in 1..20) {
            $out = Join-Path $TestDrive "run$i"
            $r = Invoke-Blind @('-RepoRoot', $t.Repo, '-Branches', "$branchA,$branchB", '-Reference', $t.Ref, '-OutDir', $out)
            $r.Exit | Should Be 0
            $m = Get-Content -LiteralPath (Join-Path $out 'zuordnung-erst-nach-dem-urteil\zuordnung.json') -Raw | ConvertFrom-Json
            $seen[$m.A] = $true
        }
        $seen.Count | Should Be 2
    }
}

Describe 'blind.ps1 separate assignment' {
    It 'keeps the assignment away from the diffs and names no branch in diffs or console' {
        $t = New-TestRepo
        $r = Invoke-BlindDefault $t @('-Seed', 3)
        $r.Exit | Should Be 0
        @(Get-ChildItem -LiteralPath $t.Out -File | ForEach-Object Name | Sort-Object) -join ',' | Should Be 'A.diff,B.diff'
        $mapping = Join-Path $t.Out 'zuordnung-erst-nach-dem-urteil\zuordnung.json'
        Test-Path $mapping | Should Be $true
        (Split-Path $mapping -Parent) | Should Not Be $t.Out
        $m = Get-Mapping $t
        $m.reference | Should Be $t.Ref
        @($m.A, $m.B | Sort-Object) -join ',' | Should Be (@($branchA, $branchB | Sort-Object) -join ',')
        foreach ($text in @($r.Output, (Get-Content (Join-Path $t.Out 'A.diff') -Raw), (Get-Content (Join-Path $t.Out 'B.diff') -Raw))) {
            $text | Should Not Match 'alpha'
            $text | Should Not Match 'beta'
            $text | Should Not Match 'lauf/'
            $text | Should Not Match ([regex]::Escape($m.A))
        }
    }
}

Describe 'blind.ps1 complete diffs' {
    It 'writes git diff --binary of the assigned branch, byte for byte, with every file' {
        $t = New-TestRepo
        (Invoke-BlindDefault $t @('-Seed', 5)).Exit | Should Be 0
        $m = Get-Mapping $t
        foreach ($label in 'A', 'B') {
            $branch = $m.$label
            $expected = Get-ExpectedDiff $t $branch "exp$label"
            Test-SameBytes (Join-Path $t.Out "$label.diff") $expected | Should Be $true
            $text = Get-Content (Join-Path $t.Out "$label.diff") -Raw
            foreach ($file in 'changed.txt', 'gone.txt', 'data.bin') { $text | Should Match ([regex]::Escape($file)) }
            $text | Should Match 'deleted file mode'
            $text | Should Match 'GIT binary patch'
            $text | Should Match 'new file mode'
        }
        (Get-Content (Join-Path $t.Out 'A.diff') -Raw) | Should Not Be (Get-Content (Join-Path $t.Out 'B.diff') -Raw)
    }

    It 'keeps renames, CRLF, trailing blanks and umlaut names intact' {
        $t = New-TestRepo
        (Invoke-BlindDefault $t @('-Seed', 5)).Exit | Should Be 0
        $m = Get-Mapping $t
        foreach ($label in 'A', 'B') {
            $n = if ($m.$label -eq $branchA) { 'one' } else { 'two' }
            $text = [IO.File]::ReadAllText((Join-Path $t.Out "$label.diff"), $utf8)
            $text | Should Match "rename from rename-me\.txt"
            $text | Should Match "rename to renamed-$n\.txt"
            $text | Should Match "(?m)^\+third-$n\r\n"
            $text | Should Match "(?m)^\+blanks-$n  \t\n"
            $text | Should Match ([regex]::Escape("b/$umlautName"))
            $text | Should Match "(?m)^\+neu-"
        }
    }

    It 'ignores textconv filters configured in the repository' {
        $t = New-TestRepo
        git -C $t.Repo config diff.shout.textconv 'tr a-z A-Z <'
        Set-Content -Path (Join-Path $t.Repo '.git\info\attributes') -Value '*.txt diff=shout'
        (Invoke-BlindDefault $t @('-Seed', 5)).Exit | Should Be 0
        foreach ($label in 'A', 'B') {
            $text = [IO.File]::ReadAllText((Join-Path $t.Out "$label.diff"), $utf8)
            $text | Should MatchExactly '(?m)^\+tail (one|two)'
            $text | Should Not MatchExactly 'TAIL'
        }
    }
}

Describe 'blind.ps1 refusals' {
    It 'refuses relative paths' {
        $t = New-TestRepo
        $r = Invoke-Blind @('-RepoRoot', $t.Repo, '-Branches', "$branchA,$branchB", '-Reference', $t.Ref, '-OutDir', 'out')
        $r.Exit | Should Be 1
        $r.Output | Should Match 'not an absolute path'
        $r = Invoke-Blind @('-RepoRoot', 'repo', '-Branches', "$branchA,$branchB", '-OutDir', $t.Out)
        $r.Exit | Should Be 1
        Test-Path $t.Out | Should Be $false
    }

    It 'refuses an unknown branch and writes nothing' {
        $t = New-TestRepo
        $r = Invoke-Blind @('-RepoRoot', $t.Repo, '-Branches', "$branchA,does-not-exist", '-Reference', $t.Ref, '-OutDir', $t.Out)
        $r.Exit | Should Be 1
        $r.Output | Should Match 'does-not-exist'
        Test-Path $t.Out | Should Be $false
    }

    It 'refuses an unknown reference and a wrong number of branches' {
        $t = New-TestRepo
        (Invoke-Blind @('-RepoRoot', $t.Repo, '-Branches', "$branchA,$branchB", '-Reference', 'deadbeef', '-OutDir', $t.Out)).Exit | Should Be 1
        (Invoke-Blind @('-RepoRoot', $t.Repo, '-Branches', $branchA, '-Reference', $t.Ref, '-OutDir', $t.Out)).Exit | Should Be 1
        Test-Path $t.Out | Should Be $false
    }

    It 'refuses existing output and overwrites nothing' {
        $t = New-TestRepo
        (Invoke-BlindDefault $t @('-Seed', 1)).Exit | Should Be 0
        $mapping = Join-Path $t.Out 'zuordnung-erst-nach-dem-urteil\zuordnung.json'
        $before = @('A.diff', 'B.diff' | ForEach-Object { Get-FileHash (Join-Path $t.Out $_) }) + (Get-FileHash $mapping)
        $r = Invoke-BlindDefault $t @('-Seed', 2)
        $r.Exit | Should Be 1
        $r.Output | Should Match 'already exists'
        $after = @('A.diff', 'B.diff' | ForEach-Object { Get-FileHash (Join-Path $t.Out $_) }) + (Get-FileHash $mapping)
        for ($i = 0; $i -lt 3; $i++) { $after[$i].Hash | Should Be $before[$i].Hash }
    }

    It 'refuses when only the assignment file is left over' {
        $t = New-TestRepo
        $sealed = Join-Path $t.Out 'zuordnung-erst-nach-dem-urteil'
        New-Item -ItemType Directory -Path $sealed -Force | Out-Null
        Set-Content (Join-Path $sealed 'zuordnung.json') -Value 'old'
        (Invoke-BlindDefault $t).Exit | Should Be 1
        Get-Content (Join-Path $sealed 'zuordnung.json') | Should Be 'old'
        Test-Path (Join-Path $t.Out 'A.diff') | Should Be $false
    }
}
