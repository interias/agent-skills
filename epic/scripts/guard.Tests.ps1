# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\epic\scripts\guard.Tests.ps1
# Each test hands a hook input as JSON on stdin to the script, run as a separate process the way
# Claude Code runs a hook, and reads the decision from stdout and the exit code.

$script = Join-Path $PSScriptRoot 'guard.ps1'

function New-HookInput([string]$command, [string]$cwd, [string]$tool = 'Bash') {
    ConvertTo-Json -Compress -InputObject @{ tool_name = $tool; tool_input = @{ command = $command }; cwd = $cwd; hook_event_name = 'PreToolUse' }
}

function Invoke-Guard([string]$guardProfile, [string]$command, [string]$cwd, [string]$tool = 'Bash', [string]$raw) {
    if (-not $PSBoundParameters.ContainsKey('raw')) { $raw = New-HookInput $command $cwd $tool }
    Invoke-HookProcess 'powershell.exe' "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Profile $guardProfile" $raw
}

function Invoke-HookProcess([string]$file, [string]$arguments, [string]$raw, [hashtable]$environment = @{}) {
    $info = New-Object Diagnostics.ProcessStartInfo $file
    $info.Arguments = $arguments
    foreach ($name in $environment.Keys) { $info.EnvironmentVariables[$name] = $environment[$name] }
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = New-Object Text.UTF8Encoding $false
    $info.StandardErrorEncoding = New-Object Text.UTF8Encoding $false
    $p = [Diagnostics.Process]::Start($info)
    $bytes = (New-Object Text.UTF8Encoding $false).GetBytes($raw)
    $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $p.StandardInput.Close()
    $stdout = $p.StandardOutput.ReadToEndAsync(); $stderr = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    $decision = 'allow'; $reason = ''
    if ($p.ExitCode -eq 2) { $decision = 'exit2'; $reason = $stderr.Result }
    elseif ($stdout.Result.Trim()) {
        $out = ($stdout.Result | ConvertFrom-Json).hookSpecificOutput
        $out.hookEventName | Should Be 'PreToolUse'
        $decision = $out.permissionDecision; $reason = $out.permissionDecisionReason
    }
    @{ Exit = $p.ExitCode; Decision = $decision; Reason = $reason }
}

function New-TestRepo([string]$adapter) {
    $root = Join-Path $TestDrive ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $repo = Join-Path $root 'repo'
    New-Item -ItemType Directory -Path $repo -Force | Out-Null
    Set-Content -Path (Join-Path $repo 'a.txt') -Value 'a'
    if ($adapter) {
        New-Item -ItemType Directory -Path (Join-Path $repo '.claude') | Out-Null
        [IO.File]::WriteAllText((Join-Path $repo '.claude\epic.md'), $adapter)
    }
    git -C $repo init -q -b main
    git -C $repo -c core.autocrlf=false add .
    git -C $repo -c user.name=t -c user.email=t@t commit -q -m init
    git -C $repo remote add origin https://example.invalid/origin.git
    git -C $repo remote add github https://example.invalid/github.git
    git -C $repo branch agent/31-p1 main
    $worktree = Join-Path $root 'wt\epic-31'
    git -C $repo worktree add -q $worktree -b epic/31-guard main 2>$null
    @{ Root = $root; Repo = $repo; Worktree = $worktree }
}

$adapterText = "---`npush_remote: origin`nforbidden_remotes: [github]`nmain_branch: main`ntest_commands:`n  guard: x`n---`n`n# Adapter`n"

function Assert-Decision($t, [string]$guardProfile, [string]$expected, [string[]]$commands, [string]$cwd, [string]$tool = 'Bash') {
    foreach ($c in $commands) {
        $r = Invoke-Guard $guardProfile $c $cwd $tool
        "$c -> $($r.Decision)" | Should Be "$c -> $expected"
    }
}

