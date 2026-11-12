# The one watcher of the Leitstand: run it under Monitor. It prints a line only when the main session has
# to act, so a quiet line costs nothing. Re-reads the register every pass, so new sessions need no restart.
#   MELDUNG  a marker line of a session ("LEITSTAND: PR #n bereit", "... FRAGE", "... FERTIG", "... BLOCKIERT")
#   FRAGE    the session opened a question dialog (AskUserQuestion)
#   ERLAUBNIS a permission prompt has been open for 2 minutes
#   WARTET   idle for -StillMinuten without a marker (it probably asked in prose or stopped)
#   HAENGT   busy, but no transcript changed and no child process ran for -StillMinuten
#   BEENDET  its process is gone
#   RAM      the RAM brake entered or left hold, or use crossed 92 %
param([int]$StillMinuten = 20)

$cfg = "$HOME\.claude-arbeitspferd"
$regDatei = "$cfg\leitstand\register.json"
$marker = '^\s*(LEITSTAND:.*|.*PR #\d+ bereit zum Mergen.*|.*ISSUES FERTIG.*)$'
$pos = @{}; $zustand = @{}; $letzteMeldung = @{}
$ramHold = $false; $ramHoch = $false; $letzterDrop = [datetime]::MinValue

function Melde([string]$text) { "$(Get-Date -Format HH:mm) $text" }

while ($true) {
    $reg = @(Get-Content $regDatei -Raw -EA SilentlyContinue | ConvertFrom-Json) | Where-Object { $_ -and $_.aktiv }
    $sess = Get-ChildItem "$cfg\sessions\*.json" -EA SilentlyContinue | ForEach-Object { Get-Content $_ -Raw -EA SilentlyContinue | ConvertFrom-Json -EA SilentlyContinue }
    $procs = Get-CimInstance Win32_Process

    foreach ($e in $reg) {
        $basis = "$cfg\projects\$($e.repo -replace '[:\\/]', '-')\$($e.sessionId)"
        $datei = "$basis.jsonl"

        # New complete transcript lines since the last pass; the first pass only takes the position
        if (Test-Path $datei) {
            $laenge = (Get-Item $datei).Length
            if (-not $pos.ContainsKey($datei)) { $pos[$datei] = $laenge }
            elseif ($laenge -gt $pos[$datei]) {
                $fs = [IO.File]::Open($datei, 'Open', 'Read', 'ReadWrite')
                [void]$fs.Seek($pos[$datei], 'Begin')
                $puffer = New-Object byte[] ($laenge - $pos[$datei])
                $gelesen = $fs.Read($puffer, 0, $puffer.Length); $fs.Close()
                $ende = [Array]::LastIndexOf($puffer, [byte]10, $gelesen - 1)
                if ($ende -ge 0) {
                    $pos[$datei] += $ende + 1
                    foreach ($zeile in [Text.Encoding]::UTF8.GetString($puffer, 0, $ende).Split("`n")) {
                        try { $j = $zeile | ConvertFrom-Json -EA Stop } catch { continue }
                        if ($j.type -ne 'assistant') { continue }
                        foreach ($c in $j.message.content) {
                            if ($c.type -eq 'text') {
                                foreach ($m in [regex]::Matches($c.text, $marker, 'Multiline')) {
                                    $t = $m.Value.Trim(); if ($t.Length -gt 300) { $t = $t.Substring(0, 300) + '…' }
                                    Melde "MELDUNG $($e.name): $t"; $letzteMeldung[$e.sessionId] = Get-Date
                                }
                            } elseif ($c.type -eq 'tool_use' -and $c.name -eq 'AskUserQuestion') {
                                Melde "FRAGE $($e.name): $(($c.input.questions | ForEach-Object question) -join ' | ')"
                                $letzteMeldung[$e.sessionId] = Get-Date
                            }
                        }
                    }
                }
            }
        }

        # Process state, reported once per change
        $s = $sess | Where-Object sessionId -eq $e.sessionId | Sort-Object updatedAt -Descending | Select-Object -First 1
        $proc = if ($s) { $procs | Where-Object { $_.ProcessId -eq $s.pid -and $_.Name -eq 'claude.exe' } }
        $neu = ''
        if (-not $proc) { $neu = 'BEENDET' }
        else {
            $minuten = ((Get-Date) - [DateTimeOffset]::FromUnixTimeMilliseconds($s.statusUpdatedAt).LocalDateTime).TotalMinutes
            $kinder = $procs | Where-Object { $_.ParentProcessId -eq $proc.ProcessId -and $_.Name -ne 'conhost.exe' }
            if ($s.waitingFor -eq 'permission prompt' -and $minuten -ge 2) { $neu = 'ERLAUBNIS' }
            elseif ($s.status -eq 'idle' -and $minuten -ge $StillMinuten -and -not ($letzteMeldung[$e.sessionId] -and $letzteMeldung[$e.sessionId] -gt (Get-Date).AddMinutes(-$minuten - 1))) { $neu = 'WARTET' }
            elseif ($s.status -ne 'idle' -and -not $kinder) {
                $juengste = Get-ChildItem $datei, $basis -Recurse -Filter *.jsonl -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
                if ($juengste -and ((Get-Date) - $juengste.LastWriteTime).TotalMinutes -ge $StillMinuten) { $neu = 'HAENGT' }
            }
        }
        if ($neu -and $zustand[$e.sessionId] -ne $neu) { Melde "$neu $($e.name) $($e.sessionId.Substring(0, 8))" }
        $zustand[$e.sessionId] = $neu
    }

    # RAM brake; at warn or hold drop the page cache of the WSL VM silently, at most every 5 minutes.
    # All distributions share the one VM, so any running one will do (Docker Desktop: docker-desktop,
    # docker in WSL: e.g. Ubuntu); a stopped WSL is never started for this.
    $ram = powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.claude\skills\epic\scripts\ram.ps1" -RepoRoot "$HOME\git" 2>$null | ConvertFrom-Json
    if ($ram) {
        if ($ram.level -ne 'ok' -and ((Get-Date) - $letzterDrop).TotalMinutes -ge 5) {
            $distro = @(wsl --list --running --quiet 2>$null | ForEach-Object { "$_".Replace("`0", '').Trim() } | Where-Object { $_ -match '^[\w.-]+$' })[0]
            if ($distro) { wsl -d $distro -u root sh -c "sync; echo 3 > /proc/sys/vm/drop_caches; echo 1 > /proc/sys/vm/compact_memory" 2>$null }
            $letzterDrop = Get-Date
        }
        $hold = $ram.level -eq 'hold'; $hoch = $ram.percent_used -ge 92
        if ($hold -ne $ramHold -or ($hoch -and -not $ramHoch)) { Melde "RAM $($ram.percent_used) % belegt, $($ram.free_gb) GB frei, Stufe $($ram.level)" }
        $ramHold = $hold; $ramHoch = $hoch
    }
    Start-Sleep 30
}
