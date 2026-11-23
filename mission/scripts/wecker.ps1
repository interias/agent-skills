# The alarm clock of #211. A run or an engineer waiting for its own background work (full run,
# gate, subagent) keeps its context in the warm cache for one hour only; the next turn after that
# writes it anew. Started as a second background command next to the long one, the clock ends
# when the end line stands in the log or after -Minuten, whichever comes first. Its notification
# wakes the run in time: it reads the log, reports one line and starts the clock again.
#
#   wecker.ps1 -Log <logfile> -Muster '<end line of the project gate, here ^Gate >' -Minuten 50
#   wecker.ps1 -Minuten 50                       (no log: a subagent in the background)
#
# Exit 0: end line found (it is printed). Exit 3: time up ("Zeit um", last log line). Exit 2: usage.

param(
    [string]$Log = '',
    [string]$Muster = '',
    [double]$Minuten = 50
)

if ($Minuten -le 0 -or $Minuten -gt 55) { 'wecker: -Minuten muss zwischen 0 und 55 liegen (der warme Speicher haelt eine Stunde).'; exit 2 }
if (($Log -eq '') -ne ($Muster -eq '')) { 'wecker: -Log und -Muster nur zusammen.'; exit 2 }

$ende = (Get-Date).AddMinutes($Minuten)
function Read-Zeilen {
    if ($Log -eq '' -or -not (Test-Path -LiteralPath $Log)) { return @() }
    try { @(Get-Content -LiteralPath $Log -ErrorAction Stop) } catch { @() }
}

while ($true) {
    if ($Log -ne '') {
        $treffer = @(Read-Zeilen | Where-Object { $_ -match $Muster })
        if ($treffer.Count) { "wecker: fertig: $($treffer[-1])"; exit 0 }
    }
    $rest = ($ende - (Get-Date)).TotalSeconds
    if ($rest -le 0) { break }
    Start-Sleep -Milliseconds ([int][Math]::Min(5000, [Math]::Ceiling($rest * 1000)))
}

$letzte = @(Read-Zeilen | Where-Object { $_ -ne '' })
$stand = if ($letzte.Count) { $letzte[-1] } else { '(kein Log)' }
"wecker: Zeit um nach $Minuten min, Stand: $stand"
exit 3
