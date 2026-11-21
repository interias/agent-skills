# Pester 3.4 (Windows PowerShell 5.1) and pwsh 7: fortsetzen.ps1 continues an /epic session with
# guard.ps1 as a session hook, like the fleet driver.
$script = Join-Path $PSScriptRoot 'fortsetzen.ps1'

Describe 'fortsetzen.ps1' {
    $dir = Join-Path ([IO.Path]::GetTempPath()) "fortsetzen-test-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory $dir | Out-Null
    $out = Join-Path $dir 'aufruf.json'
    $stub = Join-Path $dir 'claude.ps1'
    # the stand-in records its arguments, the settings file it got and the account, then exits 7
    Set-Content -LiteralPath $stub -Encoding UTF8 -Value @"
`$i = [array]::IndexOf(`$args, '--settings')
@{ args = @(`$args); settings = [IO.File]::ReadAllText(`$args[`$i + 1]); config = `$env:CLAUDE_CONFIG_DIR } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath '$out' -Encoding UTF8
exit 7
"@

    It 'starts claude --resume with guard.ps1 as a PreToolUse hook that blocks on failure' {
        & $script -Session 'abc-123' -ConfigDir 'C:\konto2' -Claude $stub
        $LASTEXITCODE | Should Be 7
        $r = Get-Content -LiteralPath $out -Raw | ConvertFrom-Json
        $r.args[0] | Should Be '--resume'
        $r.args[1] | Should Be 'abc-123'
        $r.args[2] | Should Be '--settings'
        $r.config | Should Be 'C:\konto2'
        $h = ($r.settings | ConvertFrom-Json).hooks.PreToolUse[0]
        $h.matcher | Should Be 'Bash|PowerShell'
        $h.hooks[0].onFailure | Should Be 'block'
        $h.hooks[0].timeout | Should Be 30
        $h.hooks[0].command | Should Match ([regex]::Escape((Join-Path $PSScriptRoot 'guard.ps1')) + '" -Profile epic$')
        $h.hooks[1].command | Should Match ([regex]::Escape((Join-Path $PSScriptRoot 'testausgabe.ps1')) + '"$')
        $h.hooks[1].onFailure | Should BeNullOrEmpty
    }

    It 'removes the settings file and restores the account afterwards' {
        $env:CLAUDE_CONFIG_DIR = 'C:\vorher'
        try {
            & $script -Session 'abc-123' -ConfigDir 'C:\konto2' -Claude $stub
            $env:CLAUDE_CONFIG_DIR | Should Be 'C:\vorher'
        } finally { Remove-Item Env:\CLAUDE_CONFIG_DIR }
        $r = Get-Content -LiteralPath $out -Raw | ConvertFrom-Json
        Test-Path -LiteralPath $r.args[3] | Should Be $false
    }

    It 'refuses to continue without guard.ps1' {
        & $script -Session 'abc-123' -Guard (Join-Path $dir 'fehlt.ps1') -Claude $stub 2>$null
        $LASTEXITCODE | Should Be 1
    }

    It 'gives the same hook as the fleet driver' {
        $treiber = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\flotte\src\treiber\treiber.ts') -Raw
        $treiber | Should Match "\[\{ type: 'command', command: befehl, timeout: 30, onFailure: 'block' \}\]"
        $treiber | Should Match "matcher: 'Bash\|PowerShell', hooks \}"
        $treiber | Should Match "testausgabe\.ps1"
        $treiber | Should Match ([regex]::Escape('-Profile epic`'))
    }

    Remove-Item -LiteralPath $dir -Recurse -Force
}