Describe 'guard.ps1 epic: rule 2 (push_remote, forbidden_remotes)' {
    $t = New-TestRepo $adapterText

    It 'denies a push to a forbidden remote and names the rule' {
        $r = Invoke-Guard 'epic' 'git push github epic/31-guard' $t.Worktree
        $r.Exit | Should Be 0
        $r.Decision | Should Be 'deny'
        $r.Reason | Should Match 'Skill epic, Regel 2'
        $r.Reason | Should Match "zielt auf 'github'"
        $r.Reason | Should Match 'nicht in anderer Form wiederholen'
    }

    It 'denies a push to any remote other than push_remote' {
        Assert-Decision $t 'epic' 'deny' @('git push upstream epic/31-guard', 'git push https://example.invalid/x.git epic/31-guard', 'git push --repo=github') $t.Worktree
    }

    It 'allows a push of the epic branch to push_remote' {
        Assert-Decision $t 'epic' 'allow' @('git push -u origin epic/31-guard', 'git push origin HEAD', 'git push') $t.Worktree
    }

    It 'takes the remote from the branch config when none is given' {
        git -C $t.Worktree config branch.epic/31-guard.remote github
        Assert-Decision $t 'epic' 'deny' @('git push') $t.Worktree
        git -C $t.Worktree config --unset branch.epic/31-guard.remote
    }
}

Describe 'guard.ps1 epic: rule 1 (no merge or push into main or base)' {
    $t = New-TestRepo $adapterText

    It 'denies every push whose target is the main branch' {
        $r = Invoke-Guard 'epic' 'git push origin main' $t.Worktree
        $r.Decision | Should Be 'deny'
        $r.Reason | Should Match 'Skill epic, Regel 1'
        Assert-Decision $t 'epic' 'deny' @('git push origin HEAD:main', 'git push origin epic/31-guard:refs/heads/main',
            'git push origin +main', 'git push --all origin', 'git push origin --mirror', 'git push origin refs/heads/main',
            'git push origin :', "git push origin 'refs/heads/*:refs/heads/*'") $t.Worktree
    }

    It 'denies a push without refspec on the main branch' {
        Assert-Decision $t 'epic' 'deny' @('git push', 'git push origin', 'git push origin HEAD') $t.Repo
    }

    It 'denies a merge while on the main branch, allows it in the epic worktree' {
        $r = Invoke-Guard 'epic' 'git merge --no-ff agent/31-p1' $t.Repo
        $r.Decision | Should Be 'deny'
        $r.Reason | Should Match 'Regel 1'
        Assert-Decision $t 'epic' 'allow' @('git merge --no-ff agent/31-p1') $t.Worktree
        Assert-Decision $t 'epic' 'allow' @("git -C $($t.Worktree) merge --no-ff agent/31-p1", 'git merge --abort') $t.Repo
    }

    It 'denies a pull into the main branch unless it is a fast-forward from main itself' {
        $r = Invoke-Guard 'epic' 'git pull origin agent/31-p1' $t.Repo
        $r.Decision | Should Be 'deny'
        $r.Reason | Should Match 'Skill epic, Regel 1'
        Assert-Decision $t 'epic' 'deny' @('git pull', 'git pull --rebase', 'git pull --ff-only --rebase',
            'git pull --ff-only origin agent/31-p1', 'git pull --ff-only origin main agent/31-p1',
            "git -C $($t.Repo -replace '\\', '/') pull origin agent/31-p1") $t.Repo
        Assert-Decision $t 'epic' 'allow' @('git pull --ff-only', 'git pull --ff-only origin main',
            'git pull --ff-only origin refs/heads/main:main') $t.Repo
    }

    It 'allows any pull on a branch that is not protected' {
        Assert-Decision $t 'epic' 'allow' @('git pull origin agent/31-p1', 'git pull --rebase origin main') $t.Worktree
    }

    It 'protects base_branch from the adapter' {
        $u = New-TestRepo "---`nbase_branch: epic/31-guard`n---`n"
        Assert-Decision $u 'epic' 'deny' @('git push origin epic/31-guard', 'git merge agent/31-p1') $u.Worktree
    }

    It 'protects only the main branch for base_branch: from-issue' {
        $u = New-TestRepo "---`nbase_branch: from-issue`n---`n"
        Assert-Decision $u 'epic' 'allow' @('git push origin epic/31-guard') $u.Worktree
        Assert-Decision $u 'epic' 'deny' @('git push origin main') $u.Worktree
    }
}

