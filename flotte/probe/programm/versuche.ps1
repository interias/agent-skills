<#
.SYNOPSIS
    The four trials of stage 0 (agent-skills#69, #64) against `claude -p`: base load, agent file,
    --json-schema over a long run with tools, --resume after an abort in the middle of a tool call.

.DESCRIPTION
    Every call is `claude -p --output-format stream-json --verbose --permission-mode auto
    --permission-prompts none --strict-mcp-config` like a run of the driver (src/werkzeuge/lauf.ts),
    with the order as a file on stdin. The stream-json log of every call lands in -Aus; nothing is
    summarised here, `flotte messen` and the report read the logs.
    -Repo is a worktree of flotte-probe after vorbereiten.ps1 (agents in .claude/agents/); the
    trials with tools reset it with `git checkout`/`git clean` before each call.

.EXAMPLE
    pwsh -NoProfile -File versuche.ps1 -Repo C:\src\flotte-probe-versuch -Konto C:\Users\me\.claude-arbeitspferd-3 -Aus C:\tmp\versuche -Versuch alle
#>
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][string]$Konto,
    [Parameter(Mandatory)][string]$Aus,
    [ValidateSet('grundlast', 'agent', 'schema', 'resume', 'alle')][string]$Versuch = 'alle',
    [int]$SchemaLaeufe = 5
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
# Reset-Repo runs git clean: only in a clone of the probe repository
$origin = (git -C $Repo remote get-url origin).Trim()
if ($origin -notmatch '[/:]interias/flotte-probe(\.git)?$') { throw "$Repo ist kein Klon von interias/flotte-probe (origin $origin)" }
New-Item -ItemType Directory -Force $Aus | Out-Null
$env:CLAUDE_CONFIG_DIR = $Konto
$basis = @('-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto', '--permission-prompts', 'none', '--strict-mcp-config')

