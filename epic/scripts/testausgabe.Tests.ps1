# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\epic\scripts\testausgabe.Tests.ps1
# Hook mode: each test hands a hook input as JSON on stdin to the script, run as a separate process
# the way Claude Code runs a hook. Summary mode: the script runs on a log file. The rewritten
# commands are also run through bash and PowerShell to prove the exit code and the log survive.

$script = Join-Path $PSScriptRoot 'testausgabe.ps1'
$utf8 = New-Object Text.UTF8Encoding $false

function Invoke-Hook([string]$command, [string]$cwd, [string]$tool = 'Bash', [string]$raw) {
    if (-not $PSBoundParameters.ContainsKey('raw')) {
        $raw = ConvertTo-Json -Compress -InputObject @{ tool_name = $tool; tool_input = @{ command = $command; description = 'Tests'; timeout = 600000 }; cwd = $cwd; hook_event_name = 'PreToolUse' }
    }
    $info = New-Object Diagnostics.ProcessStartInfo 'powershell.exe'
    $info.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = $utf8; $info.StandardErrorEncoding = $utf8
    $p = [Diagnostics.Process]::Start($info)
    $bytes = $utf8.GetBytes($raw)
    $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $p.StandardInput.Close()
    $stdout = $p.StandardOutput.ReadToEndAsync(); $stderr = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    $updated = $null
    if ($stdout.Result.Trim()) { $updated = ($stdout.Result | ConvertFrom-Json).hookSpecificOutput }
    @{ Exit = $p.ExitCode; Out = $updated; Err = $stderr.Result }
}

function New-Repo([string]$frontMatter) {
    $root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path (Join-Path $root '.claude') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $root 'sub') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $root '.claude\epic.md'), "---`n$frontMatter`n---`n`n# Adapter`n")
    $root
}

$adapter = @"
test_commands:
  client: npm test
  server: pytest -q
test_commands_affected: [npm run test:changed]
gate_command: npm test -- --gate
acceptance_commands:
  - npm run e2e
"@

