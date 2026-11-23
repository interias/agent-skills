# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\mission\scripts\wecker.Tests.ps1
# The alarm clock of #211: it ends when the end line stands in the log or when the time is up,
# whichever comes first. The script runs as a separate process, the way a run starts it in the
# background; the times are fractions of a minute.

$script = Join-Path $PSScriptRoot 'wecker.ps1'

function Invoke-Wecker([string[]]$arguments) {
    $uhr = [Diagnostics.Stopwatch]::StartNew()
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script @arguments 2>&1
    @{ Exit = $LASTEXITCODE; Out = (@($out) -join "`n"); Sekunden = $uhr.Elapsed.TotalSeconds }
}

Describe 'wecker.ps1' {
    It 'ends at once with exit 0 when the end line already stands in the log' {
        $log = Join-Path $TestDrive 'fertig.log'
        Set-Content -Path $log -Value "Gate gruen."
        $r = Invoke-Wecker @('-Log', $log, '-Muster', '^Gate ', '-Minuten', '1')
        $r.Exit | Should Be 0
        $r.Out | Should Match 'fertig'
        $r.Out | Should Match 'Gate gruen.'
        $r.Sekunden | Should BeLessThan 30
    }

    It 'ends with exit 3 and the last log line when the time is up before the end line' {
        $log = Join-Path $TestDrive 'laeuft.log'
        Set-Content -Path $log -Value "flotte laeuft`nbruecke laeuft"
        $r = Invoke-Wecker @('-Log', $log, '-Muster', '^Gate ', '-Minuten', '0.05')
        $r.Exit | Should Be 3
        $r.Out | Should Match 'Zeit um'
        $r.Out | Should Match 'bruecke laeuft'
    }

    It 'notices an end line written while it waits' {
        $log = Join-Path $TestDrive 'spaeter.log'
        Set-Content -Path $log -Value 'flotte laeuft'
        $job = Start-Job -ScriptBlock { param($p) Start-Sleep -Seconds 3; Add-Content -Path $p -Value 'Gate rot.' } -ArgumentList $log
        $r = Invoke-Wecker @('-Log', $log, '-Muster', '^Gate ', '-Minuten', '1')
        $job | Wait-Job | Remove-Job
        $r.Exit | Should Be 0
        $r.Out | Should Match 'Gate rot\.'
        $r.Sekunden | Should BeLessThan 40
    }

    It 'waits only for the time without a log (a subagent in the background)' {
        $r = Invoke-Wecker @('-Minuten', '0.05')
        $r.Exit | Should Be 3
        $r.Out | Should Match 'Zeit um'
    }

    It 'refuses more than 55 minutes: the warm cache holds one hour' {
        $r = Invoke-Wecker @('-Minuten', '70')
        $r.Exit | Should Be 2
    }
}