Describe 'guard.ps1 epic: rule 11 (main worktree is never switched)' {
    $t = New-TestRepo $adapterText

    It 'denies switch and checkout in the main worktree' {
        $r = Invoke-Guard 'epic' 'git switch agent/31-p1' $t.Repo
        $r.Decision | Should Be 'deny'
        $r.Reason | Should Match 'Skill epic, Regel 11'
        Assert-Decision $t 'epic' 'deny' @('git checkout agent/31-p1', 'git checkout -b x', 'git switch -c x main') $t.Repo
    }

    It 'allows switch and checkout in a linked worktree' {
        Assert-Decision $t 'epic' 'allow' @('git switch -c agent/31-x', 'git checkout agent/31-p1') $t.Worktree
    }

    It 'allows switch outside a repository' {
        Assert-Decision $t 'epic' 'allow' @('git switch main') $TestDrive
    }
}

Describe 'guard.ps1 epic: adapter defaults' {
    It 'without .claude/epic.md: push_remote origin, main branch from origin/HEAD' {
        $t = New-TestRepo
        git -C $t.Repo update-ref refs/remotes/origin/trunk HEAD
        git -C $t.Repo symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/trunk
        Assert-Decision $t 'epic' 'deny' @('git push github epic/31-guard', 'git push origin trunk') $t.Worktree
        Assert-Decision $t 'epic' 'allow' @('git push origin main', 'git push origin epic/31-guard') $t.Worktree
    }

    It 'without .claude/epic.md and origin/HEAD: main branch is main, every other remote is denied' {
        $t = New-TestRepo
        Assert-Decision $t 'epic' 'deny' @('git push origin main', 'git push github epic/31-guard') $t.Worktree
        Assert-Decision $t 'epic' 'allow' @('git push origin epic/31-guard') $t.Worktree
    }
}

Describe 'guard.ps1 epic: workarounds (story 4)' {
    $t = New-TestRepo $adapterText

    # Bash paths with forward slashes: unquoted backslashes are escapes in Bash.
    $repo = $t.Repo -replace '\\', '/'
    $msys = $repo -replace '^([A-Za-z]):', '/$1'

    It 'sees through -C, quotes, prefixes and git.exe' {
        Assert-Decision $t 'epic' 'deny' @(
            "git -C $repo push github epic/31-guard",
            "git -C $msys switch agent/31-p1",
            "git -C $($t.Root -replace '\\', '/') -C repo switch agent/31-p1",
            "git -c core.pager=cat -C '$($t.Repo)' checkout agent/31-p1",
            "git --git-dir=$repo/.git --work-tree=$repo switch agent/31-p1",
            "git 'push' github epic/31-guard",
            '"git" push github epic/31-guard',
            'GIT_TRACE=0 git push github epic/31-guard',
            'env git push github epic/31-guard',
            'command git push github epic/31-guard',
            '"C:/Program Files/Git/cmd/git.exe" push github epic/31-guard'
        ) $t.Worktree
    }

    It 'sees through chained commands and substitutions' {
        Assert-Decision $t 'epic' 'deny' @(
            'git status && git push github epic/31-guard',
            'git status; git push github epic/31-guard',
            'git status || git push github epic/31-guard',
            "git status`ngit push github epic/31-guard",
            'echo $(git push github epic/31-guard)',
            'echo "result: $(git push github epic/31-guard)"',
            'echo `git push github epic/31-guard`',
            "cat <<EOF`n`$(git push github epic/31-guard)`nEOF",
            'bash -c "git push github epic/31-guard"',
            'powershell -NoProfile -ExecutionPolicy Bypass -Command "git push github epic/31-guard"',
            'git log | git push github epic/31-guard',
            "cd $repo && git switch agent/31-p1",
            "cd .. && cd .. && cd repo && git switch agent/31-p1"
        ) $t.Worktree
    }

    It 'checks the PowerShell tool too' {
        Assert-Decision $t 'epic' 'deny' @(
            '& git push github epic/31-guard',
            "git -C '$($t.Repo)' switch agent/31-p1",
            'git status; if ($?) { git push github epic/31-guard }',
            "Set-Location '$($t.Repo)'; git checkout agent/31-p1",
            'powershell -Command "git push github epic/31-guard"',
            "Write-Output @`"`n`$(git push github epic/31-guard)`n`"@"
        ) $t.Worktree 'PowerShell'
    }

    It 'does not read message text as a command' {
        Assert-Decision $t 'epic' 'allow' @(
            'git commit -m "git push github main; git switch main"',
            "git commit -F - <<'EOF'`ngit push github main`ngit switch main`nEOF`ngit status",
            "git commit -F - <<'EOF'`n`$(git push github main)`nEOF",
            'git log --grep="merge main" --oneline'
        ) $t.Repo
        Assert-Decision $t 'epic' 'allow' @("git commit -m @'`ngit push github main`n'@") $t.Repo 'PowerShell'
    }

    It 'allows unrelated commands and tools' {
        Assert-Decision $t 'epic' 'allow' @('git status', 'git log --oneline -5', 'ls -la', 'git fetch github', 'cd "a|b" && ls') $t.Repo
        (Invoke-Guard 'epic' 'git push github main' $t.Repo 'Read').Decision | Should Be 'allow'
    }
}