Describe 'testausgabe.ps1 hook' {
    $repo = New-Repo $adapter

    It 'rewrites a test command from a suite map, keeping the original readable' {
        $r = Invoke-Hook 'npm test' $repo
        $r.Exit | Should Be 0
        $r.Out.hookEventName | Should Be 'PreToolUse'
        $r.Out.permissionDecision | Should BeNullOrEmpty
        $r.Out.updatedInput.command | Should Match '^\{ npm test\n\} > ''[^'']+epic-testausgabe/[^'']+\.log'' 2>&1; __rc=\$\?; powershell .+-Kurz .+-Exit \$__rc; \(exit \$__rc\)$'
    }

    It 'keeps the other input fields' {
        $r = Invoke-Hook 'pytest -q' $repo
        $r.Out.updatedInput.description | Should Be 'Tests'
        $r.Out.updatedInput.timeout | Should Be 600000
    }

    It 'takes plain arguments, a leading cd and variable assignments' {
        (Invoke-Hook 'npm test src/a.test.ts --maxWorkers=2' $repo).Out | Should Not BeNullOrEmpty
        (Invoke-Hook "cd `"$repo`" && CI=1 npm test" 'C:\').Out | Should Not BeNullOrEmpty
        (Invoke-Hook 'npm run test:changed' (Join-Path $repo 'sub')).Out | Should Not BeNullOrEmpty
    }

    It 'rewrites for the PowerShell tool with its own redirection' {
        $r = Invoke-Hook "`$env:CI='1'; pytest -q" $repo 'PowerShell'
        $r.Out.updatedInput.command | Should Match '^& \{ \$env:CI=''1''; pytest -q\n\} \*> ''[^'']+\.log''; \$__rc = \$LASTEXITCODE; '
    }

    It 'leaves gate, acceptance, piped, redirected and unknown commands alone' {
        foreach ($c in @('npm test -- --gate', 'npm run e2e', 'npm test | tail -5', 'npm test > x.log', 'npm test && rm x', 'npm testing', 'git status', 'EPIC_TESTAUSGABE=voll npm test')) {
            $r = Invoke-Hook $c $repo
            $r.Exit | Should Be 0
            $r.Out | Should BeNullOrEmpty
        }
    }

    It 'passes without an adapter, for other tools and on garbage' {
        (Invoke-Hook 'npm test' $TestDrive).Out | Should BeNullOrEmpty
        (Invoke-Hook 'npm test' $repo 'Read').Out | Should BeNullOrEmpty
        $r = Invoke-Hook -raw 'kein json'
        $r.Exit | Should Be 0
        $r.Out | Should BeNullOrEmpty
    }

    It 'reads a flat list adapter' {
        $flat = New-Repo 'test_commands: [bun test, "pwsh -NoProfile -File t.ps1"]'
        (Invoke-Hook 'bun test' $flat).Out | Should Not BeNullOrEmpty
        (Invoke-Hook 'pwsh -NoProfile -File t.ps1 -Fast' $flat).Out | Should Not BeNullOrEmpty
    }
}

Describe 'testausgabe.ps1 rewritten command' {
    $repo = New-Repo 'test_commands: [bash t.sh]'
    [IO.File]::WriteAllText((Join-Path $repo 't.sh'), "for i in `$(seq 1 200); do echo `"(pass) test `$i`"; done`necho '(fail) rechnet > wirft'`necho '   expected 1, got 2'`nfor i in `$(seq 201 300); do echo `"(pass) test `$i`"; done`necho ' 300 pass'`necho ' 1 fail'`nexit 3`n")

    It 'runs in bash, keeps the exit code and the full log, shows only the summary' {
        $r = Invoke-Hook 'bash t.sh' $repo
        $cmd = $r.Out.updatedInput.command
        Push-Location $repo
        try { $out = @(& bash -c $cmd 2>&1); $code = $LASTEXITCODE } finally { Pop-Location }
        $code | Should Be 3
        $text = $out -join "`n"
        $text | Should Match '\(fail\) rechnet > wirft'
        $text | Should Match 'expected 1, got 2'
        $text | Should Match ' 1 fail'
        $text | Should Match '\[testausgabe\] Exit 3'
        $text | Should Not Match '\(pass\) test 5\b'
        $out.Count | Should BeLessThan 60
        $log = [regex]::Match($cmd, "> '([^']+)'").Groups[1].Value
        @([IO.File]::ReadAllLines($log)).Count | Should Be 304
    }
}

Describe 'testausgabe.ps1 -Kurz' {
    function Invoke-Kurz([string[]]$lines, [int]$code = 0) {
        $log = Join-Path $TestDrive ([guid]::NewGuid().ToString('N') + '.log')
        [IO.File]::WriteAllLines($log, $lines, $utf8)
        $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Kurz $log -Exit $code
        @{ Lines = @($out); Log = $log }
    }

    It 'prints a short log in full' {
        $r = Invoke-Kurz @('a', 'b', ' 2 pass', ' 0 fail') 0
        $r.Lines.Count | Should Be 5
        $r.Lines[3] | Should Be ' 0 fail'
        $r.Lines[4] | Should Match '^\[testausgabe\] Exit 0, 4 Zeilen, voller Log: '
    }

    It 'shortens a long green log to its end without false failure lines' {
        $lines = @(1..500 | ForEach-Object { "ok $_ - test $_" }) + @('# pass 500', '# fail 0', ' 0 fail', 'errors: 0')
        $r = Invoke-Kurz $lines 0
        ($r.Lines -join "`n") | Should Not Match 'Fehlerzeilen'
        $r.Lines.Count | Should Be 43
        $r.Lines[-2] | Should Be 'errors: 0'
    }

    It 'caps the failure lines at 30' {
        $lines = @(1..200 | ForEach-Object { "not ok $_ - kaputt" }) + @(1..50 | ForEach-Object { "ok $_" })
        $r = Invoke-Kurz $lines 1
        @($r.Lines | Where-Object { $_ -match '^\s+\d+: not ok' }).Count | Should Be 33
        $r.Lines.Count | Should BeLessThan 125
    }
}
