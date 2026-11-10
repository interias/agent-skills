# Starts Claude Code with the second account ("Arbeitspferd").
# Skills, agents, output styles and plugins are junctions to ~/.claude, CLAUDE.md imports the main one.
# With -AuftragDatei, claude starts right away in the current folder with that file's text as first prompt;
# with -Resume <session id> as well, that session continues and the text is its next message.
param([string]$AuftragDatei, [string]$Resume, [string[]]$AddDir)

# Drop variables inherited from a parent Claude session (e.g. when launched from Claude Desktop)
Get-ChildItem Env: | Where-Object Name -match '^CLAUDE' | ForEach-Object { Remove-Item "Env:$($_.Name)" }
# Claude Desktop's tool shell sets NO_COLOR=1; inherited, it turns every colour in the window off
Remove-Item Env:NO_COLOR, Env:FORCE_COLOR -ErrorAction SilentlyContinue
$env:COLORTERM = 'truecolor'
$env:CLAUDE_CONFIG_DIR = "$HOME\.claude-arbeitspferd"
$Host.UI.RawUI.WindowTitle = 'Claude Arbeitspferd'

Write-Host 'Claude Arbeitspferd (zweites Konto)' -ForegroundColor DarkYellow
Write-Host "Konfig: $env:CLAUDE_CONFIG_DIR" -ForegroundColor DarkGray

if ($AuftragDatei) {
    $Host.UI.RawUI.WindowTitle = "Claude Arbeitspferd - $(Split-Path -Leaf (Get-Location))"
    $extra = @(foreach ($d in ($AddDir -split ',' | Where-Object { $_ })) { '--add-dir', $d })
    if ($Resume) { $extra += '--resume', $Resume }
    claude @extra (Get-Content -Raw $AuftragDatei)
} else {
    Set-Location "$HOME\git"
    Write-Host "Projekt waehlen: cd <projekt>; dann 'claude' starten, z. B. mit /epic-flotte" -ForegroundColor DarkGray
    Write-Host ''
}
