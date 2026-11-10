<#
.SYNOPSIS
    Sets up the second Claude account ("Arbeitspferd") on this machine: config folder, start scripts,
    icon, Claude theme and the Windows Terminal profile with its colour scheme.

.DESCRIPTION
    - Copies dateien/* into ~/.claude-arbeitspferd. A file that already exists and differs is first
      backed up to ~/.claude/skills-backup/arbeitspferd-<timestamp>/. settings.json is only written
      when none exists yet, because the account keeps changing its own settings.
    - Copies themes/claude-farbe.json into ~/.claude/themes, same backup rule.
    - Creates the junctions skills, agents, output-styles, plugins and themes in the config folder,
      pointing to ~/.claude. Existing entries are left alone. Nothing is ever deleted.
    - Adds or replaces the profile "Claude Arbeitspferd" and the scheme "Claude Code" in every
      Windows Terminal settings.json it finds, after a backup next to it. Comments in that file are lost.
    Sign in afterwards once: open the profile and run /login.
    Needs PowerShell 7 (pwsh).

.PARAMETER DryRun
    Show what would happen without changing anything.

.EXAMPLE
    pwsh -File arbeitspferd\einrichten.ps1 -DryRun
#>
[CmdletBinding()]
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Bitte mit pwsh (PowerShell 7) starten.' }

$src = $PSScriptRoot
$main = Join-Path $HOME '.claude'
$cfg = Join-Path $HOME '.claude-arbeitspferd'
$backup = Join-Path $main "skills-backup\arbeitspferd-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

function Copy-WithBackup([string]$file, [string]$targetDir) {
    $target = Join-Path $targetDir (Split-Path -Leaf $file)
    if ((Test-Path $target) -and (Get-FileHash $target).Hash -eq (Get-FileHash $file).Hash) { "unveraendert: $target"; return }
    if ($DryRun) { "[DryRun] wuerde schreiben: $target$(if (Test-Path $target) { ' (mit Sicherung)' })"; return }
    if (Test-Path $target) {
        New-Item -ItemType Directory -Force $backup | Out-Null
        Copy-Item $target $backup -Force
    }
    New-Item -ItemType Directory -Force $targetDir | Out-Null
    Copy-Item $file $target -Force
    "geschrieben: $target"
}

# Files of the config folder
foreach ($f in Get-ChildItem (Join-Path $src 'dateien') -File) {
    if ($f.Name -eq 'settings.json' -and (Test-Path (Join-Path $cfg 'settings.json'))) { "behalten: $cfg\settings.json"; continue }
    Copy-WithBackup $f.FullName $cfg
}
Copy-WithBackup (Join-Path $src 'themes\claude-farbe.json') (Join-Path $main 'themes')

# Shared folders of the main account, as junctions
foreach ($n in 'skills', 'agents', 'output-styles', 'plugins', 'themes') {
    $link = Join-Path $cfg $n; $ziel = Join-Path $main $n
    if (Test-Path $link) {
        $item = Get-Item $link -Force
        if ($item.LinkType -and $item.Target -eq $ziel) { "Link ok: $link" } else { "UEBERSPRUNGEN: $link existiert, ist aber kein Link auf $ziel" }
        continue
    }
    if ($DryRun) { "[DryRun] wuerde Link anlegen: $link -> $ziel"; continue }
    New-Item -ItemType Directory -Force $ziel | Out-Null
    New-Item -ItemType Junction -Path $link -Target $ziel | Out-Null
    "Link angelegt: $link -> $ziel"
}

# Windows Terminal: profile and scheme, placeholders filled in
$vorlage = (Get-Content -Raw (Join-Path $src 'windows-terminal.json')).Replace('{CFG}', $cfg.Replace('\', '\\')).Replace('{HOME}', $HOME.Replace('\', '\\')) | ConvertFrom-Json
$wtDateien = @(Get-ChildItem "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal*\LocalState\settings.json" -EA SilentlyContinue) +
    @(Get-Item "$env:LOCALAPPDATA\Microsoft\Windows Terminal\settings.json" -EA SilentlyContinue) | Where-Object { $_ }
if (-not $wtDateien) { 'Windows Terminal: keine settings.json gefunden. Einmal Windows Terminal starten, dann erneut ausfuehren.' }
foreach ($wt in $wtDateien) {
    $s = Get-Content -Raw $wt.FullName | ConvertFrom-Json
    $s.profiles.list = @($s.profiles.list | Where-Object guid -ne $vorlage.profile.guid) + $vorlage.profile
    if (-not $s.PSObject.Properties['schemes']) { $s | Add-Member schemes @() }
    $s.schemes = @($s.schemes | Where-Object name -ne $vorlage.scheme.name) + $vorlage.scheme
    if ($DryRun) { "[DryRun] wuerde Profil und Schema eintragen: $($wt.FullName)"; continue }
    Copy-Item $wt.FullName "$($wt.FullName).bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    $s | ConvertTo-Json -Depth 100 | Set-Content $wt.FullName -Encoding utf8NoBOM
    "Windows Terminal: Profil und Schema eingetragen in $($wt.FullName)"
}

if (-not (Test-Path (Join-Path $cfg '.credentials.json'))) { "Noch nicht angemeldet: Profil 'Claude Arbeitspferd' oeffnen, claude starten, /login." }