Describe 'guard.ps1 hook input' {
    It 'fails closed on input that is not JSON' {
        $r = Invoke-Guard 'epic' -raw 'not json'
        $r.Exit | Should Be 2
        $r.Reason | Should Match 'kein JSON'
    }

    It 'fails closed on JSON without tool_name' {
        (Invoke-Guard 'kundschafter' -raw '{"foo":1}').Exit | Should Be 2
    }

    It 'allows an empty command' {
        (Invoke-Guard 'kundschafter' '' $TestDrive).Exit | Should Be 0
    }
}

Describe 'guard.ps1 kundschafter (story 5)' {
    It 'denies writing commands and names the agent' {
        $r = Invoke-Guard 'kundschafter' 'git commit -m x' $TestDrive
        $r.Decision | Should Be 'deny'
        $r.Reason | Should Match 'Agent epic-kundschafter: ändert nichts'
        Assert-Decision $null 'kundschafter' 'deny' @(
            'git push', 'git merge x', 'git -C x reset --hard', 'git checkout main', 'git switch x',
            'git branch -d x', 'git branch -D x', 'git branch --delete x', 'git branch -m a b', 'git branch new-branch',
            'git worktree add ../x', 'git worktree remove x', 'git rebase main', 'git stash', 'git tag v1',
            'rm -rf x', 'mv a b', 'cp a b', 'mkdir x', 'touch x', 'ln -s a b', 'sed -i s/a/b/ f.txt',
            'echo x > f.txt', 'echo x >> f.txt', 'git log 1>out.txt', 'cat a | tee out.txt',
            'curl -X POST https://x/api', 'curl -XDELETE https://x/api', 'curl --request PATCH https://x/api',
            'curl -d a=b https://x/api', 'curl --data-raw x https://x/api', 'curl -F f=@a https://x/api',
            'curl -T a https://x/api', 'curl -sS -o out.json https://x/api',
            'git status && git commit -m x', 'echo $(rm -rf x)', 'powershell -Command "Remove-Item x"'
        ) $TestDrive
    }

    It 'denies writing cmdlets in PowerShell' {
        Assert-Decision $null 'kundschafter' 'deny' @(
            'Set-Content a.txt x', 'Add-Content a.txt x', 'Remove-Item x', 'Move-Item a b', 'Copy-Item a b',
            'New-Item -ItemType File x', 'Rename-Item a b', 'Get-Date | Out-File x.txt', 'Get-Date > x.txt',
            'Invoke-RestMethod -Method Post https://x/api'
        ) $TestDrive 'PowerShell'
    }

    It 'allows reading commands' {
        Assert-Decision $null 'kundschafter' 'allow' @(
            'git log --oneline', 'git diff main...HEAD', 'git status --porcelain', 'git show HEAD:a.txt',
            'git branch -a', 'git branch -vv', 'git branch --list "agent/*"', 'git branch --contains HEAD',
            'git worktree list', 'git tag -l "v*"', 'git stash list', 'grep -rn foo .', 'cat a.txt', 'sed -n 1,5p a.txt',
            'curl -s https://x/api', 'curl -s -X GET https://x/api', 'curl -s -o /dev/null -w "%{http_code}" https://x/api',
            'git log 2>/dev/null', 'git status 2>&1', 'git log >/dev/null 2>&1', 'git log > NUL'
        ) $TestDrive
        Assert-Decision $null 'kundschafter' 'allow' @('Get-ChildItem > $null', 'git log 2>$null', 'Get-Content a.txt | Select-Object -First 5') $TestDrive 'PowerShell'
    }
}

