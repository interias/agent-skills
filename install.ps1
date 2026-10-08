<#
.SYNOPSIS
    Installs (copies) the skills in this repository into ~/.claude/skills and the agent
    definitions under agents/ into ~/.claude/agents.

.DESCRIPTION
    Copies each skill folder from this repo into $env:USERPROFILE\.claude\skills\<name>.
    Always copies file contents — never creates a junction or symlink. A linked target
    means a recursive delete of the target follows the link and deletes the repo itself
    (this happened on 2026-09-18 in KOKOS with node_modules junctions).

    Before overwriting an existing target folder, it is backed up to
    $env:USERPROFILE\.claude\skills-backup\<name>-<yyyyMMdd-HHmmss>\. The target folder is
    only cleared after the backup is verified complete (file count comparison). Before
    clearing, the script checks whether the target itself is a reparse point (junction/symlink),
    and whether it contains any; if either is true, it aborts without touching the folder.

    Skills that were renamed (prd -> epic, 2026-10) are retired: an installed folder under an
    old name is backed up the same way and then removed, so the old and the new name do not
    both trigger.

    Agent definitions (agents/*.md) are copied file by file. An existing file that differs is
    first backed up to $env:USERPROFILE\.claude\skills-backup\agents-<yyyyMMdd-HHmmss>\.

.PARAMETER Skill
    Optional. Install only this one skill (folder name) instead of all skills in the repo.
    The agent definitions are then left alone.

.PARAMETER DryRun
    Show what would happen without copying, backing up, or deleting anything.

.EXAMPLE
    powershell -File install.ps1 -DryRun

.EXAMPLE
    powershell -File install.ps1 -Skill epic
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
$agentsTarget = Join-Path $env:USERPROFILE '.claude\agents'

# Old skill name -> new name. An installed old folder is backed up and removed.
$renamedSkills = [ordered]@{
    'prd'            = 'epic'
    'prd-nacharbeit' = 'epic-nacharbeit'
    'prd-aufraeumen' = 'epic-aufraeumen'
    'prd-flotte'     = 'epic-flotte'
}

# A target that is a reparse point or contains one must not be cleared: the delete would follow
# the link into whatever it points at. Returns $true when the folder is safe to clear.
function Test-SafeToClear([string]$path) {
    $item = Get-Item -Path $path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        Write-Host "ABORT: $path is itself a reparse point (junction/symlink) — refusing to touch it." -ForegroundColor Red
        return $false
    }
    $reparsePoints = Get-ChildItem -Path $path -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue
    if ($reparsePoints) {
        Write-Host "ABORT: reparse points (junction/symlink) found under $path — refusing to touch it:" -ForegroundColor Red
        $reparsePoints | ForEach-Object { Write-Host "  $($_.FullName)" -ForegroundColor Red }
        return $false
    }
    return $true
}

# Copies $path to <backupRoot>\<name>-<timestamp> and verifies the file count; throws on mismatch.
function Backup-Folder([string]$path, [string]$name) {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupDir = Join-Path $backupRoot "$name-$timestamp"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Copy-Item -Path (Join-Path $path '*') -Destination $backupDir -Recurse -Force

    $expected = (Get-ChildItem -Path $path -Recurse -Force -File).Count
    $backupCount = (Get-ChildItem -Path $backupDir -Recurse -Force -File).Count
    if ($backupCount -ne $expected) {
        throw "Backup verification failed for '$name': expected $expected file(s), backup has $backupCount. Aborting before touching target."
    }
    Write-Host "Backed up $backupCount file(s) to $backupDir"
}

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

    if (-not (Test-SafeToClear $target)) { continue }

    if ($DryRun) {
        $existingCount = (Get-ChildItem -Path $target -Recurse -Force -File).Count
        Write-Host "[DryRun] Would back up $existingCount file(s) from $target to $backupRoot\$name-<timestamp>"
        Write-Host "[DryRun] Would verify backup file count, then clear $target"
        Write-Host "[DryRun] Would copy $source to $target"
        continue
    }

    # Backup first.
    Backup-Folder $target $name

    # Only now clear the target — backup is verified complete.
    Get-ChildItem -Path $target -Force | Remove-Item -Recurse -Force

    # Copy fresh contents from the repo.
    Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
    Write-Host "Installed to $target" -ForegroundColor Green
}

# Retire installed folders under an old name whose new name was installed in this run.
foreach ($oldName in $renamedSkills.Keys) {
    if ($skillsToInstall.Name -notcontains $renamedSkills[$oldName]) { continue }
    $oldTarget = Join-Path $skillsTarget $oldName
    if (-not (Test-Path $oldTarget)) { continue }

    Write-Host ""
    Write-Host "== $oldName (renamed to $($renamedSkills[$oldName])) =="
    if (-not (Test-SafeToClear $oldTarget)) { continue }
    if ($DryRun) {
        Write-Host "[DryRun] Would back up $oldTarget to $backupRoot\$oldName-<timestamp>, then remove it"
        continue
    }
    Backup-Folder $oldTarget $oldName
    Remove-Item -Path $oldTarget -Recurse -Force
    Write-Host "Removed $oldTarget" -ForegroundColor Green
}

# Agent definitions: one file each, backed up when an existing one differs.
$agentFiles = @(Get-ChildItem -Path (Join-Path $repoRoot 'agents') -Filter '*.md' -File -ErrorAction SilentlyContinue)
if (-not $Skill -and $agentFiles) {
    Write-Host ""
    Write-Host "== agents =="
    Write-Host "Target: $agentsTarget"
    $agentsBackup = Join-Path $backupRoot "agents-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    if (-not $DryRun) { New-Item -ItemType Directory -Path $agentsTarget -Force | Out-Null }

    foreach ($file in $agentFiles) {
        $target = Join-Path $agentsTarget $file.Name
        if (Test-Path $target) {
            if ((Get-Item -Path $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                Write-Host "ABORT: $target is a reparse point (symlink) — refusing to overwrite it." -ForegroundColor Red
                continue
            }
            if ((Get-FileHash $target).Hash -eq (Get-FileHash $file.FullName).Hash) {
                Write-Host "$($file.Name): unchanged"
                continue
            }
            if ($DryRun) {
                Write-Host "[DryRun] Would back up $target to $agentsBackup, then overwrite it"
                continue
            }
            New-Item -ItemType Directory -Path $agentsBackup -Force | Out-Null
            Copy-Item -Path $target -Destination $agentsBackup -Force
            if (-not (Test-Path (Join-Path $agentsBackup $file.Name))) {
                throw "Backup verification failed for agent '$($file.Name)'. Aborting before overwriting it."
            }
        } elseif ($DryRun) {
            Write-Host "[DryRun] Would copy $($file.Name)"
            continue
        }
        Copy-Item -Path $file.FullName -Destination $target -Force
        Write-Host "$($file.Name): installed" -ForegroundColor Green
    }
}

Write-Host ""
if ($DryRun) {
    Write-Host "Dry run complete — no changes made." -ForegroundColor Yellow
} else {
    Write-Host "Done." -ForegroundColor Green
}
