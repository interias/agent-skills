<#
.SYNOPSIS
    Continues an /mission session outside the fleet with `claude --resume`, with guard.ps1 as a hook of
    the session.

.DESCRIPTION
    The hook in the frontmatter of /mission only holds in the turn that calls the skill; after
    `claude --resume` the session runs without guard.ps1 (probe 2 of #14, finding 15). The fleet
    driver therefore hands every turn the hook through --settings. This script does the same for a
    session continued by hand: it writes the settings to a temporary file (a JSON argument would
    lose its quotes in Windows PowerShell), starts claude in this terminal and removes the file
    when claude ends. The hook is the one of the driver: PreToolUse on Bash|PowerShell,
    `guard.ps1 -Profile epic`, timeout 30, onFailure block.

    Exit code: the one of claude; 1 when guard.ps1 is missing.

.PARAMETER Session
    Session id to continue (claude --resume <id>). Start it in the project folder of the session.

.PARAMETER ConfigDir
    Account folder (CLAUDE_CONFIG_DIR), e.g. the second account. Default: the account of this shell.

.PARAMETER Guard
    guard.ps1 to use. Default: the one next to this script.

.PARAMETER Claude
    Program to start. Default: claude. Tests pass a stand-in.

.PARAMETER DryRun
    Prints one JSON object (program, arguments, settings) and starts nothing.

.EXAMPLE
    powershell -NoProfile -File C:\Users\me\.claude\skills\mission\scripts\fortsetzen.ps1 -Session 3f2a9c1e-...
#>
param(
    [Parameter(Mandatory)][string]$Session,
    [string]$ConfigDir,
    [string]$Guard = (Join-Path $PSScriptRoot 'guard.ps1'),
    [string]$Claude = 'claude',
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Guard -PathType Leaf)) {
    [Console]::Error.WriteLine("fortsetzen.ps1: guard.ps1 not found at $Guard. Not continuing without the hook.")
    exit 1
}
$guardPath = (Resolve-Path -LiteralPath $Guard).Path
$settings = [ordered]@{
    hooks = [ordered]@{
        PreToolUse = @([ordered]@{
                matcher = 'Bash|PowerShell'
                hooks   = @([ordered]@{ type = 'command'; command = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$guardPath`" -Profile epic"; timeout = 30; onFailure = 'block' })
            })
    }
}
$json = $settings | ConvertTo-Json -Depth 8 -Compress

if ($DryRun) {
    [ordered]@{ program = $Claude; arguments = @('--resume', $Session, '--settings', '<file>'); settings = $settings; configDir = $ConfigDir } | ConvertTo-Json -Depth 10 -Compress
    exit 0
}

$file = Join-Path ([IO.Path]::GetTempPath()) "epic-fortsetzen-$([guid]::NewGuid().ToString('N')).json"
[IO.File]::WriteAllText($file, $json, [Text.UTF8Encoding]::new($false))
$before = $env:CLAUDE_CONFIG_DIR
try {
    if ($ConfigDir) { $env:CLAUDE_CONFIG_DIR = $ConfigDir }
    & $Claude --resume $Session --settings $file
    $code = $LASTEXITCODE
} finally {
    $env:CLAUDE_CONFIG_DIR = $before
    Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue
}
exit $code
