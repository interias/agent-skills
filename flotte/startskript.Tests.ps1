# Pester 3.4 (Windows PowerShell 5.1) and pwsh 7: Invoke-Pester .\flotte\startskript.Tests.ps1
# The start script `flotte projekt hinzufuegen` writes (#126): bun writes it for a Git repository in $TestDrive
# into a home folder in $TestDrive, the real ~/.claude stays untouched. The script must parse without error
# and, run with a stand-in `bun` (a global function wins over the program), call `fahren` in the project folder.

$wurzel = $PSScriptRoot

Describe 'flotte projekt hinzufuegen: the start script' {
    # a folder name with a space and a quote: the script has to quote it
    $ordner = Join-Path $TestDrive "mein pro'jekt"
    $heim = Join-Path $TestDrive 'heim'
    New-Item -ItemType Directory -Path $ordner, $heim | Out-Null
    git -C $ordner init -q
    $gen = Join-Path $TestDrive 'gen.ts'
    $src = (Join-Path $wurzel 'src') -replace '\\', '/'
    $ts = "import { aufrufen } from '$src/aufruf.ts';`n" +
        "import { hinzufuegen } from '$src/befehle/projekt.ts';`n" +
        "const [ordner, heim] = process.argv.slice(2);`n" +
        "await hinzufuegen(ordner, { autostart: false, konten: ['1', '2'], bruecke: 'http://127.0.0.1:4747' }, { aufrufer: aufrufen, heim, kontenDatei: heim + '/konten.json' });`n"
    [IO.File]::WriteAllText($gen, $ts)
    & (Get-Command bun -CommandType Application | Select-Object -First 1).Source $gen $ordner $heim
    $skript = Join-Path $heim '.claude\flotte\start\mein-pro-jekt.ps1'

    It 'is written under ~/.claude/flotte/start, named after the folder' {
        Test-Path -LiteralPath $skript | Should Be $true
    }

    It 'parses without error' {
        $fehler = $null
        [void][Management.Automation.Language.Parser]::ParseFile($skript, [ref]$null, [ref]$fehler)
        @($fehler).Count | Should Be 0
    }

    It 'calls fahren with a stand-in bun in the project folder' {
        $global:sAufruf = $null
        function global:bun { $global:sAufruf = @{ Ort = (Get-Location).ProviderPath; Args = @($args) } }
        try {
            if ((Get-Command bun).CommandType -ne 'Function') { throw 'Attrappe bun fehlt' }
            Push-Location $TestDrive
            try { & $skript } finally { Pop-Location }
        } finally {
            Remove-Item Function:\bun -ErrorAction SilentlyContinue
        }
        $global:sAufruf | Should Not BeNullOrEmpty
        $global:sAufruf.Ort | Should Be (Get-Item -LiteralPath $ordner).FullName
        $global:sAufruf.Args[0] | Should Be "$HOME\.claude\skills\flotte\src\cli.ts"
        ($global:sAufruf.Args[1..($global:sAufruf.Args.Count - 1)] -join ' ') | Should Be 'fahren --konten 1,2 --dauerhaft --bruecke http://127.0.0.1:4747'
    }
}