Describe 'guard.ps1 aufraeumen (story 6)' {
    It 'denies git branch -D and every forced delete' {
        $r = Invoke-Guard 'aufraeumen' 'git branch -D agent/31-p1' $TestDrive
        $r.Decision | Should Be 'deny'
        $r.Reason | Should Match 'Skill epic-aufraeumen, Regel 3'
        Assert-Decision $null 'aufraeumen' 'deny' @('git branch --delete --force x', 'git branch -Df x', 'git branch -d -f x', 'git -C repo branch -D x') $TestDrive
    }

    It 'denies git worktree remove --force' {
        $r = Invoke-Guard 'aufraeumen' 'git worktree remove --force ../wt/1' $TestDrive
        $r.Decision | Should Be 'deny'
        $r.Reason | Should Match 'Regel 3 und 4'
        Assert-Decision $null 'aufraeumen' 'deny' @('git worktree remove -f ../wt/1', 'git worktree remove ../wt/1 --force') $TestDrive
    }

    It 'asks before deleting a remote branch' {
        $r = Invoke-Guard 'aufraeumen' 'git push origin --delete epic/31-guard' $TestDrive
        $r.Exit | Should Be 0
        $r.Decision | Should Be 'ask'
        $r.Reason | Should Match 'Skill epic-aufraeumen, Regel 5'
        Assert-Decision $null 'aufraeumen' 'ask' @('git push origin -d epic/31-guard', 'git push origin :epic/31-guard', 'git status && git push origin --delete x') $TestDrive
    }

    It 'allows the safe forms' {
        Assert-Decision $null 'aufraeumen' 'allow' @('git branch -d agent/31-p1', 'git branch --delete agent/31-p1',
            'git worktree remove ../wt/1', 'git worktree prune', 'git fetch origin main:main', 'git branch -a') $TestDrive
    }
}

# The hook entries as they stand in the frontmatter of the skill and agent files. Each test runs
# the command line from the file the way Claude Code does - through Git Bash (the default shell of
# a command hook on Windows) or through PowerShell (the fallback without Git Bash) - with the path
# of the installed guard.ps1 bent to the one in this worktree.

$repoRoot = Split-Path (Split-Path $PSScriptRoot)
$installedGuard = '$HOME/.claude/skills/epic/scripts/guard.ps1'

function Get-HookEntry([string]$relativePath) {
    $text = [IO.File]::ReadAllText((Join-Path $repoRoot $relativePath))
    $frontmatter = [regex]::Match($text, '\A---\r?\n(.*?)\r?\n---\r?\n', 'Singleline').Groups[1].Value
    # Flow form on one line, to keep epic/SKILL.md short (story 2).
    $block = [regex]::Match($frontmatter, '(?m)^hooks:\r?\n  PreToolUse: (\[.*\])\r?$').Groups[1].Value
    @{
        Matcher = [regex]::Match($block, '\{matcher: "([^"]*)", hooks: \[').Groups[1].Value
        Type = [regex]::Match($block, '\{type: (\w+), ').Groups[1].Value
        Command = [regex]::Match($block, "command: '((?:[^']|'')*)'").Groups[1].Value -replace "''", "'"
        Timeout = [regex]::Match($block, ', timeout: (\d+)').Groups[1].Value
        OnFailure = [regex]::Match($block, ', onFailure: (\w+)\}').Groups[1].Value
        Entries = ([regex]::Matches($block, '\{type:')).Count
    }
}

# Git Bash, not the bash.exe of WSL that may come first on PATH.
function Find-GitBash {
    $dir = Split-Path (Get-Command git).Source
    while ($dir -and -not (Test-Path (Join-Path $dir 'bin\bash.exe'))) { $dir = Split-Path $dir }
    if ($dir) { Join-Path $dir 'bin\bash.exe' }
}

function Invoke-HookLine([string]$line, [string]$shell, [string]$raw, [hashtable]$environment = @{}) {
    $quoted = '"' + ($line -replace '"', '\"') + '"'
    if ($shell -eq 'bash') { Invoke-HookProcess (Find-GitBash) "-c $quoted" $raw $environment }
    else { Invoke-HookProcess 'powershell.exe' "-NoProfile -Command $quoted" $raw $environment }
}

