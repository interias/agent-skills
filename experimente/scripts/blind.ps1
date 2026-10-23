<#
.SYNOPSIS
    Prepares a blind comparison: the full diffs of two branches against a reference commit,
    written as A.diff and B.diff in random order, with the assignment sealed in a separate file.

.DESCRIPTION
    For each of the two branches the script writes `git diff --binary <Reference> <Branch>` -
    complete, byte for byte, without pager, colour, external diff driver or textconv filter - to
    A.diff or B.diff.
    Which branch becomes A is random. The assignment is written to
    zuordnung-erst-nach-dem-urteil\zuordnung.json inside -OutDir: one level below the diffs and
    under a name that says when to open it, so opening -OutDir for the judgement does not show
    it. The console does not say which branch is A.

    Nothing in the diffs names a branch: git diff writes none, and the file names are fixed.
    Blob hashes in the `index` lines do not identify a branch.

    The script never overwrites: if A.diff, B.diff or the assignment file exists, it stops with
    exit code 1 and a message on stderr; nothing is written. Same for a relative path, an
    unknown branch or reference, or two identical branches. Exit code 0 means done.

    Array parameters accept comma-separated strings, because `powershell -File` passes an
    array argument as one string.

.PARAMETER RepoRoot
    Absolute path of the clone in which both branches and the reference exist.

.PARAMETER Branches
    Exactly two branches (or any revisions git can resolve to a commit).

.PARAMETER Reference
    Commit the diffs are taken against. Default 29207580 (BRIQNET original state).

.PARAMETER OutDir
    Absolute path of the output folder. Created when missing.

.PARAMETER Seed
    Tests only. Fixes the random choice so a run can be repeated. Not needed for a real run.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File blind.ps1 -RepoRoot C:\src\briqnet -Branches lauf-a,lauf-b -OutDir C:\src\blind
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RepoRoot,
    [Parameter(Mandatory)][string[]]$Branches,
    [string]$Reference = '29207580',
    [Parameter(Mandatory)][string]$OutDir,
    [Nullable[int]]$Seed = $null
)

$ErrorActionPreference = 'Stop'
$sealedName = 'zuordnung-erst-nach-dem-urteil'

function Fail([string]$message) {
    [Console]::Error.WriteLine("blind.ps1: $message")
    exit 1
}

# `powershell -File` hands an array argument over as one comma-separated string.
function Split-List([string[]]$values) {
    @($values | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Get-FullPath([string]$path) {
    [IO.Path]::GetFullPath($path).TrimEnd('\', '/')
}

function Test-Commit([string]$revision) {
    & git -C $RepoRoot rev-parse --verify --quiet "$revision^{commit}" 2>$null | Out-Null
    $LASTEXITCODE -eq 0
}

foreach ($p in @($RepoRoot, $OutDir)) {
    if (-not [IO.Path]::IsPathRooted($p)) { Fail "'$p' is not an absolute path. Relative paths break once the shell's working directory moves." }
}
$RepoRoot = Get-FullPath $RepoRoot
$OutDir = Get-FullPath $OutDir
$Branches = Split-List $Branches

if ($Branches.Count -ne 2) { Fail "-Branches needs exactly two branches, got $($Branches.Count)." }
if ($Branches[0] -eq $Branches[1]) { Fail 'Both branches are the same; there is nothing to compare blind.' }
if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) { Fail "$RepoRoot does not exist." }
if (-not (Test-Commit $Reference)) { Fail "Reference '$Reference' is not a commit in $RepoRoot." }
foreach ($b in $Branches) {
    if (-not (Test-Commit $b)) { Fail "Branch '$b' is not a commit in $RepoRoot." }
}

$diffPaths = @{ A = Join-Path $OutDir 'A.diff'; B = Join-Path $OutDir 'B.diff' }
$sealedDir = Join-Path $OutDir $sealedName
$mappingPath = Join-Path $sealedDir 'zuordnung.json'
foreach ($path in @($diffPaths.A, $diffPaths.B, $mappingPath)) {
    if (Test-Path -LiteralPath $path) { Fail "$path already exists. Not overwriting it; an earlier assignment would be lost." }
}

# Random order: a fixed seed only for tests, otherwise the system's cryptographic generator.
if ($null -ne $Seed) {
    $swap = (New-Object Random ([int]$Seed)).Next(2) -eq 1
} else {
    $byte = New-Object byte[] 1
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($byte) } finally { $rng.Dispose() }
    $swap = ($byte[0] -band 1) -eq 1
}
$assignment = if ($swap) { @{ A = $Branches[1]; B = $Branches[0] } } else { @{ A = $Branches[0]; B = $Branches[1] } }

New-Item -ItemType Directory -Path $sealedDir -Force | Out-Null
foreach ($label in @('A', 'B')) {
    # --output writes the bytes as git produces them; capturing through the shell would re-encode.
    & git -C $RepoRoot --no-pager -c core.quotepath=false diff --binary --no-color --no-ext-diff --no-textconv --output=$($diffPaths[$label]) $Reference $assignment[$label]
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -LiteralPath $diffPaths.A, $diffPaths.B -Force -ErrorAction SilentlyContinue
        Fail "git diff for $label failed (exit $LASTEXITCODE). Nothing kept."
    }
}

$json = ConvertTo-Json -InputObject ([ordered]@{
    A         = $assignment.A
    B         = $assignment.B
    reference = $Reference
    created   = (Get-Date).ToString('o')
}) -Depth 3
[IO.File]::WriteAllText($mappingPath, $json, (New-Object Text.UTF8Encoding $false))

Write-Host "Done: A.diff and B.diff are in $OutDir. The assignment is sealed; open it only after the judgement."
exit 0
