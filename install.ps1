<#
.SYNOPSIS
    Installs (copies) the skills in this repository into ~/.claude/skills.

.DESCRIPTION
    Copies each skill folder from this repo into $env:USERPROFILE\.claude\skills\<name>.
    Always copies file contents — never creates a junction or symlink. A linked target
    means a recursive delete of the target follows the link and deletes the repo itself
    (this happened on 2026-09-18 in KOKOS with node_modules junctions).

    Before overwriting an existing target folder, it is backed up to
    $env:USERPROFILE\.claude\skills-backup\<name>-<yyyyMMdd-HHmmss>\. The target folder is
    only cleared after the backup is verified complete (file count comparison). Before
    clearing, the target is checked for reparse points (junctions/symlinks); if any are
    found, the script aborts without touching the folder.

.PARAMETER Skill
    Optional. Install only this one skill (folder name) instead of all skills in the repo.

.PARAMETER DryRun
    Show what would happen without copying, backing up, or deleting anything.

.EXAMPLE
    powershell -File install.ps1 -DryRun

.EXAMPLE
    powershell -File install.ps1 -Skill prd
#>
[CmdletBinding()]
param(
    [string]$Skill,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillsTarget = Join-Path $env:USERPROFILE '.claude\skills'
$backupRoot = Join-Path $env:USERPROFILE '.claude\skills-backup'

# Discover skill folders in the repo: any top-level directory containing a SKILL.md.
$allSkills = Get-ChildItem -Path $repoRoot -Directory | Where-Object {
    Test-Path (Join-Path $_.FullName 'SKILL.md')
}

if ($Skill) {
    $skillsToInstall = $allSkills | Where-Object { $_.Name -eq $Skill }
    if (-not $skillsToInstall) {
        throw "Skill '$Skill' not found in $repoRoot (expected a folder with SKILL.md)."
    }
} else {
    $skillsToInstall = $allSkills
}

if (-not $skillsToInstall) {
    throw "No skill folders (with SKILL.md) found in $repoRoot."
}

Write-Host "Skills to install: $($skillsToInstall.Name -join ', ')"
if ($DryRun) {
    Write-Host "-- DRY RUN: nothing will be changed --" -ForegroundColor Yellow
}

foreach ($skillDir in $skillsToInstall) {
    $name = $skillDir.Name
    $source = $skillDir.FullName
    $target = Join-Path $skillsTarget $name

    Write-Host ""
    Write-Host "== $name =="
    Write-Host "Source: $source"
    Write-Host "Target: $target"

    if (-not (Test-Path $target)) {
        Write-Host "Target does not exist yet — will be created."
        if (-not $DryRun) {
            New-Item -ItemType Directory -Path $target -Force | Out-Null
            Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
            Write-Host "Copied." -ForegroundColor Green
        } else {
            Write-Host "[DryRun] Would create target and copy files."
        }
        continue
    }

    # Refuse to touch a target that contains reparse points (junctions/symlinks).
    $reparsePoints = Get-ChildItem -Path $target -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue
    if ($reparsePoints) {
        Write-Host "ABORT: reparse points (junction/symlink) found under $target — refusing to touch it:" -ForegroundColor Red
        $reparsePoints | ForEach-Object { Write-Host "  $($_.FullName)" -ForegroundColor Red }
        continue
    }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupDir = Join-Path $backupRoot "$name-$timestamp"

    if ($DryRun) {
        $existingCount = (Get-ChildItem -Path $target -Recurse -Force -File).Count
        Write-Host "[DryRun] Would back up $existingCount file(s) from $target to $backupDir"
        Write-Host "[DryRun] Would verify backup file count, then clear $target"
        Write-Host "[DryRun] Would copy $source to $target"
        continue
    }

    # Backup first.
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Copy-Item -Path (Join-Path $target '*') -Destination $backupDir -Recurse -Force

    $sourceCountForBackupCheck = (Get-ChildItem -Path $target -Recurse -Force -File).Count
    $backupCount = (Get-ChildItem -Path $backupDir -Recurse -Force -File).Count
    if ($backupCount -ne $sourceCountForBackupCheck) {
        throw "Backup verification failed for '$name': expected $sourceCountForBackupCheck file(s), backup has $backupCount. Aborting before touching target."
    }
    Write-Host "Backed up $backupCount file(s) to $backupDir"

    # Only now clear the target — backup is verified complete.
    Get-ChildItem -Path $target -Force | Remove-Item -Recurse -Force

    # Copy fresh contents from the repo.
    Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
    Write-Host "Installed to $target" -ForegroundColor Green
}

Write-Host ""
if ($DryRun) {
    Write-Host "Dry run complete — no changes made." -ForegroundColor Yellow
} else {
    Write-Host "Done." -ForegroundColor Green
}
