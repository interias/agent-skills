<#
.SYNOPSIS
    Sets up a Claude account on this machine for its own Windows Terminal profile: config folder, start
    script, icon, Claude theme, the profile with its colour scheme and a desktop shortcut.

.DESCRIPTION
    Without -Konfig it sets up the second account ("Arbeitspferd", ~/.claude-arbeitspferd). Further
    accounts get a folder ~/.claude-arbeitspferd-<n>; -Konfig ~/.claude gives the main account a profile.
    Profile name, tab colour and icon come from the table $bekannt below unless given.
    - Copies dateien/* into the config folder. A file that already exists and differs is first
      backed up to ~/.claude/skills-backup/<folder>-<timestamp>/. settings.json is only written when
      none exists yet, because the account keeps changing its own settings. For the main account it
      copies only start-arbeitspferd.ps1 (as start-claude.ps1) and the icon; its settings stay untouched.
    - Enters ~/.claude and every ~/.claude-arbeitspferd* folder as additionalDirectories in the
      settings.json of every ~/.claude-arbeitspferd* folder, so no start stops at the trust prompt.
    - Copies themes/claude-farbe.json into ~/.claude/themes, same backup rule.
    - Creates the junctions skills, agents, output-styles, plugins and themes in the config folder,
      pointing to ~/.claude (not for the main account). Existing entries are left alone. Nothing is
      ever deleted.
    - Adds or replaces the profile and the scheme "Claude Code" in every Windows Terminal settings.json
      it finds, after a backup next to it. Comments in that file are lost. Every profile but the
      second account's gets a GUID derived from its name, so the profiles of other accounts stay.
    - Creates the desktop shortcut "<profile>.lnk" (wt.exe -w new -p "<profile>") unless it exists.
    Sign in afterwards once: open the profile and run /login.
    Needs PowerShell 7 (pwsh).

.PARAMETER DryRun
    Show what would happen without changing anything.

.PARAMETER Konfig
    Config folder of the account: ~/.claude or a folder ~/.claude-arbeitspferd*.

.PARAMETER Profil
    Name of the Windows Terminal profile and of the desktop shortcut.

.PARAMETER Farbe
    Tab colour of the profile.

.PARAMETER Desktop
    Folder of the desktop shortcut, by default the user's desktop (may be the OneDrive desktop).

.EXAMPLE
    pwsh -File arbeitspferd\einrichten.ps1 -DryRun

.EXAMPLE
    pwsh -File arbeitspferd\einrichten.ps1 -Konfig ~\.claude-arbeitspferd-3 -DryRun
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$Konfig = (Join-Path $HOME '.claude-arbeitspferd'),
    [string]$Profil,
    [string]$Farbe,
    [string]$Desktop = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Bitte mit pwsh (PowerShell 7) starten.' }

# Accounts with a fixed profile name, tab colour and icon (dateien/<icon>, built by icon-bauen.ps1)
$bekannt = @{
    '.claude'                = @{ Profil = 'Claude Hauptkonto'; Farbe = '#8FB573'; Icon = 'hauptkonto.ico' }
    '.claude-arbeitspferd'   = @{ Profil = 'Claude Arbeitspferd'; Farbe = '#D97757'; Icon = 'arbeitspferd.ico' }
    '.claude-arbeitspferd-3' = @{ Profil = 'Claude Arbeitspferd 3'; Farbe = '#7AA2C8'; Icon = 'arbeitspferd-3.ico' }
}

$src = $PSScriptRoot
$main = Join-Path $HOME '.claude'
if ($Konfig -match '^~') { $Konfig = $HOME + $Konfig.Substring(1) }
$cfg = [IO.Path]::GetFullPath($Konfig).TrimEnd('\')
$leaf = Split-Path -Leaf $cfg
if ((Split-Path -Parent $cfg) -ne $HOME.TrimEnd('\') -or ($leaf -ne '.claude' -and $leaf -notlike '.claude-arbeitspferd*')) {
    throw "Konfigordner muss $main sein oder direkt in $HOME liegen und mit .claude-arbeitspferd beginnen: $cfg"
}
$haupt = $cfg -eq $main
$konto = $bekannt[$leaf]
if (-not $konto) { $konto = @{ Profil = "Claude Arbeitspferd $($leaf.Substring('.claude-arbeitspferd'.Length).TrimStart('-'))"; Farbe = '#D97757'; Icon = 'arbeitspferd.ico' } }
if (-not $Profil) { $Profil = $konto.Profil }
if (-not $Farbe) { $Farbe = $konto.Farbe }
$icon = $konto.Icon
$startSkript = if ($haupt) { 'start-claude.ps1' } else { 'start-arbeitspferd.ps1' }
$backup = Join-Path $main "skills-backup\$($leaf.TrimStart('.').Replace('claude-', ''))-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

function Copy-WithBackup([string]$file, [string]$targetDir, [string]$backupDir = $backup, [string]$name = (Split-Path -Leaf $file)) {
    $target = Join-Path $targetDir $name
    if ((Test-Path $target) -and (Get-FileHash $target).Hash -eq (Get-FileHash $file).Hash) { "unveraendert: $target"; return }
    if ($DryRun) { "[DryRun] wuerde schreiben: $target$(if (Test-Path $target) { ' (mit Sicherung)' })"; return }
    if (Test-Path $target) {
        New-Item -ItemType Directory -Force $backupDir | Out-Null
        Copy-Item $target $backupDir -Force
    }
    New-Item -ItemType Directory -Force $targetDir | Out-Null
    Copy-Item $file $target -Force
    "geschrieben: $target"
}

# Files of the config folder; the main account only needs its start script and icon
if ($haupt) {
    Copy-WithBackup (Join-Path $src 'dateien\start-arbeitspferd.ps1') $cfg -name $startSkript
    Copy-WithBackup (Join-Path $src "dateien\$icon") $cfg
} else {
    foreach ($f in Get-ChildItem (Join-Path $src 'dateien') -File) {
        if ($f.Name -eq 'settings.json' -and (Test-Path (Join-Path $cfg 'settings.json'))) { "behalten: $cfg\settings.json"; continue }
        Copy-WithBackup $f.FullName $cfg
    }
}
Copy-WithBackup (Join-Path $src 'themes\claude-farbe.json') (Join-Path $main 'themes')

# Folders every session needs. Passed as --add-dir they stop each start at the trust prompt, so they live
# in the settings of every further account, each one listing all config folders
$konten = @(@(if (-not $haupt) { $cfg }) + @(Get-ChildItem $HOME -Directory -Force -Filter '.claude-arbeitspferd*' | ForEach-Object FullName) | Sort-Object -Unique)
foreach ($k in $konten) {
    $settingsDatei = Join-Path $k 'settings.json'
    if (-not (Test-Path $settingsDatei)) {
        if (-not ($DryRun -and $k -eq $cfg)) { continue }
        $settingsDatei = Join-Path $src 'dateien\settings.json'   # the template the real run would write
    }
    $settings = Get-Content $settingsDatei -Raw | ConvertFrom-Json -Depth 32
    if (-not $settings.permissions) { $settings | Add-Member -Force permissions ([pscustomobject]@{}) }
    $vorhanden = @($settings.permissions.additionalDirectories | Where-Object { $_ })
    $fehlend = @(@($main) + $konten | Where-Object { $_ -notin $vorhanden })
    if ($fehlend -and $DryRun) { "[DryRun] wuerde in $k\settings.json eintragen: $($fehlend -join ', ')" }
    elseif ($fehlend) {
        $settings.permissions | Add-Member -Force additionalDirectories @($vorhanden + $fehlend)
        ConvertTo-Json $settings -Depth 32 | Set-Content $settingsDatei -Encoding utf8NoBOM
        "eingetragen in $settingsDatei`: $($fehlend -join ', ')"
    }
}

# Shared folders of the main account, as junctions
foreach ($n in @(if (-not $haupt) { 'skills', 'agents', 'output-styles', 'plugins', 'themes' })) {
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

# Windows Terminal: profile and scheme, placeholders filled in. The template's GUID is the second
# account's; every other profile gets one derived from its name, so a second call replaces it
$vorlage = (Get-Content -Raw (Join-Path $src 'windows-terminal.json')).Replace('{CFG}', $cfg.Replace('\', '\\')).Replace('{HOME}', $HOME.Replace('\', '\\')) | ConvertFrom-Json
if ($Profil -ne $vorlage.profile.name) {
    $md5 = [Security.Cryptography.MD5]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($Profil))
    $vorlage.profile.guid = "{$([guid]::new($md5))}"
}
$vorlage.profile.name = $Profil
$vorlage.profile.commandline = $vorlage.profile.commandline.Replace('start-arbeitspferd.ps1', $startSkript) + " -Titel `"$Profil`""
$vorlage.profile.icon = Join-Path $cfg $icon
$vorlage.profile.tabColor = $Farbe
$wtDateien = @(Get-ChildItem "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal*\LocalState\settings.json" -EA SilentlyContinue) +
    @(Get-Item "$env:LOCALAPPDATA\Microsoft\Windows Terminal\settings.json" -EA SilentlyContinue) | Where-Object { $_ }
if (-not $wtDateien) { 'Windows Terminal: keine settings.json gefunden. Einmal Windows Terminal starten, dann erneut ausfuehren.' }
foreach ($wt in $wtDateien) {
    $s = Get-Content -Raw $wt.FullName | ConvertFrom-Json
    $s.profiles.list = @($s.profiles.list | Where-Object guid -ne $vorlage.profile.guid) + $vorlage.profile
    if (-not $s.PSObject.Properties['schemes']) { $s | Add-Member schemes @() }
    $s.schemes = @($s.schemes | Where-Object name -ne $vorlage.scheme.name) + $vorlage.scheme
    if ($DryRun) { "[DryRun] wuerde Profil '$Profil' und Schema eintragen: $($wt.FullName)"; continue }
    Copy-Item $wt.FullName "$($wt.FullName).bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    $s | ConvertTo-Json -Depth 100 | Set-Content $wt.FullName -Encoding utf8NoBOM
    "Windows Terminal: Profil '$Profil' und Schema eingetragen in $($wt.FullName)"
}

# Desktop shortcut that opens the profile in a new window; an existing one stays as it is
$lnk = Join-Path $Desktop "$Profil.lnk"
if (Test-Path $lnk) { "Verknuepfung vorhanden: $lnk" }
elseif ($DryRun) { "[DryRun] wuerde Verknuepfung anlegen: $lnk" }
else {
    $wtExe = (Get-Command wt.exe -EA SilentlyContinue).Source
    if (-not $wtExe) { $wtExe = "$env:LOCALAPPDATA\Microsoft\WindowsApps\wt.exe" }
    New-Item -ItemType Directory -Force $Desktop | Out-Null
    $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
    $sc.TargetPath = $wtExe
    $sc.Arguments = "-w new -p `"$Profil`""
    $sc.IconLocation = Join-Path $cfg $icon
    $sc.Save()
    "Verknuepfung angelegt: $lnk"
}

if (-not (Test-Path (Join-Path $cfg '.credentials.json'))) { "Noch nicht angemeldet: Profil '$Profil' oeffnen, claude starten, /login." }
