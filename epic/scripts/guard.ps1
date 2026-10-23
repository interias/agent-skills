<#
.SYNOPSIS
    PreToolUse hook for /epic runs: blocks writing or forbidden shell commands in three profiles.

.DESCRIPTION
    Reads the hook input as JSON from stdin (tool_name, tool_input.command, cwd), splits the
    command of a Bash or PowerShell call into single commands and checks each one against the
    profile. Other tools are allowed without a look.

    Splitting happens here, not in a matcher pattern: segments at &&, ||, ;, |, &, newline,
    parentheses and braces; the contents of $( ... ) and Bash backticks, also inside double
    quotes, as commands of their own; quotes removed (git 'push', "git" push); prefixes before
    the command skipped (VAR=x, env, command, xargs, if/then, ...); bash -c, sh -c,
    powershell -Command, cmd /c, eval and Invoke-Expression unwrapped. For git, the global
    options -C (also several), -c, --git-dir and --work-tree are read, so subcommand and target
    directory are known; git.exe counts as git. cd/Set-Location earlier in the same command moves
    the target directory. Heredoc and here-string bodies are text, not commands - except the
    substitutions an unquoted heredoc (<<EOF) or @"..."@ expands.

    Profiles:
      epic          Skill epic, rules 1, 2, 11. Values from .claude/epic.md of the repository in
                    the target directory (old name .claude/prd.md; the main worktree's copy when
                    the target has none): main_branch, base_branch, push_remote,
                    forbidden_remotes. Defaults per references/adapter.md: push_remote origin,
                    no forbidden remotes, main_branch from
                    `git symbolic-ref refs/remotes/<push_remote>/HEAD`, else main; base_branch is
                    the main branch. base_branch: from-issue cannot be resolved in a hook - then
                    only the main branch is protected.
                    Denies: git push to a remote other than push_remote or one of
                    forbidden_remotes; git push whose target is a protected branch (refspec,
                    --all/--mirror/--branches, ':' or a pattern refspec, or no refspec while on
                    a protected branch);
                    git merge (except --abort/--quit) while on a protected branch; git pull
                    while on a protected branch, except --ff-only (no --rebase) from that
                    branch itself or without refspec; git switch and
                    git checkout in the main worktree (git dir equals common dir).
      kundschafter  Agent epic-kundschafter. A deny list of writing commands - no guarantee:
                    Bash has no real read-only mode, and a command this script does not know
                    (Start-Process, an alias from git config, an encoded command, ...) passes.
      aufraeumen    Skill epic-aufraeumen, rules 3-5. Denies git branch -D and any --force
                    (also --delete --force, -Df), git worktree remove --force/-f and forced
                    pushes; asks before git push --delete/-d and delete refspecs (:<branch>) -
                    the person's answer in the permission prompt is the consent of rule 5.

    Output (verified against https://code.claude.com/docs/en/hooks, 2026-10-22): deny or ask as
    JSON on stdout (hookSpecificOutput.permissionDecision, permissionDecisionReason) with exit 0;
    allow is exit 0 without output. Every reason names its origin (skill or agent, rule number).

    Unreadable hook input and internal errors fail closed: exit 2, reason on stderr. Exit 1 would
    be a non-blocking error, so a guard that fails open on garbage would not guard anything.
    Claude Code always sends valid JSON, so this only fires on a broken script or a changed
    input format - and then loudly instead of silently letting everything through.

    git is only called for a git command whose subcommand matters to the profile.

.PARAMETER Profile
    epic, kundschafter or aufraeumen.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\me\.claude\skills\epic\scripts\guard.ps1 -Profile epic
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('epic', 'kundschafter', 'aufraeumen')][string]$Profile
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding $false
$retry = 'Weg ändern, nicht in anderer Form wiederholen.'

function Write-Bytes($stream, [string]$text) {
    $bytes = $utf8.GetBytes($text)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
}

function Fail-Closed([string]$message) {
    Write-Bytes ([Console]::OpenStandardError()) "guard.ps1 ($Profile): $message Befehl nicht geprüft und deshalb gesperrt; den Hook melden, nicht umgehen."
    exit 2
}

function Send-Decision([string]$decision, [string]$reason) {
    $output = @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = $decision; permissionDecisionReason = $reason } }
    Write-Bytes ([Console]::OpenStandardOutput()) (ConvertTo-Json -InputObject $output -Depth 3 -Compress)
    exit 0
}

# ---------------------------------------------------------------------------------------------
# Splitting

