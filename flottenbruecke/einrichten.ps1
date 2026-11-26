<#
.SYNOPSIS
    Sets up the Flottenbruecke on this machine: .env with the PIN, the container, the accounts list and,
    only with -Autostart, scheduled tasks at logon. A second run changes nothing that exists, except a driver
    task with an older action, which it switches over to run without a window.

.DESCRIPTION
    - Creates .env from .env.example when it is missing and asks for the PIN (hidden input, never shown
      or logged; empty: answering stays switched off). An existing .env is left alone, no PIN is asked.
    - docker compose up -d --build --wait in this folder.
    - Writes ~/.claude/flotte/konten.json with the accounts 1-3 once, when the file is missing (#94).
    - Only with -Autostart: a scheduled task at logon for the bridge ("Flottenbruecke", only when missing) and
      one per driver start script in ~/.claude/flotte/start/*.ps1 ("Flotte <name>", ../flotte/autostart.ps1:
      without a window, an existing one with an older action switched over).
      Without the switch the task scheduler is not touched.
    - At the end opens the bridge in the browser; it guides through the rest (accounts, forge, projects).
    install.ps1 calls this script when the bridge is missing (no .env here). Runs in Windows PowerShell
    5.1 and pwsh 7.

.PARAMETER Autostart
    Register the scheduled tasks at logon for the bridge and the driver start scripts.

.PARAMETER Heim
    Home folder whose .claude\flotte holds konten.json and the start scripts; default the user's.

.PARAMETER OhneBrowser
    Do not open the bridge in the browser at the end.

.EXAMPLE
    pwsh -File flottenbruecke\einrichten.ps1

.EXAMPLE
    pwsh -File flottenbruecke\einrichten.ps1 -Autostart
#>
[CmdletBinding()]
param(
    [switch]$Autostart,
    [string]$Heim = $HOME,
    [switch]$OhneBrowser
)

$ErrorActionPreference = 'Stop'
$ordner = $PSScriptRoot
# no BOM: docker compose reads .env, Node reads konten.json
$utf8 = New-Object Text.UTF8Encoding $false

# 1. .env with the PIN, only when it is missing
$envDatei = Join-Path $ordner '.env'
if (Test-Path -LiteralPath $envDatei) {
    'behalten: .env (PIN unveraendert)'
} else {
    $sicher = Read-Host -AsSecureString 'PIN fuer die Bruecke (leer: Antworten abgeschaltet)'
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sicher)
    try {
        $pin = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        $zeilen = Get-Content -LiteralPath (Join-Path $ordner '.env.example') | ForEach-Object { if ($_ -match '^BRUECKE_PIN=') { "BRUECKE_PIN=$pin" } else { $_ } }
        [IO.File]::WriteAllText($envDatei, (($zeilen -join "`n") + "`n"), $utf8)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        $pin = $null
    }
    "angelegt: .env$(if ($sicher.Length) { ' mit PIN' } else { ' ohne PIN (Antworten abgeschaltet)' })"
}

# 2. the container; compose leaves a running, unchanged one as it is
Push-Location $ordner
try {
    docker compose up -d --build --wait
    if ($LASTEXITCODE) { throw "docker compose up endete mit Code $LASTEXITCODE." }
} finally { Pop-Location }
'Bruecke laeuft (docker compose)'

# 3. the accounts 1-3 once (#94), the same standard flotte uses without the file
$kontenDatei = Join-Path $Heim '.claude\flotte\konten.json'
if (Test-Path -LiteralPath $kontenDatei) {
    "behalten: $kontenDatei"
} else {
    New-Item -ItemType Directory -Force (Split-Path -Parent $kontenDatei) | Out-Null
    $standard = '[
  { "nr": "1", "ordner": "~/.claude", "name": "Hauptkonto", "farbe": "#8FB573", "aktiv": true },
  { "nr": "2", "ordner": "~/.claude-arbeitspferd", "name": "Arbeitspferd", "farbe": "#D97757", "aktiv": true },
  { "nr": "3", "ordner": "~/.claude-arbeitspferd-3", "name": "Arbeitspferd 3", "farbe": "#7AA2C8", "aktiv": true }
]
'
    [IO.File]::WriteAllText($kontenDatei, $standard, $utf8)
    "angelegt: $kontenDatei (Konten 1-3)"
}

# 4. only with -Autostart: scheduled tasks at logon. The bridge task only when missing; the driver tasks through
# flotte/autostart.ps1 (shared with `flotte projekt hinzufuegen --autostart`): no window, an older one switched over
if ($Autostart) {
    if (Get-ScheduledTask -TaskName 'Flottenbruecke' -ErrorAction SilentlyContinue) { 'Aufgabe vorhanden: Flottenbruecke' } else {
        $aktion = New-ScheduledTaskAction -Execute 'docker' -Argument 'compose up -d' -WorkingDirectory $ordner
        # for the signed-in user: no admin rights needed
        Register-ScheduledTask -TaskName 'Flottenbruecke' -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) -Action $aktion -User $env:USERNAME | Out-Null
        'Aufgabe angelegt: Flottenbruecke (beim Anmelden)'
    }
    $autostartSkript = Join-Path $ordner '..\flotte\autostart.ps1'
    $startOrdner = Join-Path $Heim '.claude\flotte\start'
    foreach ($s in @(Get-ChildItem -LiteralPath $startOrdner -Filter '*.ps1' -File -ErrorAction SilentlyContinue)) {
        $wie = & $autostartSkript -Skript $s.FullName -Heim $Heim
        $text = @{ angelegt = 'angelegt: {0} (beim Anmelden, ohne Fenster)'; vorhanden = 'vorhanden: {0}'; umgestellt = 'umgestellt: {0} (ohne Fenster)' }[[string]$wie]
        'Aufgabe ' + ($text -f "Flotte $($s.BaseName)")
    }
}

# 5. the bridge in the browser; it guides through the rest
$port = (Get-Content -LiteralPath $envDatei | Where-Object { $_ -match '^BRUECKE_PORT=\d+' } | Select-Object -First 1) -replace '^BRUECKE_PORT=', ''
if (-not $port) { $port = '4747' }
$adresse = "http://localhost:$port/"
if ($OhneBrowser) { "Bruecke: $adresse" } else {
    Start-Process $adresse
    "geoeffnet: $adresse"
}