# Starts claude with the order on stdin; returns the process (log: <name>.jsonl, stderr: .err).
function Start-Claude([string]$name, [string]$auftrag, [string[]]$extra) {
    $ein = Join-Path $Aus "$name.auftrag.txt"
    [IO.File]::WriteAllText($ein, $auftrag)
    $argumente = @($basis + $extra | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } })
    Start-Process claude -ArgumentList $argumente -WorkingDirectory $Repo -NoNewWindow -PassThru `
        -RedirectStandardInput $ein -RedirectStandardOutput (Join-Path $Aus "$name.jsonl") -RedirectStandardError (Join-Path $Aus "$name.err")
}

function Invoke-Claude([string]$name, [string]$auftrag, [string[]]$extra = @()) {
    $p = Start-Claude $name $auftrag $extra
    $p.WaitForExit()
    Write-Host "$name exit $($p.ExitCode)"
}

function Reset-Repo {
    git -C $Repo checkout -q -- .
    git -C $Repo clean -q -fd
}

if ($Versuch -in 'grundlast', 'alle') {
    # base load: the first turn of a -p implementer against a subagent, each twice in a row
    foreach ($i in 1, 2, 3) { Invoke-Claude "grundlast-p-standard-$i" 'Antworte nur mit: ok' @('--agent', 'ingenieur-standard') }
    foreach ($i in 1, 2) { Invoke-Claude "grundlast-p-urteil-$i" 'Antworte nur mit: ok' @('--agent', 'ingenieur-urteil') }
    foreach ($i in 1, 2) {
        Invoke-Claude "grundlast-sub-$i" "Starte mit dem Werkzeug Agent genau einen Subagenten: subagent_type ingenieur-standard, description 'Grundlast $i', prompt 'Antworte nur mit: ok'. Im Vordergrund. Gib danach nur seine Antwort wieder." @('--model', 'opus')
    }
}

if ($Versuch -in 'agent', 'alle') {
    # agent file: does --agent bring instruction, model and effort of .claude/agents/<name>.md?
    $frage = 'Antworte ohne Werkzeuge in drei Zeilen: 1. deine Modell-ID, 2. den ersten Satz deiner Anweisung woertlich, 3. ob dir eine Denkstufe (effort) genannt ist und welche.'
    Invoke-Claude 'agent-urteil' $frage @('--agent', 'ingenieur-urteil')
    Invoke-Claude 'agent-standard' $frage @('--agent', 'ingenieur-standard')
    Invoke-Claude 'agent-urteil-effort-low' $frage @('--agent', 'ingenieur-urteil', '--effort', 'low')
}

if ($Versuch -in 'schema', 'alle') {
    # --json-schema over a run with tools, the shape of an implementer report
    $schema = [ordered]@{
        type = 'object'; additionalProperties = $false
        required = @('dateien', 'neue_dateien', 'abnahme', 'volllauf', 'nicht_gekonnt')
        properties = [ordered]@{
            dateien = @{ type = 'array'; items = @{ type = 'string' } }
            neue_dateien = @{ type = 'array'; items = @{ type = 'string' } }
            abnahme = @{ type = 'array'; items = @{ type = 'object'; additionalProperties = $false; required = @('punkt', 'satz'); properties = @{ punkt = @{ type = 'string' }; satz = @{ type = 'string' } } } }
            volllauf = @{ type = 'object'; additionalProperties = $false; required = @('befehl', 'gruen', 'ausgabe'); properties = @{ befehl = @{ type = 'string' }; gruen = @{ type = 'boolean' }; ausgabe = @{ type = 'string' } } }
            nicht_gekonnt = @{ type = 'string' }
        }
    } | ConvertTo-Json -Depth 8 -Compress
    $auftrag = @'
Du arbeitest im aktuellen Ordner (ein Klon von flotte-probe). Nicht committen, nicht branchen.
Abnahmeliste:
1. obst/kiwi.txt enthaelt genau die Zeile "Kiwi: gruen und pelzig".
2. obst/mango.txt enthaelt genau die Zeile "Mango: gelb und weich".
3. obst/feige.txt enthaelt genau die Zeile "Feige: suess und klein".
4. pwsh -NoProfile -File werkzeug/gate.ps1 ist gruen.
Lies vorher werkzeug/gate.ps1 und .claude/epic.md. Fahre die Andockpruefung am Ende genau einmal. Berichte im Ausgabeschema: geaenderte und neue Dateien, je Abnahmepunkt ein Satz, die Andockpruefung als Volllauf mit gekuerzter Ausgabe, was du nicht konntest.
'@
    foreach ($i in @(if ($SchemaLaeufe -ge 1) { 1..$SchemaLaeufe })) {
        Reset-Repo
        Invoke-Claude "schema-$i" $auftrag @('--agent', 'ingenieur-standard', '--json-schema', $schema)
    }
    # a long run: the guard of mini-epic B (child b1) as an implementer of class Urteil
    $lang = @'
Du arbeitest im aktuellen Ordner (ein Klon von flotte-probe). Nicht committen, nicht branchen.
Paket: werkzeug/gate.ps1 prueft im Bereich verse, dass keine .txt-Datei mehr als vier Zeilen hat.
Implementation Decisions: Die Pruefung gehoert in die vorhandene Pruefung des Bereichs, nicht in ein eigenes Skript (die Andockpruefung ist der einzige Testbefehl, der Treiber erkennt nur seine Ausgabeform). Gezaehlt werden Zeilen mit Inhalt; eine abschliessende Leerzeile zaehlt nicht (Editoren haengen sie unterschiedlich an).
Abnahmeliste:
1. Eine .txt-Datei in verse/ mit fuenf Zeilen macht den Bereich verse rot, die Ausgabe nennt die Datei.
2. Eine mit vier Zeilen (auch mit abschliessender Leerzeile) bleibt gruen.
3. Alle uebrigen Regeln der Andockpruefung und ihre Ausgabeform bleiben unveraendert.
Verifikation: Positiv- und Gegenprobe mit je einer voruebergehenden Datei in verse/, danach entfernt; am Ende genau einmal pwsh -NoProfile -File werkzeug/gate.ps1 -Alle.
Berichte im Ausgabeschema.
'@
    foreach ($i in 1, 2) {
        Reset-Repo
        Invoke-Claude "schema-lang-$i" $lang @('--agent', 'ingenieur-urteil', '--json-schema', $schema)
    }
    # many tool calls before the answer: one Read per tracked file
    $viele = @'
Du arbeitest im aktuellen Ordner (ein Klon von flotte-probe). Nicht committen, nicht branchen.
Abnahmeliste:
1. Lies jede Datei aus `git ls-files` einzeln mit dem Werkzeug Read (eine Datei je Aufruf, keine Sammelbefehle) und zaehle ihre Zeilen.
2. uebersicht.txt im Wurzelordner enthaelt je Datei eine Zeile "<pfad>: <zeilen>".
3. pwsh -NoProfile -File werkzeug/gate.ps1 -Alle ist gruen; fahre es am Ende genau einmal.
Berichte im Ausgabeschema.
'@
    Reset-Repo
    Invoke-Claude 'schema-viele-1' $viele @('--agent', 'ingenieur-standard', '--json-schema', $schema)
    Reset-Repo
}

if ($Versuch -in 'resume', 'alle') {
    # --resume after the process died in the middle of a tool call (a long ping: Claude Code
    # refuses a foreground Start-Sleep, first attempt 21.11.2026)
    Reset-Repo
    $auftrag = 'Fuehre genau diesen PowerShell-Befehl aus, im Vordergrund, mit Timeout 300000, und warte auf sein Ende: ping -n 121 127.0.0.1 | Out-Null; Set-Content resume-probe.txt fertig. Danach pruefe, ob resume-probe.txt "fertig" enthaelt, und antworte nur: erledigt'
    $p = Start-Claude 'resume-1' $auftrag @('--agent', 'ingenieur-standard')
    $log = Join-Path $Aus 'resume-1.jsonl'
    $bis = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $bis -and -not ((Test-Path $log) -and (Select-String -LiteralPath $log -Pattern '"type":"tool_use"' -Quiet))) { Start-Sleep -Seconds 2 }
    Start-Sleep -Seconds 15
    $abbruch = Get-Date
    taskkill /PID $p.Id /T /F | Out-Null
    Start-Sleep -Seconds 3
    $sid = (Get-Content $log | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } } | Where-Object { $_.session_id } | Select-Object -First 1).session_id
    Write-Host "resume-1 abgebrochen $($abbruch.ToString('o')) session $sid datei-da $(Test-Path (Join-Path $Repo 'resume-probe.txt'))"
    Invoke-Claude 'resume-2' 'Der vorige Zug wurde mitten im Werkzeugaufruf abgebrochen. Setze die Aufgabe fort.' @('--agent', 'ingenieur-standard', '--resume', $sid)
    Write-Host "resume-2 datei-da $(Test-Path (Join-Path $Repo 'resume-probe.txt'))"
    Reset-Repo
}