# Index of the parenthesis that closes the one opened just before $start; -1 when none.
function Find-Close([string]$text, [int]$start, [bool]$ps) {
    $depth = 1; $quote = $null; $i = $start
    while ($i -lt $text.Length) {
        $c = $text[$i]
        if ($quote) {
            if ($c -eq $quote) { $quote = $null }
            elseif ($quote -eq '"' -and (($ps -and $c -eq '`') -or (-not $ps -and $c -eq '\'))) { $i++ }
        } elseif ($c -eq "'" -or $c -eq '"') { $quote = $c }
        elseif (($ps -and $c -eq '`') -or (-not $ps -and $c -eq '\')) { $i++ }
        elseif ($c -eq '(') { $depth++ }
        elseif ($c -eq ')') { $depth--; if ($depth -eq 0) { return $i } }
        $i++
    }
    -1
}

# Splits one command string into segments (words without quotes, plus redirect targets) and the
# texts of command substitutions, which the caller splits again.
function Split-ShellText([string]$text, [bool]$ps) {
    $st = @{
        Segments = New-Object Collections.ArrayList; Subs = New-Object Collections.ArrayList
        Words = New-Object Collections.ArrayList; Redirects = New-Object Collections.ArrayList
        Word = New-Object Text.StringBuilder; InWord = $false; Pending = $null
        Heredocs = New-Object Collections.ArrayList; Braces = 0; Quoted = $false
    }
    function Complete-Word {
        if (-not $st.InWord) { return }
        $w = $st.Word.ToString(); [void]$st.Word.Clear(); $st.InWord = $false; $st.Braces = 0
        # An unquoted heredoc delimiter (<<EOF, not <<'EOF' or <<\EOF) lets the shell expand the body.
        switch ($st.Pending) {
            'out' { [void]$st.Redirects.Add($w) }
            'in' { }
            'heredoc' { [void]$st.Heredocs.Add(@{ Delim = $w; Strip = $false; Expand = -not $st.Quoted }) }
            'heredoc-' { [void]$st.Heredocs.Add(@{ Delim = $w; Strip = $true; Expand = -not $st.Quoted }) }
            default { [void]$st.Words.Add($w) }
        }
        $st.Pending = $null; $st.Quoted = $false
    }
    function Complete-Segment {
        Complete-Word
        $st.Pending = $null
        if ($st.Words.Count -or $st.Redirects.Count) {
            [void]$st.Segments.Add([pscustomobject]@{ Words = @($st.Words); Redirects = @($st.Redirects) })
        }
        $st.Words = New-Object Collections.ArrayList; $st.Redirects = New-Object Collections.ArrayList
    }
    function Add-Char([string]$c) { [void]$st.Word.Append($c); $st.InWord = $true }
    function Add-Sub([int]$from, [int]$close) {
        $end = if ($close -lt 0) { $text.Length } else { $close }
        [void]$st.Subs.Add($text.Substring($from, $end - $from))
        Add-Char '$(...)'
        if ($close -lt 0) { $text.Length } else { $close + 1 }
    }
    # Substitutions in a body the shell expands (unquoted heredoc, @"..."@): commands, the rest text.
    function Add-BodySubs([string]$body) {
        $p = 0
        while ($p -lt $body.Length) {
            $b = $body[$p]
            if (($ps -and $b -eq '`') -or (-not $ps -and $b -eq '\')) { $p += 2; continue }
            if ($b -eq '$' -and $p + 1 -lt $body.Length -and $body[$p + 1] -eq '(') { $close = Find-Close $body ($p + 2) $ps }
            elseif (-not $ps -and $b -eq '`') { $close = $body.IndexOf('`', $p + 1) }
            else { $p++; continue }
            $from = if ($b -eq '$') { $p + 2 } else { $p + 1 }
            $end = if ($close -lt 0) { $body.Length } else { $close }
            [void]$st.Subs.Add($body.Substring($from, $end - $from))
            $p = $end + 1
        }
    }

    $quote = $null; $i = 0; $n = $text.Length
    while ($i -lt $n) {
        $c = $text[$i]
        $next = if ($i + 1 -lt $n) { $text[$i + 1] } else { [char]0 }
        if ($quote -eq "'") {
            if ($c -eq "'") {
                if ($ps -and $next -eq "'") { Add-Char "'"; $i += 2; continue }
                $quote = $null
            } else { Add-Char $c }
            $i++; continue
        }
        if ($quote -eq '"') {
            if ($c -eq '"') {
                if ($ps -and $next -eq '"') { Add-Char '"'; $i += 2; continue }
                $quote = $null; $i++; continue
            }
            # Bash keeps a backslash in double quotes unless it escapes $ ` " \ - C:\Users stays intact.
            if ($i + 1 -lt $n -and (($ps -and $c -eq '`') -or (-not $ps -and $c -eq '\' -and '$`"\'.IndexOf($next) -ge 0))) { Add-Char $next; $i += 2; continue }
            if ($c -eq '$' -and $next -eq '(') { $i = Add-Sub ($i + 2) (Find-Close $text ($i + 2) $ps); continue }
            if (-not $ps -and $c -eq '`') { $close = $text.IndexOf('`', $i + 1); $i = Add-Sub ($i + 1) $close; continue }
            Add-Char $c; $i++; continue
        }
        # PowerShell here-string: the body is one word, never a command; @"..."@ still expands $( ).
        if ($ps -and $c -eq '@' -and ($next -eq "'" -or $next -eq '"') -and -not $st.InWord) {
            $m = [regex]::Match($text.Substring($i), '^@([''"])[ \t]*\r?\n([\s\S]*?)\r?\n\1@')
            if ($m.Success) {
                if ($next -eq '"') { Add-BodySubs $m.Groups[2].Value }
                Add-Char $m.Groups[2].Value; $i += $m.Length; continue
            }
        }
        if ($c -eq "'" -or $c -eq '"') { $quote = $c; $st.InWord = $true; $st.Quoted = $true; $i++; continue }
        if (($ps -and $c -eq '`') -or (-not $ps -and $c -eq '\')) {
            if ($next -eq "`n") { $i += 2; continue }
            if ($next -eq "`r") { $i += 3; continue }
            if ($i + 1 -lt $n) { Add-Char $next; $st.Quoted = $true }
            $i += 2; continue
        }
        if ($c -eq '$' -and $next -eq '(') { $i = Add-Sub ($i + 2) (Find-Close $text ($i + 2) $ps); continue }
        if (-not $ps -and $c -eq '`') { $close = $text.IndexOf('`', $i + 1); $i = Add-Sub ($i + 1) $close; continue }
        if ($c -eq '#' -and -not $st.InWord) {
            while ($i -lt $n -and $text[$i] -ne "`n") { $i++ }
            continue
        }
        if ($c -eq "`n") {
            Complete-Segment
            foreach ($h in $st.Heredocs) {
                # Skip the body up to the line that holds only the delimiter.
                while ($i -lt $n) {
                    $lineEnd = $text.IndexOf("`n", $i + 1); if ($lineEnd -lt 0) { $lineEnd = $n }
                    $line = $text.Substring($i + 1, [Math]::Max(0, $lineEnd - $i - 1)).TrimEnd("`r")
                    if ($h.Strip) { $line = $line.TrimStart("`t") }
                    $i = $lineEnd
                    if ($line -eq $h.Delim) { break }
                    if ($h.Expand) { Add-BodySubs $line }
                }
            }
            $st.Heredocs.Clear()
            $i++; continue
        }
        if (';|&()'.IndexOf($c) -ge 0) { Complete-Segment; $i++; continue }
        if ($c -eq '{') {
            if ($st.InWord) { $st.Braces++; Add-Char $c } else { Complete-Segment }
            $i++; continue
        }
        if ($c -eq '}') {
            if ($st.Braces -gt 0) { $st.Braces--; Add-Char $c } else { Complete-Segment }
            $i++; continue
        }
        if ($c -eq '>' -or $c -eq '<') {
            # 2>, *> and the like: the digits are the stream, not a word of the command.
            if ($st.InWord -and -not $st.Pending -and $st.Word.ToString() -match '^[0-9*]+$') { [void]$st.Word.Clear(); $st.InWord = $false }
            else { Complete-Word }
            if ($c -eq '<') {
                if ($next -eq '<') {
                    if ($i + 2 -lt $n -and $text[$i + 2] -eq '<') { $st.Pending = 'in'; $i += 3; continue }
                    if ($i + 2 -lt $n -and $text[$i + 2] -eq '-') { $st.Pending = 'heredoc-'; $i += 3; continue }
                    $st.Pending = 'heredoc'; $i += 2; continue
                }
                if ($next -eq '(') { Complete-Segment; $i++; continue }
                $st.Pending = 'in'; $i++; continue
            }
            $j = $i + 1
            if ($j -lt $n -and $text[$j] -eq '>') { $j++ }
            if ($j -lt $n -and $text[$j] -eq '|') { $j++ }
            if ($j -lt $n -and $text[$j] -eq '&') {
                if ($j + 1 -lt $n -and $text[$j + 1] -match '[0-9-]') { $i = $j + 2; continue }
                $j++
            }
            if (-not $ps -and $j -lt $n -and $text[$j] -eq '(') { Complete-Segment; $i = $j; continue }
            $st.Pending = 'out'; $i = $j; continue
        }
        if ([char]::IsWhiteSpace($c)) { Complete-Word; $i++; continue }
        Add-Char $c; $i++
    }
    Complete-Segment
    [pscustomobject]@{ Segments = $st.Segments; Subs = $st.Subs }
}

function Get-Tail($array, [int]$from) {
    if ($from -ge $array.Count) { return , @() }
    , @($array[$from..($array.Count - 1)])
}

function Get-CommandName([string]$word) {
    ($word -replace '^.*[\\/]', '').ToLowerInvariant() -replace '\.(exe|cmd|bat)$', ''
}

# Index of the word that is the actual command, after env assignments and wrappers.
function Get-CommandIndex($words) {
    $i = 0
    while ($i -lt $words.Count) {
        $w = $words[$i]
        if ($w -match '^[A-Za-z_][A-Za-z0-9_]*=') { $i++; continue }
        $name = Get-CommandName $w
        if ($name -in @('env', 'command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'sudo', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', '.')) {
            $i++
            while ($i -lt $words.Count -and $words[$i].StartsWith('-')) { if ($words[$i] -in @('-u', '-n')) { $i++ }; $i++ }
            continue
        }
        if ($name -eq 'xargs') {
            $i++
            while ($i -lt $words.Count -and $words[$i].StartsWith('-')) { if ($words[$i] -in @('-I', '-n', '-L', '-P', '-d', '-E', '-s', '-a')) { $i++ }; $i++ }
            continue
        }
        break
    }
    $i
}

# All single commands of a command string, nested shells and substitutions included.
function Get-Segments([string]$text, [bool]$ps, [int]$depth = 0) {
    $result = New-Object Collections.ArrayList
    if ($depth -gt 6 -or -not $text) { return , $result }
    $split = Split-ShellText $text $ps
    foreach ($seg in $split.Segments) {
        [void]$result.Add($seg)
        $words = $seg.Words
        $k = Get-CommandIndex $words
        if ($k -ge $words.Count) { continue }
        $name = Get-CommandName $words[$k]
        $rest = @(if ($k + 1 -lt $words.Count) { $words[($k + 1)..($words.Count - 1)] })
        $inner = $null; $innerPs = $ps
        if ($name -in @('bash', 'sh', 'zsh', 'dash')) {
            for ($j = 0; $j -lt $rest.Count; $j++) {
                if ($rest[$j] -match '^-[a-z]*c[a-z]*$') { if ($j + 1 -lt $rest.Count) { $inner = $rest[$j + 1] }; break }
            }
            $innerPs = $false
        } elseif ($name -in @('powershell', 'pwsh')) {
            for ($j = 0; $j -lt $rest.Count; $j++) {
                if ($rest[$j] -match '^[-/](c|com|comm|comma|comman|command)$') { $inner = (Get-Tail $rest ($j + 1)) -join ' '; break }
                # Options with a value (-ExecutionPolicy Bypass, -WorkingDirectory x, ...): the value is no command.
                if ($rest[$j] -match '^[-/](ex[a-z]*|ep|w[a-z]*|v[a-z]*|if|inputformat|of|outputformat|configurationname|settingsfile|psconsolefile)$') { $j++; continue }
                if ($rest[$j] -notmatch '^[-/]') { $inner = (Get-Tail $rest $j) -join ' '; break }
            }
            $innerPs = $true
        } elseif ($name -eq 'cmd') {
            for ($j = 0; $j -lt $rest.Count; $j++) {
                if ($rest[$j] -match '^/[ck]$') { $inner = (Get-Tail $rest ($j + 1)) -join ' '; break }
            }
            $innerPs = $false
        } elseif ($name -in @('eval', 'iex', 'invoke-expression')) {
            $inner = $rest -join ' '
            if ($name -ne 'eval') { $innerPs = $true }
        }
        if ($inner) { foreach ($s in (Get-Segments $inner $innerPs ($depth + 1))) { [void]$result.Add($s) } }
    }
    foreach ($sub in $split.Subs) { foreach ($s in (Get-Segments $sub $ps ($depth + 1))) { [void]$result.Add($s) } }
    , $result
}

# /c/Users/x (Git Bash) -> c:/Users/x; ~ -> home.
function ConvertTo-NativePath([string]$path) {
    if ($path -match '^/([a-zA-Z])(/.*)?$') { return "$($Matches[1]):$($Matches[2])" }
    if ($path -eq '~' -or $path.StartsWith('~/') -or $path.StartsWith('~\')) { return $HOME + $path.Substring(1) }
    $path
}

function Resolve-Dir([string]$base, [string]$path) {
    $path = ConvertTo-NativePath $path
    # No valid path (cd "a|b"): git -C fails on it too, so the target is no repository.
    try { if ([IO.Path]::IsPathRooted($path)) { return $path }; [IO.Path]::Combine($base, $path) } catch { $path }
}

# Subcommand, its arguments and the options that tell git where the repository is.
function Read-GitCommand($words, [int]$start) {
    $i = $start + 1; $location = New-Object Collections.ArrayList
    while ($i -lt $words.Count) {
        $w = $words[$i]
        if ($w -ceq '-C' -and $i + 1 -lt $words.Count) { [void]$location.Add('-C'); [void]$location.Add((ConvertTo-NativePath $words[$i + 1])); $i += 2; continue }
        if ($w -match '^--(git-dir|work-tree)=(.*)$') { [void]$location.Add("--$($Matches[1])=$(ConvertTo-NativePath $Matches[2])"); $i++; continue }
        if ($w -in @('--git-dir', '--work-tree') -and $i + 1 -lt $words.Count) { [void]$location.Add("$w=$(ConvertTo-NativePath $words[$i + 1])"); $i += 2; continue }
        if ($w -cin @('-c', '--config-env', '--namespace', '--super-prefix', '--list-cmds', '--attr-source')) { $i += 2; continue }
        if ($w.StartsWith('-')) { $i++; continue }
        break
    }
    if ($i -ge $words.Count) { return $null }
    [pscustomobject]@{
        Sub = $words[$i].ToLowerInvariant()
        Args = @(if ($i + 1 -lt $words.Count) { $words[($i + 1)..($words.Count - 1)] })
        Location = @($location)
    }
}

# Short option clusters such as -Df: true when any of $letters is in it.
function Test-ShortFlag($arguments, [string]$letters) {
    foreach ($a in $arguments) {
        if ($a -cmatch '^-[a-zA-Z]+$') { foreach ($ch in $letters.ToCharArray()) { if ($a.Substring(1).IndexOf($ch) -ge 0) { return $true } } }
    }
    $false
}

# ---------------------------------------------------------------------------------------------
# Repository state (epic profile only)

$script:repoCache = @{}
$script:adapterCache = @{}

function Invoke-GitQuery([string]$dir, $location, [string[]]$query) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $out = & git -C $dir @location @query 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        , @($out)
    } finally { $ErrorActionPreference = $eap }
}

function Get-RepoInfo([string]$dir, $location) {
    $key = "$dir|$($location -join '|')"
    if ($script:repoCache.ContainsKey($key)) { return $script:repoCache[$key] }
    $info = $null
    $paths = Invoke-GitQuery $dir $location @('rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir')
    if ($paths -and $paths.Count -ge 3) {
        $branch = Invoke-GitQuery $dir $location @('symbolic-ref', '--short', '-q', 'HEAD')
        $gitDir = [IO.Path]::GetFullPath($paths[1]).TrimEnd('\', '/')
        $common = [IO.Path]::GetFullPath($paths[2]).TrimEnd('\', '/')
        $info = [pscustomobject]@{
            Top = $paths[0]; Common = $common
            Branch = if ($branch) { [string]$branch[0] } else { '' }
            IsMain = $gitDir -eq $common
        }
    }
    $script:repoCache[$key] = $info
    $info
}

# Simple YAML front matter: key: value and key: [a, b]. Indented lines (test_commands) are skipped.
function Read-AdapterFile([string]$path) {
    $values = @{}
    $lines = [IO.File]::ReadAllLines($path)
    if ($lines.Count -eq 0 -or $lines[0].Trim() -ne '---') { return $values }
    for ($k = 1; $k -lt $lines.Count; $k++) {
        $line = $lines[$k]
        if ($line.Trim() -eq '---') { break }
        if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$') { continue }
        $name = $Matches[1]; $value = ($Matches[2] -replace '\s+#.*$', '').Trim()
        if ($value -match '^\[(.*)\]$') {
            $values[$name] = @($Matches[1] -split ',' | ForEach-Object { $_.Trim().Trim('"', "'") } | Where-Object { $_ })
        } else { $values[$name] = $value.Trim('"', "'") }
    }
    $values
}

function Get-Adapter($info, $dir, $location) {
    if ($script:adapterCache.ContainsKey($info.Top)) { return $script:adapterCache[$info.Top] }
    $values = @{}
    $mainTop = Split-Path -Parent $info.Common
    foreach ($candidate in @("$($info.Top)/.claude/epic.md", "$($info.Top)/.claude/prd.md", "$mainTop/.claude/epic.md", "$mainTop/.claude/prd.md")) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $values = Read-AdapterFile $candidate; break }
    }
    $pushRemote = if ($values['push_remote']) { [string]$values['push_remote'] } else { 'origin' }
    $forbidden = @($values['forbidden_remotes'] | Where-Object { $_ -and $_ -notin @('keine', 'none', '-') })
    $main = [string]$values['main_branch']
    if (-not $main) {
        $head = Invoke-GitQuery $dir $location @('symbolic-ref', '--short', "refs/remotes/$pushRemote/HEAD")
        $main = if ($head) { ([string]$head[0]) -replace "^$([regex]::Escape($pushRemote))/", '' } else { 'main' }
    }
    $protected = @($main)
    $base = [string]$values['base_branch']
    if ($base -and $base -ne 'from-issue' -and $base -ne $main) { $protected += $base }
    $adapter = [pscustomobject]@{ PushRemote = $pushRemote; Forbidden = $forbidden; Protected = $protected }
    $script:adapterCache[$info.Top] = $adapter
    $adapter
}

function Get-PushRemote($info, $dir, $location, $adapter) {
    if ($info.Branch) {
        foreach ($key in @("branch.$($info.Branch).pushRemote", 'remote.pushDefault', "branch.$($info.Branch).remote")) {
            $value = Invoke-GitQuery $dir $location @('config', '--get', $key)
            if ($value) { return [string]$value[0] }
        }
    }
    $adapter.PushRemote
}

# ---------------------------------------------------------------------------------------------
# Profiles. Each check returns $null (allowed) or @{ Decision; Reason }.

function New-Verdict([string]$decision, [string]$reason) { @{ Decision = $decision; Reason = $reason } }

function Test-Epic($seg, $git, [string]$dir, [string]$shown) {
    if (-not $git -or $git.Sub -notin @('push', 'merge', 'pull', 'switch', 'checkout')) { return $null }
    $info = Get-RepoInfo $dir $git.Location
    if (-not $info) { return $null }
    $rule1 = 'Skill epic, Regel 1: Der Lauf mergt und pusht nie in den Hauptzweig und nie in <basis>'
    if ($git.Sub -in @('switch', 'checkout')) {
        if (-not $info.IsMain) { return $null }
        return New-Verdict 'deny' "Gesperrt durch Hook (Skill epic, Regel 11: Das Hauptverzeichnis wird nie umgeschaltet): '$shown' liefe im Hauptverzeichnis $($info.Top). Im Worktree arbeiten (worktree.ps1). $retry"
    }
    $adapter = Get-Adapter $info $dir $git.Location
    $protectedText = "'" + ($adapter.Protected -join "', '") + "'"
    if ($git.Sub -eq 'merge') {
        if ($git.Args | Where-Object { $_ -in @('--abort', '--quit') }) { return $null }
        if ($info.Branch -and $adapter.Protected -contains $info.Branch) {
            return New-Verdict 'deny' "Gesperrt durch Hook ($rule1): '$shown' mergt in '$($info.Branch)' ($($info.Top)). Gemergt wird nur in den Epic-Branch im Epic-Worktree. $retry"
        }
        return $null
    }
    if ($git.Sub -eq 'pull') {
        if (-not ($info.Branch -and $adapter.Protected -contains $info.Branch)) { return $null }
        # Only a fast-forward of the protected branch from its own counterpart passes
        # (epic-aufraeumen phase 1 in the main worktree); anything else merges into it.
        $ffOnly = $false; $rebase = $false; $pullArgs = New-Object Collections.ArrayList
        for ($k = 0; $k -lt $git.Args.Count; $k++) {
            $a = $git.Args[$k]
            if ($a -eq '--ff-only') { $ffOnly = $true; continue }
            if ($a -ceq '-r' -or $a -eq '--rebase' -or ($a -like '--rebase=*' -and $a -ne '--rebase=false')) { $rebase = $true; continue }
            if ($a -cin @('-s', '-X', '-o', '-j', '--strategy', '--strategy-option', '--server-option', '--jobs', '--depth', '--deepen', '--shallow-since', '--shallow-exclude', '--upload-pack', '--negotiation-tip')) { $k++; continue }
            if ($a.StartsWith('-')) { continue }
            [void]$pullArgs.Add($a)
        }
        $refspecs = Get-Tail $pullArgs 1
        $sources = @($refspecs | ForEach-Object { (($_.TrimStart('+') -split ':')[0]) -replace '^refs/heads/', '' })
        $ownBranch = -not ($sources | Where-Object { $_ -ne $info.Branch })
        if ($ffOnly -and -not $rebase -and $ownBranch) { return $null }
        return New-Verdict 'deny' "Gesperrt durch Hook ($rule1): '$shown' holt Fremdes in '$($info.Branch)' ($($info.Top)). Erlaubt ist dort nur 'git pull --ff-only' aus '$($info.Branch)' selbst. $retry"
    }

    # push
    $remote = $null; $all = $false; $positional = New-Object Collections.ArrayList
    for ($k = 0; $k -lt $git.Args.Count; $k++) {
        $a = $git.Args[$k]
        if ($a -eq '--') { for ($m = $k + 1; $m -lt $git.Args.Count; $m++) { [void]$positional.Add($git.Args[$m]) }; break }
        if ($a -match '^--repo=(.+)$') { $remote = $Matches[1]; continue }
        if ($a -eq '--repo') { $k++; if ($k -lt $git.Args.Count) { $remote = $git.Args[$k] }; continue }
        if ($a -in @('-o', '--push-option', '--receive-pack', '--exec')) { $k++; continue }
        if ($a -in @('--all', '--mirror', '--branches')) { $all = $true; continue }
        if ($a.StartsWith('-')) { continue }
        [void]$positional.Add($a)
    }
    if (-not $remote -and $positional.Count) { $remote = $positional[0]; $positional.RemoveAt(0) }
    elseif ($remote -eq $null) { $remote = Get-PushRemote $info $dir $git.Location $adapter }
    # ':' pushes all matching branches, a pattern (refs/heads/*) all branches it matches.
    if ($positional | Where-Object { $_.TrimStart('+') -eq ':' -or $_.Contains('*') }) { $all = $true }
    if ($adapter.Forbidden -contains $remote -or $remote -ne $adapter.PushRemote) {
        return New-Verdict 'deny' "Gesperrt durch Hook (Skill epic, Regel 2: Gepusht wird nur nach push_remote '$($adapter.PushRemote)', nie auf eines der forbidden_remotes): '$shown' zielt auf '$remote'. $retry"
    }
    if ($all) {
        return New-Verdict 'deny' "Gesperrt durch Hook ($rule1): '$shown' pusht alle Branches, auch $protectedText. Nur den Epic- oder Paket-Branch pushen. $retry"
    }
    $targets = @()
    if ($positional.Count -eq 0) { $targets = @($info.Branch) }
    foreach ($spec in $positional) {
        $s = $spec.TrimStart('+')
        $dst = if ($s.Contains(':')) { $s.Substring($s.LastIndexOf(':') + 1) } else { $s }
        if ($dst -in @('HEAD', '@')) { $dst = $info.Branch }
        $targets += ($dst -replace '^refs/heads/', '')
    }
    foreach ($t in $targets) {
        if ($t -and $adapter.Protected -contains $t) {
            return New-Verdict 'deny' "Gesperrt durch Hook ($rule1): '$shown' pusht auf '$t'. Der Lauf endet mit einem Pull Request, den ein Mensch mergt. $retry"
        }
    }
    $null
}

$nullSinks = @('/dev/null', '$null', 'nul', '/dev/stdout', '/dev/stderr')
$writingCommands = @(
    'rm', 'rmdir', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'ln', 'dd', 'truncate',
    'del', 'erase', 'rd', 'ri', 'move', 'mi', 'copy', 'cpi', 'ni', 'md', 'sc', 'ac', 'rni', 'ren', 'clc',
    'set-content', 'add-content', 'clear-content', 'out-file', 'tee-object', 'new-item', 'remove-item',
    'move-item', 'copy-item', 'rename-item', 'set-item')
$writingGit = @('commit', 'push', 'merge', 'reset', 'checkout', 'switch', 'rebase', 'cherry-pick', 'revert',
    'apply', 'am', 'clean', 'restore', 'rm', 'mv', 'pull', 'update-ref')

function Test-Kundschafter($seg, $git, [string]$name, $rest, [string]$shown) {
    $origin = 'Gesperrt durch Hook (Agent epic-kundschafter: ändert nichts)'
    $deny = { param($what) New-Verdict 'deny' "${origin}: '$shown' $what. Nur lesende Befehle; was zu ändern wäre, gehört in den Bericht. $retry" }
    foreach ($target in $seg.Redirects) {
        if ($nullSinks -notcontains $target.ToLowerInvariant()) { return & $deny "schreibt per Umleitung in '$target'" }
    }
    if ($git) {
        $a = $git.Args
        if ($git.Sub -in $writingGit) { return & $deny "ist ein schreibender git-Befehl ($($git.Sub))" }
        if ($git.Sub -eq 'stash' -and -not ($a.Count -and $a[0] -in @('list', 'show'))) { return & $deny 'ändert den Stash' }
        $listMode = [bool]($a | Where-Object { $_ -in @('-l', '--list') })
        if ($git.Sub -eq 'tag' -and ((-not $listMode -and ($a | Where-Object { $_ -notmatch '^-' })) -or (Test-ShortFlag $a 'dafsmFu') -or ($a | Where-Object { $_ -match '^--(delete|annotate|sign|force|message|file)' }))) {
            return & $deny 'legt einen Tag an oder löscht ihn'
        }
        if ($git.Sub -eq 'worktree' -and $a.Count -and $a[0] -in @('add', 'remove', 'prune', 'move', 'lock', 'unlock', 'repair')) { return & $deny "ändert Worktrees ($($a[0]))" }
        if ($git.Sub -eq 'branch') {
            if ((Test-ShortFlag $a 'dDmMcCfu') -or ($a | Where-Object { $_ -match '^--(delete|move|copy|force|set-upstream|unset-upstream|edit-description)' })) { return & $deny 'ändert Branches' }
            $valueOpts = @('--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort', '--format', '--column')
            for ($k = 0; $k -lt $a.Count; $k++) {
                if ($a[$k] -in $valueOpts) { $k++; continue }
                if (-not $a[$k].StartsWith('-') -and -not $listMode) { return & $deny "legt den Branch '$($a[$k])' an" }
            }
        }
        return $null
    }
    if ($name -in $writingCommands) { return & $deny 'ändert Dateien' }
    if ($name -eq 'sed' -and ($rest | Where-Object { $_ -cmatch '^-[a-zA-Z]*i' -or $_ -like '--in-place*' })) { return & $deny 'ändert Dateien (sed -i)' }
    if ($name -eq 'perl' -and ($rest | Where-Object { $_ -cmatch '^-[a-zA-Z]*i' })) { return & $deny 'ändert Dateien (perl -i)' }
    if ($name -eq 'find' -and ($rest | Where-Object { $_ -in @('-delete', '-exec', '-execdir', '-ok', '-okdir') })) { return & $deny 'führt aus der Suche heraus Befehle aus oder löscht' }
    if ($name -eq 'curl') {
        for ($k = 0; $k -lt $rest.Count; $k++) {
            $a = $rest[$k]
            $value = if ($k + 1 -lt $rest.Count) { $rest[$k + 1] } else { '' }
            if ($a -match '^--request=(.*)$') { $value = $Matches[1]; $a = '--request' }
            if ($a -eq '--request' -and $value.ToUpperInvariant() -notin @('GET', 'HEAD')) { return & $deny "sendet $value" }
            if ($a -match '^--(data|json|form|upload-file|remote-name)' ) { return & $deny 'sendet Daten oder schreibt eine Datei' }
            if ($a -match '^--output(=(.*))?$') {
                $target = if ($Matches[2]) { $Matches[2] } else { $value }
                if ($nullSinks -notcontains $target.ToLowerInvariant()) { return & $deny "schreibt nach '$target'" }
            }
            if ($a -cmatch '^-[a-zA-Z]+') {
                $letters = $a.Substring(1)
                for ($p = 0; $p -lt $letters.Length; $p++) {
                    $ch = $letters[$p]
                    $attached = $letters.Substring($p + 1)
                    $arg = if ($attached) { $attached } else { $value }
                    if ($ch -ceq 'X') { if ($arg.ToUpperInvariant() -notin @('GET', 'HEAD')) { return & $deny "sendet $arg" }; break }
                    if ('dFT'.IndexOf($ch) -ge 0 -or $ch -ceq 'O') { return & $deny 'sendet Daten oder schreibt eine Datei' }
                    if ($ch -ceq 'o') { if ($nullSinks -notcontains $arg.ToLowerInvariant()) { return & $deny "schreibt nach '$arg'" }; break }
                    if ('HAeubrwEKmY'.IndexOf($ch) -ge 0) { break }
                }
            }
        }
    }
    if ($name -in @('invoke-webrequest', 'invoke-restmethod', 'iwr', 'irm')) {
        for ($k = 0; $k -lt $rest.Count; $k++) {
            if ($rest[$k] -match '^-(method|m)$' -and $k + 1 -lt $rest.Count -and $rest[$k + 1].ToUpperInvariant() -notin @('GET', 'HEAD')) { return & $deny "sendet $($rest[$k + 1])" }
            if ($rest[$k] -match '^-(body|infile|outfile|form)$') { return & $deny 'sendet Daten oder schreibt eine Datei' }
        }
    }
    $null
}

function Test-Aufraeumen($seg, $git, [string]$shown) {
    if (-not $git) { return $null }
    $a = $git.Args
    $rule3 = 'Gesperrt durch Hook (Skill epic-aufraeumen, Regel 3: Kein git branch -D, kein --force)'
    if ($git.Sub -eq 'branch') {
        if ((Test-ShortFlag $a 'Df') -or ($a | Where-Object { $_ -eq '--force' })) {
            return New-Verdict 'deny' "${rule3}: '$shown'. Mit 'git branch -d' löschen; verweigert Git, den Branch melden und stehen lassen. $retry"
        }
    }
    if ($git.Sub -eq 'worktree' -and $a.Count -and $a[0] -eq 'remove') {
        if ((Test-ShortFlag $a 'f') -or ($a | Where-Object { $_ -eq '--force' })) {
            return New-Verdict 'deny' "Gesperrt durch Hook (Skill epic-aufraeumen, Regel 3 und 4: kein --force; Ein schmutziger Worktree wird nicht entfernt): '$shown'. Ohne --force über worktree.ps1 -Action Down; bleibt Arbeit liegen, den Worktree melden. $retry"
        }
    }
    if ($git.Sub -eq 'push') {
        $refspecs = @($a | Where-Object { -not $_.StartsWith('-') })
        if ((Test-ShortFlag $a 'f') -or ($a | Where-Object { $_ -like '--force*' }) -or ($refspecs | Where-Object { $_.StartsWith('+') })) {
            return New-Verdict 'deny' "${rule3}: '$shown' pusht mit Gewalt. $retry"
        }
        if ((Test-ShortFlag $a 'd') -or ($a | Where-Object { $_ -eq '--delete' }) -or ($refspecs | Where-Object { $_.StartsWith(':') })) {
            return New-Verdict 'ask' "Zustimmung nötig (Skill epic-aufraeumen, Regel 5: Remote-Branches nur nach ausdrücklicher Zustimmung): '$shown' löscht einen Branch auf dem Remote. Erlauben nur, wenn der Branch nachweislich im Basiszweig liegt."
        }
    }
    $null
}

# ---------------------------------------------------------------------------------------------
# Main

try {
    $raw = (New-Object IO.StreamReader([Console]::OpenStandardInput(), $utf8)).ReadToEnd()
} catch { Fail-Closed "Hook-Eingabe nicht lesbar: $($_.Exception.Message)." }
try {
    $hookInput = $raw | ConvertFrom-Json
} catch { Fail-Closed 'Hook-Eingabe ist kein JSON.' }
if (-not $hookInput -or -not $hookInput.tool_name) { Fail-Closed 'Hook-Eingabe ohne tool_name.' }

try {
    $tool = [string]$hookInput.tool_name
    if ($tool -notin @('Bash', 'PowerShell')) { exit 0 }
    $command = [string]$hookInput.tool_input.command
    if (-not $command.Trim()) { exit 0 }
    $dir = if ($hookInput.cwd) { [string]$hookInput.cwd } else { (Get-Location).Path }

    $verdicts = New-Object Collections.ArrayList
    foreach ($seg in (Get-Segments $command ($tool -eq 'PowerShell'))) {
        $words = $seg.Words
        $k = Get-CommandIndex $words
        $name = if ($k -lt $words.Count) { Get-CommandName $words[$k] } else { '' }
        $rest = @(if ($k + 1 -lt $words.Count) { $words[($k + 1)..($words.Count - 1)] })
        $shown = ($words -join ' ')
        if ($shown.Length -gt 160) { $shown = $shown.Substring(0, 160) + ' ...' }

        if ($name -in @('cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location')) {
            $target = $rest | Where-Object { $_ -notmatch '^-' } | Select-Object -First 1
            if ($target) { $dir = Resolve-Dir $dir $target }
            continue
        }
        $git = if ($name -eq 'git') { Read-GitCommand $words $k } else { $null }
        $verdict = switch ($Profile) {
            'epic' { Test-Epic $seg $git $dir $shown }
            'kundschafter' { Test-Kundschafter $seg $git $name $rest $shown }
            'aufraeumen' { Test-Aufraeumen $seg $git $shown }
        }
        if ($verdict) {
            if ($verdict.Decision -eq 'deny') { Send-Decision 'deny' $verdict.Reason }
            [void]$verdicts.Add($verdict)
        }
    }
    if ($verdicts.Count) { Send-Decision 'ask' (($verdicts | ForEach-Object { $_.Reason }) -join ' ') }
    exit 0
} catch {
    Fail-Closed "Interner Fehler: $($_.Exception.Message) (Zeile $($_.InvocationInfo.ScriptLineNumber))."
}
