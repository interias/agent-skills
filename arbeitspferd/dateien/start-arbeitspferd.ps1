# Starts Claude Code with the account whose config folder holds this script (~/.claude-arbeitspferd for
# the second account, ~/.claude-arbeitspferd-<n> for further ones); -Titel is the profile name.
# Skills, agents, output styles and plugins are junctions to ~/.claude, CLAUDE.md imports the main one.
# With -AuftragDatei, claude starts right away in the current folder with that file's text as first prompt;
# with -Resume <session id> as well, that session continues and the text is its next message.
param([string]$AuftragDatei, [string]$Resume, [string[]]$AddDir, [string]$Titel = 'Claude Arbeitspferd')

# Drop variables inherited from a parent Claude session (e.g. when launched from Claude Desktop)
Get-ChildItem Env: | Where-Object Name -match '^CLAUDE' | ForEach-Object { Remove-Item "Env:$($_.Name)" }
# Claude Desktop's tool shell sets NO_COLOR=1; inherited, it turns every colour in the window off
Remove-Item Env:NO_COLOR, Env:FORCE_COLOR -ErrorAction SilentlyContinue
$env:COLORTERM = 'truecolor'
# The account is the folder this script lies in. The main account (~/.claude, copied as start-claude.ps1)
# runs without CLAUDE_CONFIG_DIR, exactly like a plain `claude`.
if ($PSScriptRoot -ne "$HOME\.claude") { $env:CLAUDE_CONFIG_DIR = $PSScriptRoot }
$Host.UI.RawUI.WindowTitle = $Titel

Write-Host $Titel -ForegroundColor DarkYellow
Write-Host "Konfig: $PSScriptRoot" -ForegroundColor DarkGray

if ($AuftragDatei) {
    $Host.UI.RawUI.WindowTitle = "$Titel - $(Split-Path -Leaf (Get-Location))"
    $extra = @(foreach ($d in ($AddDir -split ',' | Where-Object { $_ })) { '--add-dir', $d })
    if ($Resume) { $extra += '--resume', $Resume }
    # `--add-dir` takes any number of values: without `--`, the prompt became one more directory and the
    # session started empty (19.11.2026, #246 and the backup fix).
    claude @extra -- (Get-Content -Raw $AuftragDatei)
} else {
    Set-Location "$HOME\git"
    Write-Host "Projekt waehlen: cd <projekt>; dann 'claude' starten, z. B. mit /epic" -ForegroundColor DarkGray
    Write-Host ''
}