function Assert-HookLine([string]$line, [string]$shell, [string]$expected, [string[]]$commands, [string]$cwd, [string]$tool = 'Bash') {
    foreach ($c in $commands) {
        $r = Invoke-HookLine $line $shell (New-HookInput $c $cwd $tool)
        "$c -> $($r.Decision)" | Should Be "$c -> $expected"
    }
}

Describe 'guard.ps1 frontmatter hooks (stories 3, 5, 6)' {
    $t = New-TestRepo $adapterText
    $worktreeGuard = $script -replace '\\', '/'

    foreach ($case in @(
            @{ File = 'epic/SKILL.md'; Profile = 'epic' },
            @{ File = 'agents/epic-kundschafter.md'; Profile = 'kundschafter' },
            @{ File = 'epic-aufraeumen/SKILL.md'; Profile = 'aufraeumen' })) {
        It "$($case.File): one PreToolUse command hook on Bash|PowerShell, profile $($case.Profile), fails closed" {
            $h = Get-HookEntry $case.File
            $h.Entries | Should Be 1
            $h.Matcher | Should Be 'Bash|PowerShell'
            $h.Type | Should Be 'command'
            $h.Command | Should Be "powershell -NoProfile -ExecutionPolicy Bypass -File `"$installedGuard`" -Profile $($case.Profile)"
            $h.OnFailure | Should Be 'block'
            $h.Timeout | Should Be '30'
        }
    }

    It 'epic/SKILL.md: the line resolves $HOME to the installed skill in Git Bash' {
        $fakeHome = Join-Path $TestDrive 'home'
        $scripts = Join-Path $fakeHome '.claude\skills\epic\scripts'
        New-Item -ItemType Directory -Path $scripts -Force | Out-Null
        Copy-Item $script $scripts
        $r = Invoke-HookLine (Get-HookEntry 'epic/SKILL.md').Command 'bash' (New-HookInput 'git push github epic/31-guard' $t.Worktree) @{ HOME = $fakeHome -replace '\\', '/' }
        $r.Decision | Should Be 'deny'
        $r.Reason | Should Match 'Skill epic, Regel 2'
    }

    It 'epic/SKILL.md: denies a forbidden remote and a substitution inside double quotes, allows git status' {
        $line = (Get-HookEntry 'epic/SKILL.md').Command.Replace($installedGuard, $worktreeGuard)
        Assert-HookLine $line 'bash' 'deny' @('git push github epic/31-guard', 'git switch agent/31-p1') $t.Repo
        Assert-HookLine $line 'bash' 'deny' @('echo "$(git push github x)"') $t.Worktree
        Assert-HookLine $line 'bash' 'deny' @('Write-Output "$(git push github x)"', '$cases = @("a", "b $(git push github x) c")') $t.Worktree 'PowerShell'
        Assert-HookLine $line 'powershell' 'deny' @('Write-Output "$(git push github x)"') $t.Worktree 'PowerShell'
        Assert-HookLine $line 'bash' 'allow' @('git status', 'git push -u origin epic/31-guard') $t.Worktree
        Assert-HookLine $line 'powershell' 'allow' @('git status') $t.Worktree 'PowerShell'
    }

    It 'agents/epic-kundschafter.md: denies a commit, allows reading' {
        $line = (Get-HookEntry 'agents/epic-kundschafter.md').Command.Replace($installedGuard, $worktreeGuard)
        $r = Invoke-HookLine $line 'bash' (New-HookInput 'git commit -m x' $TestDrive)
        $r.Decision | Should Be 'deny'
        $r.Reason | Should Match 'Agent epic-kundschafter'
        Assert-HookLine $line 'bash' 'allow' @('git log --oneline', 'cat a.txt') $TestDrive
    }

    It 'epic-aufraeumen/SKILL.md: denies -D, asks before a remote delete, allows -d' {
        $line = (Get-HookEntry 'epic-aufraeumen/SKILL.md').Command.Replace($installedGuard, $worktreeGuard)
        Assert-HookLine $line 'bash' 'deny' @('git branch -D agent/31-p1', 'git worktree remove --force ../wt/1', 'git push --force origin x') $TestDrive
        Assert-HookLine $line 'bash' 'ask' @('git push origin --delete epic/31-guard') $TestDrive
        Assert-HookLine $line 'bash' 'allow' @('git branch -d agent/31-p1') $TestDrive
    }
}
