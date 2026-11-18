# Closes the window of a session from the register once it has nothing left to do: only an idle session, only the
# shell that start-arbeitspferd.ps1 opened. Marks the session as done and rearranges the remaining windows.
# Usage: fenster-schliessen.ps1 -SessionId <id>
param([Parameter(Mandatory)][string]$SessionId)

$cfg = "$HOME\.claude-arbeitspferd"
$eintrag = @(Get-Content "$cfg\leitstand\register.json" -Raw | ConvertFrom-Json) | Where-Object sessionId -eq $SessionId
if (-not $eintrag) { "NICHT IM REGISTER: $SessionId"; exit 1 }

$sitzung = Get-ChildItem "$cfg\sessions\*.json" -EA SilentlyContinue | ForEach-Object { Get-Content $_ -Raw -EA SilentlyContinue | ConvertFrom-Json } |
    Where-Object sessionId -eq $SessionId | Select-Object -First 1
if ($sitzung -and (Get-Process -Id $sitzung.pid -EA SilentlyContinue)) {
    if ($sitzung.status -ne 'idle' -or $sitzung.waitingFor) { "LAEUFT NOCH ($($sitzung.status)): $SessionId bleibt offen"; exit 1 }
    $eltern = (Get-CimInstance Win32_Process -Filter "ProcessId=$($sitzung.pid)").ParentProcessId
    $huelle = Get-CimInstance Win32_Process -Filter "ProcessId=$eltern"
    if ($huelle.CommandLine -notmatch 'start-arbeitspferd') { "FENSTER NICHT ERKANNT: $SessionId bleibt offen"; exit 1 }
    taskkill /PID $eltern /T /F | Out-Null
}
& "$PSScriptRoot\lage.ps1" -Abhaken $SessionId | Out-Null
Start-Sleep -Milliseconds 500
& "$PSScriptRoot\fenster-ordnen.ps1" | Out-Null
"GESCHLOSSEN $SessionId"
