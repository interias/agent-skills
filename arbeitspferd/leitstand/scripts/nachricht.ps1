# Delivers a message to a running Arbeitspferd session without restarting it: the text goes into a file,
# a tiny Haiku helper in the second account sends the session a pointer to it (SendMessage between peers).
# Falls back to a resume in a new window only when the session's process is gone.
# Usage: nachricht.ps1 -SessionId <id> -Text "..."   or   -Datei <file>
param(
    [Parameter(Mandatory)][string]$SessionId,
    [string]$Text,
    [string]$Datei
)

$cfg = "$HOME\.claude-arbeitspferd"
if ($Text) {
    $Datei = Join-Path "$cfg\auftraege" "$(Get-Date -Format 'yyyyMMdd-HHmmss')-nachricht.txt"
    Set-Content $Datei $Text -Encoding utf8NoBOM
}
if (-not $Datei -or -not (Test-Path $Datei)) { throw 'Text oder vorhandene Datei angeben.' }
$Datei = (Resolve-Path $Datei).Path

$reg = @(Get-Content "$cfg\leitstand\register.json" -Raw -EA SilentlyContinue | ConvertFrom-Json) | Where-Object sessionId -eq $SessionId
$sess = Get-ChildItem "$cfg\sessions\*.json" | ForEach-Object { Get-Content $_ -Raw | ConvertFrom-Json } |
    Where-Object sessionId -eq $SessionId | Select-Object -First 1
$lebt = $sess -and (Get-Process -Id $sess.pid -EA SilentlyContinue)

if (-not $lebt) {
    if (-not $reg) { throw "Sitzung $SessionId weder laufend noch im Register." }
    & "$cfg\fortsetzen.ps1" -Repo $reg.repo -SessionId $SessionId -AuftragDatei $Datei
    "NEUSTART $($reg.name): Sitzung lief nicht, in neuem Fenster fortgesetzt"
    return
}

$botschaft = "Nachricht der Hauptsitzung: Lies $Datei vollständig und arbeite danach. Wenn du gerade mitten in etwas bist, mach das erst fertig."
$prompt = "Use SendMessage exactly once, to `"$($sess.name)`", with exactly this message text and nothing added: `"$botschaft`" Then print only the tool result."
Get-ChildItem Env: | Where-Object Name -match '^CLAUDE' | ForEach-Object { Remove-Item "Env:$($_.Name)" }
$env:CLAUDE_CONFIG_DIR = $cfg
Push-Location "$HOME\git"
$aus = $prompt | claude -p --model haiku --tools SendMessage,ListAgents --allowedTools SendMessage ListAgents 2>&1
Pop-Location

# Confirmed only when the message shows up in the session's own transcript
$projekt = $sess.cwd -replace '[:\\/]', '-'
$transkript = "$cfg\projects\$projekt\$SessionId.jsonl"
$name = Split-Path -Leaf $Datei
foreach ($i in 1..15) {
    if (Select-String -Path $transkript -SimpleMatch $name -Quiet) { "ZUGESTELLT an $($sess.name) ($name)"; return }
    Start-Sleep 2
}
"NICHT BESTAETIGT an $($sess.name): $(($aus | Out-String).Trim())"
exit 1
