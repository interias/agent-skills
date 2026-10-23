<#
.SYNOPSIS
    Measures the memory of the Windows host and rates it ok, warn or hold (#37, epic #34).

.DESCRIPTION
    The RAM brake of /epic and /epic-flotte: run before every package start (/epic) and before
    every wave (/epic-flotte). It measures on the Windows side, because that is where the crash
    happens; the WSL VM is part of it (vmmemWSL).

    "Free" is the memory Windows can hand out at once: free plus standby (cached) pages, the
    figure Task Manager calls "Available" (GlobalMemoryStatusEx, ullAvailPhys), the same as the
    counter '\Memory\Available MBytes'. "Free" in the sense of an empty free list would show a
    machine with a warm file cache as full. Used percent is (total - available) / total.

    Levels, relative with an absolute floor: percent_used >= HoldPercent -> hold; percent_used >=
    WarnPercent -> warn; and free_gb < MinFreeGb is always at least warn. The percentages carry
    over to other machines and the later server; the floor protects small machines, whose base
    load (Windows, desktop app, browser) does not grow with the RAM.

    The three values come from, in this order: the parameters, the YAML frontmatter of
    <RepoRoot>/.claude/epic.md (keys ram_warn_percent, ram_hold_percent, ram_min_free_gb; only
    read when -RepoRoot is given, a missing adapter or key is not an error), the defaults
    75, 85 and 4.

    The comparison uses the raw values; the JSON shows them rounded to one decimal. A reading
    of 74.96 % is therefore ok although percent_used prints 75, and 3.96 GB free is warn although
    free_gb prints 4.

    stdout carries exactly one JSON object: percent_used, free_gb, total_gb, level. Every message
    goes to stderr. Exit 0 for every level - the level is in the JSON; exit 1 only when the
    measurement or the settings are unusable (nothing is guessed).

    -TotalGb and -FreeGb replace the measurement. They exist for the tests and must be given
    together; Get-RamLevel and the settings logic run unchanged.

.PARAMETER RepoRoot
    Optional. Main checkout whose .claude/epic.md may set the three values.

.PARAMETER WarnPercent
    Used percent from which the level is warn. Key ram_warn_percent, default 75.

.PARAMETER HoldPercent
    Used percent from which the level is hold. Key ram_hold_percent, default 85.

.PARAMETER MinFreeGb
    Free GB below which the level is at least warn. Key ram_min_free_gb, default 4.

.PARAMETER TotalGb
    Test only. Installed memory in GB instead of the measurement.

.PARAMETER FreeGb
    Test only. Available memory in GB instead of the measurement.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File ram.ps1 -RepoRoot C:\src\app

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File ram.ps1 -WarnPercent 70 -HoldPercent 80 -MinFreeGb 6
#>
[CmdletBinding()]
param(
    [string]$RepoRoot,
    [double]$WarnPercent = 75,
    [double]$HoldPercent = 85,
    [double]$MinFreeGb = 4,
    [double]$TotalGb,
    [double]$FreeGb
)

$ErrorActionPreference = 'Stop'

function Fail([string]$message) {
    [Console]::Error.WriteLine("ram.ps1: $message")
    exit 1
}

# Reads the flat YAML frontmatter of the adapter: only `key: value` lines, which is all this
# script needs (copied from worktree.ps1; this script must not depend on it).
function Read-Adapter([string]$repo) {
    $path = Join-Path $repo '.claude\epic.md'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $path = Join-Path $repo '.claude\prd.md' }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return @{} }
    $lines = [IO.File]::ReadAllLines($path)
    $keys = @{}
    if ($lines.Count -eq 0 -or $lines[0].Trim() -ne '---') { return $keys }
    for ($i = 1; $i -lt $lines.Count -and $lines[$i].Trim() -ne '---'; $i++) {
        if ($lines[$i] -match '^(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*:(?<value>.*)$') {
            $keys[$Matches.key] = (($Matches.value -replace '\s+#.*$', '').Trim()).Trim('"', "'")
        }
    }
    $keys
}

# The level for a reading. Raw values decide; the JSON shows them rounded.
function Get-RamLevel([double]$percentUsed, [double]$freeGb, [double]$warn, [double]$hold, [double]$minFree) {
    if ($percentUsed -ge $hold) { return 'hold' }
    if ($percentUsed -ge $warn -or $freeGb -lt $minFree) { return 'warn' }
    'ok'
}

function Get-Setting([string]$key, $adapter) {
    if ($adapter.ContainsKey($key)) {
        $parsed = 0.0
        if (-not [double]::TryParse([string]$adapter[$key], [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
            Fail "$key in .claude/epic.md is not a number: '$($adapter[$key])'."
        }
        return $parsed
    }
    $null
}

$adapter = @{}
if ($RepoRoot) { $adapter = Read-Adapter $RepoRoot }
foreach ($setting in @(
        @{ Param = 'WarnPercent'; Key = 'ram_warn_percent' },
        @{ Param = 'HoldPercent'; Key = 'ram_hold_percent' },
        @{ Param = 'MinFreeGb'; Key = 'ram_min_free_gb' })) {
    if ($PSBoundParameters.ContainsKey($setting.Param)) { continue }
    $value = Get-Setting $setting.Key $adapter
    if ($null -ne $value) { Set-Variable -Name $setting.Param -Value ([double]$value) }
}
# NaN passes every comparison below and would turn each level into ok; refuse it and Infinity.
foreach ($value in $WarnPercent, $HoldPercent, $MinFreeGb) {
    if ([double]::IsNaN($value) -or [double]::IsInfinity($value)) { Fail "Settings must be finite numbers (warn $WarnPercent, hold $HoldPercent, min free $MinFreeGb)." }
}
if ($WarnPercent -le 0 -or $HoldPercent -gt 100 -or $WarnPercent -ge $HoldPercent) { Fail "Percentages must satisfy 0 < warn < hold <= 100 (warn $WarnPercent, hold $HoldPercent)." }
if ($MinFreeGb -lt 0) { Fail "MinFreeGb must not be negative ($MinFreeGb)." }

$testTotal = $PSBoundParameters.ContainsKey('TotalGb')
$testFree = $PSBoundParameters.ContainsKey('FreeGb')
if ($testTotal -ne $testFree) { Fail '-TotalGb and -FreeGb must be given together.' }
if ($testTotal) {
    $total = $TotalGb * 1GB
    $free = $FreeGb * 1GB
} else {
    try {
        Add-Type -AssemblyName Microsoft.VisualBasic
        $info = New-Object Microsoft.VisualBasic.Devices.ComputerInfo
        $total = [double]$info.TotalPhysicalMemory
        $free = [double]$info.AvailablePhysicalMemory
    } catch {
        Fail "Memory could not be measured: $($_.Exception.Message)"
    }
}
if ([double]::IsNaN($total) -or [double]::IsNaN($free) -or $total -le 0 -or $free -lt 0 -or $free -gt $total) { Fail "Unusable reading: total $total bytes, available $free bytes." }

$percentUsed = ($total - $free) * 100 / $total
$freeGbValue = $free / 1GB
$level = Get-RamLevel $percentUsed $freeGbValue $WarnPercent $HoldPercent $MinFreeGb

[ordered]@{
    percent_used = [math]::Round($percentUsed, 1)
    free_gb      = [math]::Round($freeGbValue, 1)
    total_gb     = [math]::Round($total / 1GB, 1)
    level        = $level
} | ConvertTo-Json -Compress
