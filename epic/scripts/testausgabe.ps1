<#
.SYNOPSIS
    PreToolUse hook for /epic runs: a test command from the adapter writes its full output to a
    log file; only the count lines, the first failures and the end reach the context.

.DESCRIPTION
    Hook mode (no -Kurz): reads the hook input as JSON from stdin (tool_name, tool_input, cwd).
    A Bash or PowerShell call whose command is a test command of the adapter gets a new command
    through hookSpecificOutput.updatedInput: the original command, unchanged and readable, with
    its whole output redirected to a log file, followed by this script with -Kurz on that log and
    the exit code of the original command. Every other call passes without output.

    A test command is a value of test_commands or test_commands_affected in the front matter of
    .claude/epic.md (old name .claude/prd.md), looked up from the target directory upwards: a
    flat list ([a, b] or "- a") or a map of suite names ("  client: npm test"). The command
    matches when, after an optional leading "cd <dir> &&" (or ";") and leading variable
    assignments (FOO=1, $env:FOO='1';), it equals a test command or continues it with plain
    arguments - no ; & | < > ` $ ( ) { } in the rest. A command that already pipes or redirects
    its output stays as it is.

    Never rewritten: gate_command, gate_always_command and acceptance_commands (the fleet driver
    proves the gate from the unshortened output of the real call), and any command that contains
    EPIC_TESTAUSGABE=voll - the way to get the full output in the context once.

    The hook gives no permissionDecision: the permission rules and the auto mode judge the
    rewritten command as they would the original.

    Summary mode (-Kurz <log> -Exit <code>): prints a log of at most 60 lines in full. A longer
    one is shortened to the lines that name a failure or error (the first 30, each with up to
    three lines after it) and the last 40 lines, where test runners print their count lines.
    The last line names the exit code, the line count and the path of the full log.

    Logs lie in <temp>/epic-testausgabe, not in the worktree: a file there would make the
    worktree dirty, and Down keeps dirty worktrees. Logs older than three days are removed on the
    next call.

    Errors in hook mode let the call pass unchanged (exit 0 without output): this hook shortens,
    it guards nothing. guard.ps1 is the guard and fails closed.

.PARAMETER Kurz
    Summary mode: path of the log to summarize.

.PARAMETER Exit
    Summary mode: exit code of the test command, named in the last line.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\me\.claude\skills\epic\scripts\testausgabe.ps1
#>
[CmdletBinding()]
param(
    [string]$Kurz,
    [int]$Exit = 0
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding $false
$maxFull = 60
$maxFailures = 30
$tailLines = 40
$after = 3
$width = 400
$failure = '(?i)(\bnot ok\b|\bfail(ed|ure|ures|s)?\b|\berror(s)?\b|✗|✘|×|\bpanic)'
$noFailure = '(?i)\b0 (fail|failed|failures|errors?)\b|\bfail(ed)?:? 0\b|\berrors?:? 0\b'

function Write-Out([string]$text) {
    $stream = [Console]::OpenStandardOutput()
    $bytes = $utf8.GetBytes($text)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
}

function Limit([string]$line) {
    if ($line.Length -le $width) { return $line }
    $line.Substring(0, $width) + ' …'
}

if ($Kurz) {
    $lines = @()
    if (Test-Path -LiteralPath $Kurz -PathType Leaf) { $lines = @([IO.File]::ReadAllLines($Kurz, $utf8)) }
    $out = New-Object Collections.Generic.List[string]
    if ($lines.Count -le $maxFull) {
        foreach ($line in $lines) { $out.Add((Limit $line)) }
        $out.Add("[testausgabe] Exit $Exit, $($lines.Count) Zeilen, voller Log: $Kurz")
    } else {
        $shown = @{}
        $hits = 0
        $block = New-Object Collections.Generic.List[string]
        for ($i = 0; $i -lt $lines.Count -and $hits -lt $maxFailures; $i++) {
            if ($lines[$i] -notmatch $failure -or $lines[$i] -match $noFailure) { continue }
            if ($i -ge $lines.Count - $tailLines) { break }
            $hits++
            for ($k = $i; $k -le [math]::Min($i + $after, $lines.Count - $tailLines - 1); $k++) {
                if ($shown.ContainsKey($k)) { continue }
                $shown[$k] = $true
                $block.Add(("{0,6}: {1}" -f ($k + 1), (Limit $lines[$k])))
            }
        }
        $out.Add("[testausgabe] $($lines.Count) Zeilen, gekürzt. Voller Log: $Kurz")
        if ($block.Count) {
            $out.Add("[testausgabe] Fehlerzeilen (erste $maxFailures mit je bis zu $after Folgezeilen):")
            foreach ($line in $block) { $out.Add($line) }
        }
        $out.Add("[testausgabe] Schluss (letzte $tailLines Zeilen):")
        foreach ($line in $lines[($lines.Count - $tailLines)..($lines.Count - 1)]) { $out.Add((Limit $line)) }
        $out.Add("[testausgabe] Exit $Exit. Ganze Ausgabe einmal im Kontext: EPIC_TESTAUSGABE=voll vor den Befehl, oder den Log lesen.")
    }
    Write-Out (($out -join "`n") + "`n")
    exit 0
}

# ---------------------------------------------------------------------------------------------
# Hook mode

function Read-Commands([string]$path) {
    $result = @{ test = @(); skip = @() }
    $lines = [IO.File]::ReadAllLines($path, $utf8)
    if ($lines.Count -eq 0 -or $lines[0].Trim() -ne '---') { return $result }
    $current = $null
    for ($k = 1; $k -lt $lines.Count; $k++) {
        $line = $lines[$k]
        if ($line.Trim() -eq '---') { break }
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$') {
            $name = $Matches[1]; $value = ($Matches[2] -replace '\s+#.*$', '').Trim()
            $current = $null
            $kind = if ($name -in @('test_commands', 'test_commands_affected')) { 'test' }
                    elseif ($name -in @('gate_command', 'gate_always_command', 'acceptance_commands')) { 'skip' }
                    else { $null }
            if (-not $kind) { continue }
            if ($value -match '^\[(.*)\]$') {
                $result[$kind] += @($Matches[1] -split ',' | ForEach-Object { $_.Trim().Trim('"', "'") } | Where-Object { $_ })
            } elseif ($value) { $result[$kind] += $value.Trim('"', "'") }
            else { $current = $kind }
            continue
        }
        if (-not $current) { continue }
        if ($line -match '^\s+-\s+(.+)$') { $result[$current] += $Matches[1].Trim().Trim('"', "'") }
        elseif ($line -match '^\s+[^:\s][^:]*:\s+(.+)$') { $result[$current] += $Matches[1].Trim().Trim('"', "'") }
    }
    $result
}

function Find-Adapter([string]$dir) {
    $d = $dir
    while ($d) {
        foreach ($name in @('.claude\epic.md', '.claude\prd.md')) {
            $candidate = Join-Path $d $name
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
        }
        $parent = Split-Path -Parent $d
        if (-not $parent -or $parent -eq $d) { break }
        $d = $parent
    }
    $null
}

# The command without a leading cd and variable assignments, and the directory it runs in.
function Split-Command([string]$command, [string]$cwd) {
    $rest = $command.Trim()
    $dir = $cwd
    if ($rest -match '^(cd|Set-Location|sl)\s+("([^"]+)"|''([^'']+)''|(\S+))\s*(&&|;)\s*(.*)$') {
        $target = @($Matches[3], $Matches[4], $Matches[5]) | Where-Object { $_ } | Select-Object -First 1
        $rest = $Matches[7]
        if ([IO.Path]::IsPathRooted($target) -or $target -match '^/[a-zA-Z]/') {
            if ($target -match '^/([a-zA-Z])/(.*)$') { $target = "$($Matches[1]):/$($Matches[2])" }
            $dir = $target
        } elseif ($cwd) { $dir = Join-Path $cwd $target }
    }
    while ($rest -match '^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)(.*)$' -or $rest -match '^(\$env:[A-Za-z_][A-Za-z0-9_]*\s*=\s*(''[^'']*''|"[^"]*"|\S+)\s*;\s*)(.*)$') {
        $rest = $Matches[$Matches.Count - 1]
    }
    @{ Rest = $rest.Trim(); Dir = $dir }
}

function Test-IsTestCommand([string]$rest, $commands) {
    foreach ($skip in $commands.skip) {
        if ($skip -and $rest.StartsWith($skip, [StringComparison]::Ordinal)) { return $false }
    }
    foreach ($test in $commands.test) {
        if (-not $test) { continue }
        if ($rest -eq $test) { return $true }
        if ($rest.StartsWith("$test ", [StringComparison]::Ordinal)) {
            $tail = $rest.Substring($test.Length)
            if ($tail -notmatch '[;&|<>`$(){}]') { return $true }
        }
    }
    $false
}

function New-LogPath {
    $dir = Join-Path ([IO.Path]::GetTempPath()) 'epic-testausgabe'
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $limit = (Get-Date).AddDays(-3)
    Get-ChildItem -LiteralPath $dir -Filter *.log -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $limit } |
        Remove-Item -Force -ErrorAction SilentlyContinue
    $name = '{0}-{1}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'), ([guid]::NewGuid().ToString('N').Substring(0, 6))
    (Join-Path $dir $name) -replace '\\', '/'
}

try {
    $raw = [Console]::In.ReadToEnd()
    $hook = $raw | ConvertFrom-Json
    $tool = [string]$hook.tool_name
    if ($tool -notin @('Bash', 'PowerShell')) { exit 0 }
    $command = [string]$hook.tool_input.command
    if (-not $command.Trim() -or $command -match 'EPIC_TESTAUSGABE=voll') { exit 0 }
    $split = Split-Command $command ([string]$hook.cwd)
    if (-not $split.Dir) { exit 0 }
    $adapter = Find-Adapter $split.Dir
    if (-not $adapter) { exit 0 }
    $commands = Read-Commands $adapter
    if (-not (Test-IsTestCommand $split.Rest $commands)) { exit 0 }

    $log = New-LogPath
    $self = $PSCommandPath -replace '\\', '/'
    $summary = "powershell -NoProfile -ExecutionPolicy Bypass -File '$self' -Kurz '$log'"
    if ($tool -eq 'Bash') {
        $new = "{ $command`n} > '$log' 2>&1; __rc=`$?; $summary -Exit `$__rc; (exit `$__rc)"
    } else {
        $new = "& { $command`n} *> '$log'; `$__rc = `$LASTEXITCODE; $summary -Exit `$__rc; `$global:LASTEXITCODE = `$__rc"
    }
    $newInput = [ordered]@{}
    foreach ($p in $hook.tool_input.PSObject.Properties) { $newInput[$p.Name] = $p.Value }
    $newInput['command'] = $new
    $out = [ordered]@{ hookSpecificOutput = [ordered]@{ hookEventName = 'PreToolUse'; updatedInput = $newInput } }
    Write-Out ($out | ConvertTo-Json -Depth 6 -Compress)
    exit 0
} catch {
    [Console]::Error.WriteLine("testausgabe.ps1: $($_.Exception.Message) - Befehl ungekürzt durchgelassen.")
    exit 0
}
