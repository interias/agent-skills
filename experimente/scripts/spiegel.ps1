<#
.SYNOPSIS
    Mirrors a finished /epic run's starting point into two private Gitea repos, so that two
    skills can be run against the same task without touching the real repository.

.DESCRIPTION
    For each name in -Names the script
      1. creates the private repo <Owner>/<name> (stops with exit 1 if it already exists),
      2. pushes -Base of -SourceRepo plus one commit on top as `main`. The commit changes only
         what ties .claude/epic.md to the original: the `api:` URL and the paths of the
         original clone (worktree_root, the .env path in the prose). It is built in a
         temporary bare repo outside -SourceRepo, which is only read (objects are borrowed
         through an alternates file; nothing is written to it),
      3. creates the labels, then the epic and its children in a fixed order, so the new
         numbers are 1..n in the order -Epic, -Children,
      4. recreates the dependency edges of the original, with the new numbers.

    Bodies are the state of the run's start as far as it can be rebuilt. Gitea keeps no edit
    history, so fixed rules take out what was added later: a table row starting with
    `| #n |` and every sentence that names #n, for each n in -Exclude (default 529, 530; they
    are not mirrored). List items that name an excluded issue are not sentences in that sense:
    they stay and are reported as references without a target. Then every `#n` of a mirrored
    issue is rewritten to its new number in one pass. Every removal, rewrite, dropped edge or
    label, adapter line and reference without a target is a deviation in the JSON.

    New numbers are predicted, not patched in afterwards: the repo is fresh, so the n-th issue
    gets number n; the script checks the number Gitea returns and stops if it differs.

    stdout is JSON (one object per mirror: repo, url, clone, base, epic, children, edges,
    rewrites, deviations). Exit 0 means done, 1 means stopped with the reason on stderr.

    -WhatIf prints every planned write (method, path, short body; git push) to stderr and
    writes nothing. It still reads: the original issues, their dependencies and the existence of
    the mirrors.

    -Remove deletes the mirrors (DELETE /repos/<owner>/<name>) after asking: the human types the
    repo name. No switch skips the question. A repo whose name does not start with `exp-` is
    never deleted, and neither created.

    Access: Basic Auth from `git credential fill` for the Gitea host, as in epic/references/
    forge.md. The credentials are never printed and never put into a URL; the push uses the
    credential helper of git.

    Array parameters accept comma-separated strings, because `powershell -File` passes an
    array argument as one string.

.PARAMETER SourceRepo
    Absolute path of the local clone of the original. Only read.

.PARAMETER Base
    Commit of the original that becomes the mirror's starting point. Default 772f38c1.

.PARAMETER Owner
    Gitea organisation that receives the mirrors.

.PARAMETER Names
    Mirror names. Must start with `exp-`.

.PARAMETER Epic
    Number of the epic in the original.

.PARAMETER Children
    Numbers of the children in the original, in the order they are created.

.PARAMETER Exclude
    Numbers that are not mirrored. References to them are removed by the rules above.

.PARAMETER Api
    API base of the Gitea instance.

.PARAMETER SourceOwner
    Owner of the original repo.

.PARAMETER SourceName
    Name of the original repo.

.PARAMETER CloneRoot
    Folder in which the mirrors will be cloned (<CloneRoot>\<name>). Default: the parent folder
    of -SourceRepo. The adapter's paths are rewritten to it.

.PARAMETER WhatIf
    Print the planned writes, write nothing.

.PARAMETER Remove
    Delete the mirrors after confirmation instead of creating them.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File spiegel.ps1 -WhatIf

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File spiegel.ps1 -Remove
#>
[CmdletBinding()]
param(
    [string]$SourceRepo = 'C:\Users\sboerzel\git\BRIQNET',
    [string]$Base = '772f38c1',
    [string]$Owner = 'Breuckmann',
    [string[]]$Names = @('exp-523-a', 'exp-523-b'),
    [int]$Epic = 523,
    [string[]]$Children = @('524', '525', '526', '527', '528'),
    [string[]]$Exclude = @('529', '530'),
    [string]$Api = 'http://mb-vsv-cast:3003/api/v1',
    [string]$SourceOwner = 'Breuckmann',
    [string]$SourceName = 'BRIQNET',
    [string]$CloneRoot,
    [switch]$WhatIf,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

# Run state in one hashtable: functions read it, tests dot-source this file.
$State = @{ DryRun = $false; Api = $null; Auth = $null }
$mirrorLabels = @('epic', 'ready-for-agent', 'enhancement')
$adapterPath = '.claude/epic.md'
$refPattern = '(?<![\w&/])#(\d+)(?!\w)'
$sentenceSplit = '(?<=[.!?])(?<!\b(?:Pkt|bzw|ca|Nr|ggf|vgl|inkl|usw)\.)(\s+)'

# `powershell -File` hands an array argument over as one comma-separated string.
function Split-List([string[]]$values) {
    @($values | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Get-FullPath([string]$path) {
    [IO.Path]::GetFullPath($path).TrimEnd('\', '/')
}

function ConvertTo-List($data) {
    if ($null -eq $data) { return @() }
    @($data)
}

# --- Output seams (mocked in tests) ---------------------------------------------------------

function Write-Plan([string]$text) { [Console]::Error.WriteLine("WhatIf: $text") }
function Write-Info([string]$text) { [Console]::Error.WriteLine($text) }
function Write-Failure([string]$text) { [Console]::Error.WriteLine("spiegel.ps1: $text") }
function Write-Json([string]$json) { [Console]::Out.WriteLine($json) }
function Read-RepoNameConfirmation([string]$prompt) { Read-Host $prompt }

# --- Git ------------------------------------------------------------------------------------

function Invoke-Git([string[]]$arguments, [int[]]$okExit = @(0)) {
    $output = & git @arguments
    if ($okExit -notcontains $LASTEXITCODE) { throw "git $($arguments -join ' ') failed (exit $LASTEXITCODE)." }
    $output
}

# Raw stdout bytes: capturing a blob through the shell would re-encode it.
function Invoke-GitBytes([string[]]$arguments) {
    $quoted = $arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = 'git'
    $info.Arguments = $quoted -join ' '
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($info)
    $stderr = $process.StandardError.ReadToEndAsync()
    $buffer = New-Object IO.MemoryStream
    $process.StandardOutput.BaseStream.CopyTo($buffer)
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "git $($arguments -join ' ') failed (exit $($process.ExitCode)): $($stderr.Result.Trim())" }
    , $buffer.ToArray()
}

function Invoke-GitPush([string]$gitDir, [string]$url, [string]$commit) {
    $previous = $env:GIT_TERMINAL_PROMPT
    $env:GIT_TERMINAL_PROMPT = '0'
    try {
        & git -C $gitDir push --quiet $url "${commit}:refs/heads/main"
        if ($LASTEXITCODE -ne 0) { throw "git push of $commit to $url failed (exit $LASTEXITCODE). The mirror stays as it is; -Remove deletes it." }
    } finally {
        if ($null -eq $previous) { Remove-Item Env:GIT_TERMINAL_PROMPT -ErrorAction SilentlyContinue } else { $env:GIT_TERMINAL_PROMPT = $previous }
    }
}

# --- Gitea ----------------------------------------------------------------------------------

# `git credential fill` with the request read from a file: piping a string from Windows PowerShell
# and writing to a redirected process input both put a byte order mark in front of it, which git
# does not parse. The file holds the URL only, no secret.
function Invoke-GitCredentialFill([string]$request) {
    $file = Join-Path ([IO.Path]::GetTempPath()) ("spiegel-cred-" + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.txt')
    [IO.File]::WriteAllBytes($file, (New-Object Text.UTF8Encoding $false).GetBytes($request))
    try {
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = 'cmd.exe'
        $info.Arguments = '/d /c git credential fill < "' + $file + '"'
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
        $process = [Diagnostics.Process]::Start($info)
        $stderr = $process.StandardError.ReadToEndAsync()
        $stdout = $process.StandardOutput.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw "git credential fill failed: $($stderr.Result.Trim())" }
        @($stdout -split "`r?`n")
    } finally {
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    }
}

function Get-GiteaAuth {
    if ($State.Auth) { return $State.Auth }
    $uri = [Uri]$State.Api
    $credential = Invoke-GitCredentialFill "url=$($uri.Scheme)://$($uri.Authority)`n`n"
    $user = ($credential | Where-Object { $_ -like 'username=*' } | Select-Object -First 1) -replace '^username=', ''
    $pass = ($credential | Where-Object { $_ -like 'password=*' } | Select-Object -First 1) -replace '^password=', ''
    if (-not $user -or -not $pass) { throw "git credential fill returned no username or password for $($uri.Authority)." }
    $State.Auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${user}:${pass}"))
    $State.Auth
}

# Returns @{ Status; Data }. A 4xx/5xx answer is a result, not an exception: callers decide.
function Invoke-Gitea([string]$Method, [string]$Path, $Body = $null) {
    $request = @{
        Uri             = $State.Api.TrimEnd('/') + $Path
        Method          = $Method
        Headers         = @{ Authorization = (Get-GiteaAuth); Accept = 'application/json' }
        UseBasicParsing = $true
    }
    if ($null -ne $Body) {
        $request.Body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 6 -Compress))
        $request.ContentType = 'application/json; charset=utf-8'
    }
    $status = 0
    $text = ''
    try {
        $response = Invoke-WebRequest @request
        $status = [int]$response.StatusCode
        $text = [Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray())
    } catch [System.Net.WebException] {
        if (-not $_.Exception.Response) { throw }
        $status = [int]$_.Exception.Response.StatusCode
        $reader = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream(), [Text.Encoding]::UTF8)
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
        # Windows PowerShell has read the body already and left it in ErrorDetails.
        if (-not $text -and $_.ErrorDetails) { $text = $_.ErrorDetails.Message }
    }
    $data = $null
    if ($text) { try { $data = $text | ConvertFrom-Json } catch { $data = $text } }
    @{ Status = $status; Data = $data }
}

# Lists are capped at 50 per page on this instance: page until a short page.
function Get-GiteaList([string]$Path) {
    $all = @()
    $page = 1
    do {
        $separator = if ($Path -match '\?') { '&' } else { '?' }
        $r = Invoke-Gitea 'GET' "$Path${separator}limit=50&page=$page"
        if ($r.Status -ne 200) { throw "GET $Path failed (HTTP $($r.Status))." }
        $items = ConvertTo-List $r.Data
        $all += $items
        $page++
    } while ($items.Count -ge 50)
    $all
}

function Format-Short($Body) {
    if ($null -eq $Body) { return '' }
    $pairs = foreach ($key in $Body.Keys) {
        $value = $Body[$key]
        if ($value -is [array]) { $value = '[' + ($value -join ',') + ']' }
        $text = ("$value" -replace '\s+', ' ')
        if ($text.Length -gt 60) { $text = $text.Substring(0, 57) + '...' }
        "$key=$text"
    }
    $pairs -join ', '
}

# Every write goes through here, so -WhatIf has one place to stop it.
function Invoke-GiteaWrite([string]$Method, [string]$Path, $Body = $null, $Simulated = $null, [string]$Summary = $null) {
    if ($State.DryRun) {
        $short = if ($Summary) { $Summary } else { Format-Short $Body }
        $line = "$Method $Path $short"
        Write-Plan $line.TrimEnd()
        return @{ Status = 200; Data = $Simulated }
    }
    $r = Invoke-Gitea $Method $Path $Body
    if ($r.Status -lt 200 -or $r.Status -ge 300) { throw "$Method $Path failed (HTTP $($r.Status)): $("$($r.Data)" -replace '\s+', ' ')" }
    $r
}

# --- Body reconstruction --------------------------------------------------------------------

function Add-Deviation($list, $issue, [string]$kind, $fields) {
    $entry = [ordered]@{ kind = $kind }
    if ($null -ne $issue) { $entry = [ordered]@{ issue = [int]$issue; kind = $kind } }
    foreach ($key in $fields.Keys) { $entry[$key] = $fields[$key] }
    $list.Add($entry) | Out-Null
}

# Rebuilds the body as it stood at the start: removes what only an excluded issue explains, then
# rewrites the numbers. Returns @{ Body; Deviations }.
function Convert-IssueBody([int]$Number, [string]$Body, [hashtable]$Mapping, [int[]]$Exclude) {
    $deviations = New-Object System.Collections.ArrayList
    $kept = New-Object System.Collections.ArrayList

    foreach ($raw in ($Body -split "`n", -1)) {
        $cr = ''
        $line = $raw
        if ($line.EndsWith("`r")) { $cr = "`r"; $line = $line.Substring(0, $line.Length - 1) }

        $excluded = @([regex]::Matches($line, $refPattern) | ForEach-Object { [int]$_.Groups[1].Value } | Where-Object { $Exclude -contains $_ })

        # Rule 2: a table row that starts with an excluded issue.
        if ($line -match '^\s*\|\s*#(\d+)\s*\|' -and $Exclude -contains [int]$Matches[1]) {
            Add-Deviation $deviations $Number 'removed' @{ rule = "table row starting with | #$($Matches[1]) |"; text = $line.Trim() }
            continue
        }
        # Rows and list items are not sentences: they stay, and the reference is reported below.
        $isProse = $line -notmatch '^\s*\|' -and $line -notmatch '^\s*([-*+]|\d+[.)])\s'

        if ($excluded.Count -gt 0 -and $isProse) {
            # Rule 1: every sentence that names an excluded issue.
            $prefix = [regex]::Match($line, '^(\s*>\s*)*').Value
            $parts = [regex]::Split($line.Substring($prefix.Length), $sentenceSplit)
            $sentences = @(); $separators = @()
            for ($i = 0; $i -lt $parts.Count; $i++) { if ($i % 2 -eq 0) { $sentences += $parts[$i] } else { $separators += $parts[$i] } }
            $result = ''
            $keptAny = $false
            for ($i = 0; $i -lt $sentences.Count; $i++) {
                $hits = @([regex]::Matches($sentences[$i], $refPattern) | ForEach-Object { [int]$_.Groups[1].Value } | Where-Object { $Exclude -contains $_ })
                if ($hits.Count -gt 0) {
                    Add-Deviation $deviations $Number 'removed' @{ rule = "sentence naming #$($hits[0])"; text = $sentences[$i].Trim() }
                    continue
                }
                if ($keptAny -and $i -gt 0) { $result += $separators[$i - 1] }
                $result += $sentences[$i]
                if ($sentences[$i].Trim()) { $keptAny = $true }
            }
            if (-not $keptAny) { continue }
            $line = $prefix + $result
        }
        $kept.Add($line + $cr) | Out-Null
    }

    $counts = [ordered]@{}
    $evaluatorLine = $null
    $evaluator = [Text.RegularExpressions.MatchEvaluator] {
        param($m)
        $old = [int]$m.Groups[1].Value
        if ($Mapping.ContainsKey($old)) {
            $key = "#$old|#$($Mapping[$old])"
            if ($counts.Contains($key)) { $counts[$key]++ } else { $counts[$key] = 1 }
            return "#$($Mapping[$old])"
        }
        $context = $evaluatorLine.Trim()
        if ($context.Length -gt 100) { $context = $context.Substring(0, 97) + '...' }
        Add-Deviation $deviations $Number 'reference-without-target' @{ ref = "#$old"; context = $context }
        $m.Value
    }
    $rewritten = foreach ($line in $kept) {
        $evaluatorLine = $line
        [regex]::Replace($line, $refPattern, $evaluator)
    }
    foreach ($key in $counts.Keys) {
        $from, $to = $key -split '\|'
        Add-Deviation $deviations $Number 'rewritten' @{ from = $from; to = $to; count = $counts[$key] }
    }
    @{ Body = (@($rewritten) -join "`n"); Deviations = $deviations }
}

# --- Adapter commit -------------------------------------------------------------------------

# The lines of the adapter that tie the mirror to the original, as ordered rewrite rules.
function Get-AdapterRules([string]$Api, [string]$SourceOwner, [string]$SourceName, [string]$Owner, [string]$Name, [string]$SourceRepo, [string]$CloneRoot) {
    $source = ($SourceRepo -replace '\\', '/').TrimEnd('/')
    $clone = ((Join-Path $CloneRoot $Name) -replace '\\', '/')
    $pathPattern = [regex]::Escape($source).Replace('/', '[\\/]')
    $apiBase = $Api.TrimEnd('/')
    @(
        @{ Name = 'api'; Pattern = ([regex]::Escape("$apiBase/repos/$SourceOwner/$SourceName") + '(?![\w.-])'); Replacement = "$apiBase/repos/$Owner/$Name" },
        @{ Name = 'worktree_root'; Pattern = "(?i)$pathPattern-worktrees(?![\w-])"; Replacement = "$clone-worktrees" },
        @{ Name = 'clone path'; Pattern = "(?i)$pathPattern(?![\w-])"; Replacement = $clone }
    )
}

function New-WorkRepo([string]$SourceRepo, [string]$Dir) {
    Invoke-Git @('init', '--bare', '--quiet', $Dir) | Out-Null
    $common = Invoke-Git @('-C', $SourceRepo, 'rev-parse', '--git-common-dir') | Select-Object -First 1
    if (-not [IO.Path]::IsPathRooted($common)) { $common = Join-Path $SourceRepo $common }
    $objects = (Get-FullPath (Join-Path $common 'objects')) -replace '\\', '/'
    [IO.File]::WriteAllText((Join-Path $Dir 'objects/info/alternates'), "$objects`n", (New-Object Text.UTF8Encoding $false))
}

# Commits the adapter with the rules applied on top of $Base, in the bare repo $GitDir. No
# checkout: new blob, temporary index, write-tree, commit-tree.
# Returns @{ Hash; Parent; Changes; Residual }.
function New-AdapterCommit([string]$GitDir, [string]$Base, [string]$AdapterPath, $Rules, [string[]]$ResidualPatterns, [string]$Message) {
    $parent = Invoke-Git @('-C', $GitDir, 'rev-parse', '--verify', '--quiet', "$Base^{commit}") | Select-Object -First 1
    if (-not $parent) { throw "Base '$Base' is not a commit in the source repo." }
    $entry = [string](Invoke-Git @('-C', $GitDir, 'ls-tree', $parent, '--', $AdapterPath) | Select-Object -First 1)
    if ($entry -notmatch '^(?<mode>\d+) blob (?<sha>[0-9a-f]+)\t') { throw "$AdapterPath does not exist at $Base. Without the adapter a run in the mirror cannot be checked." }
    $mode = $Matches.mode

    $utf8 = New-Object Text.UTF8Encoding $false
    $text = $utf8.GetString((Invoke-GitBytes @('-C', $GitDir, 'cat-file', 'blob', $Matches.sha)))
    $lines = $text -split "`n", -1
    $changes = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $old = $lines[$i]
        $new = $old
        $applied = @()
        foreach ($rule in $Rules) {
            $replaced = [regex]::Replace($new, $rule.Pattern, $rule.Replacement.Replace('$', '$$'))
            if ($replaced -ne $new) { $applied += $rule.Name; $new = $replaced }
        }
        if ($new -ne $old) {
            $lines[$i] = $new
            $changes.Add([ordered]@{ file = $AdapterPath; line = $i + 1; rule = ($applied -join ', '); from = $old.Trim(); to = $new.Trim() }) | Out-Null
        }
    }
    if (-not @($changes | Where-Object { $_.rule -match '(^|, )api(,|$)' })) {
        throw "No line of $AdapterPath at $Base names the original API. A run in the mirror might write into the original; not going on."
    }

    $tempFile = Join-Path $GitDir 'spiegel-adapter.tmp'
    [IO.File]::WriteAllBytes($tempFile, $utf8.GetBytes(($lines -join "`n")))
    $blob = Invoke-Git @('-C', $GitDir, 'hash-object', '-w', '--no-filters', $tempFile) | Select-Object -First 1
    Remove-Item -LiteralPath $tempFile -Force

    $names = 'GIT_INDEX_FILE', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'
    $saved = @{}
    foreach ($n in $names) { $saved[$n] = [Environment]::GetEnvironmentVariable($n) }
    try {
        $indexFile = Join-Path $GitDir 'spiegel.index'
        if (Test-Path -LiteralPath $indexFile) { Remove-Item -LiteralPath $indexFile -Force }
        $env:GIT_INDEX_FILE = $indexFile
        $env:GIT_AUTHOR_NAME = 'spiegel.ps1'; $env:GIT_COMMITTER_NAME = 'spiegel.ps1'
        $env:GIT_AUTHOR_EMAIL = 'spiegel@localhost'; $env:GIT_COMMITTER_EMAIL = 'spiegel@localhost'
        Invoke-Git @('-C', $GitDir, 'read-tree', $parent) | Out-Null
        Invoke-Git @('-C', $GitDir, 'update-index', '--cacheinfo', "$mode,$blob,$AdapterPath") | Out-Null
        $tree = Invoke-Git @('-C', $GitDir, 'write-tree') | Select-Object -First 1
        $hash = Invoke-Git @('-C', $GitDir, 'commit-tree', $tree, '-p', $parent, '-m', $Message) | Select-Object -First 1
    } finally {
        foreach ($n in $names) { [Environment]::SetEnvironmentVariable($n, $saved[$n]) }
    }

    # Nothing but the adapter may differ, and only in the lines counted.
    $numstat = @(Invoke-Git @('-C', $GitDir, 'diff', '--numstat', $parent, $hash))
    if ($numstat.Count -ne 1 -or $numstat[0] -ne "$($changes.Count)`t$($changes.Count)`t$AdapterPath") {
        throw "The adapter commit differs from $Base in more than the $($changes.Count) planned line(s): $($numstat -join '; ')"
    }

    # What still points at the original after the rules: reported, not changed.
    $residual = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $lines.Count; $i++) {
        foreach ($pattern in $ResidualPatterns) {
            if ($lines[$i] -match $pattern) { $residual.Add([ordered]@{ file = $AdapterPath; line = $i + 1; text = $lines[$i].Trim() }) | Out-Null; break }
        }
    }
    @{ Hash = $hash; Parent = $parent; Changes = $changes; Residual = $residual }
}

# Files other than the adapter that name the original repo or the path of its clone (a run
# would start services from there). Reported, never changed.
function Find-OriginalReferences([string]$GitDir, [string]$Commit, [string[]]$Needles, [string]$AdapterPath) {
    $arguments = @('-C', $GitDir, 'grep', '-l', '-I', '-i', '-F')
    foreach ($needle in $Needles) { $arguments += @('-e', $needle) }
    $hits = @(Invoke-Git ($arguments + $Commit) @(0, 1))
    @($hits | ForEach-Object { $_ -replace '^[0-9a-f]+:', '' } | Where-Object { $_ -and $_ -ne $AdapterPath })
}

# --- Orchestration --------------------------------------------------------------------------

function Test-RepoExists([string]$Owner, [string]$Name) {
    $r = Invoke-Gitea 'GET' "/repos/$Owner/$Name"
    if ($r.Status -eq 200) { return $true }
    if ($r.Status -eq 404) { return $false }
    throw "GET /repos/$Owner/$Name answered HTTP $($r.Status); cannot tell whether the mirror exists."
}

function Assert-MirrorName([string]$Name) {
    if ($Name -notmatch '^exp-[A-Za-z0-9._-]+$') { throw "Mirror name '$Name' does not start with 'exp-'. Not touching it." }
}

function Invoke-RemoveMirrors([string]$Owner, [string[]]$Names) {
    foreach ($name in $Names) { Assert-MirrorName $name }
    $declined = @()
    foreach ($name in $Names) {
        if (-not (Test-RepoExists $Owner $name)) { Write-Info "$Owner/$name does not exist; nothing to delete."; continue }
        if ($State.DryRun) {
            Invoke-GiteaWrite 'DELETE' "/repos/$Owner/$name" | Out-Null
            continue
        }
        $answer = Read-RepoNameConfirmation "Delete the repo $Owner/$name for good? Type its name '$name' to confirm, anything else skips it"
        if ("$answer".Trim() -ne $name) {
            Write-Info "Not deleted: $Owner/$name (the input did not match)."
            $declined += $name
            continue
        }
        Invoke-GiteaWrite 'DELETE' "/repos/$Owner/$name" | Out-Null
        Write-Info "Deleted: $Owner/$name"
    }
    if ($declined.Count -gt 0) { throw "Not deleted: $($declined -join ', '). The confirmation did not match." }
}

function Invoke-Spiegel($p) {
    $ids = @([int]$p.Epic) + @(Split-List $p.Children | ForEach-Object { [int]$_ })
    $exclude = @(Split-List $p.Exclude | ForEach-Object { [int]$_ })
    $names = Split-List $p.Names
    if ($names.Count -eq 0) { throw '-Names is empty.' }
    if (@($names | Select-Object -Unique).Count -ne $names.Count) { throw '-Names contains a name twice.' }
    foreach ($name in $names) { Assert-MirrorName $name }
    $State.DryRun = [bool]$p.WhatIf
    $State.Api = $p.Api.TrimEnd('/')

    if ($p.DoRemove) { Invoke-RemoveMirrors $p.Owner $names; return }

    if (-not [IO.Path]::IsPathRooted($p.SourceRepo)) { throw "'$($p.SourceRepo)' is not an absolute path. Relative paths break once the shell's working directory moves." }
    $sourceRepo = Get-FullPath $p.SourceRepo
    if (-not (Test-Path -LiteralPath $sourceRepo -PathType Container)) { throw "$sourceRepo does not exist." }
    $cloneRoot = if ($p.CloneRoot) { Get-FullPath $p.CloneRoot } else { Split-Path -Parent $sourceRepo }
    if (@($ids | Where-Object { $exclude -contains $_ }).Count -gt 0) { throw '-Exclude names an issue that is also the epic or a child.' }

    # Reads first, so a mirror that exists or a missing issue stops everything before the first write.
    foreach ($name in $names) {
        if (Test-RepoExists $p.Owner $name) { throw "$($p.Owner)/$name already exists. Not writing anything; -Remove deletes it." }
    }
    $mapping = @{}
    for ($i = 0; $i -lt $ids.Count; $i++) { $mapping[$ids[$i]] = $i + 1 }

    $source = "/repos/$($p.SourceOwner)/$($p.SourceName)"
    $issues = @{}
    $blockers = @{}
    foreach ($id in $ids) {
        $r = Invoke-Gitea 'GET' "$source/issues/$id"
        if ($r.Status -ne 200) { throw "GET $source/issues/$id answered HTTP $($r.Status)." }
        if ($r.Data.pull_request) { throw "#$id is a pull request, not an issue." }
        $issues[$id] = $r.Data
        $blockers[$id] = @(Get-GiteaList "$source/issues/$id/dependencies")
    }

    # Bodies, labels and edges are the same for both mirrors.
    $common = New-Object System.Collections.ArrayList
    $bodies = @{}
    $labelsOf = @{}
    $labelDefs = [ordered]@{}
    foreach ($id in $ids) {
        $converted = Convert-IssueBody $id ([string]$issues[$id].body) $mapping $exclude
        $bodies[$id] = $converted.Body
        foreach ($d in $converted.Deviations) { $common.Add($d) | Out-Null }
        $issueLabels = @()
        foreach ($label in @($issues[$id].labels)) {
            if ($mirrorLabels -contains $label.name) {
                $issueLabels += $label.name
                if (-not $labelDefs.Contains($label.name)) { $labelDefs[$label.name] = $label }
            } else {
                Add-Deviation $common $id 'label-dropped' @{ label = $label.name }
            }
        }
        $labelsOf[$id] = $issueLabels
    }
    $rewrites = 0
    foreach ($d in $common) { if ($d.kind -eq 'rewritten') { $rewrites += $d.count } }

    $edges = New-Object System.Collections.ArrayList
    foreach ($id in $ids) {
        foreach ($blocker in $blockers[$id]) {
            $other = [int]$blocker.number
            $foreign = $blocker.repository -and $blocker.repository.full_name -and ($blocker.repository.full_name -ne "$($p.SourceOwner)/$($p.SourceName)")
            if (-not $foreign -and $mapping.ContainsKey($other)) {
                $edges.Add([ordered]@{ issue = $mapping[$id]; blockedBy = $mapping[$other]; original = "#$id is blocked by #$other" }) | Out-Null
            } else {
                Add-Deviation $common $id 'edge-dropped' @{ blockedBy = "#$other"; reason = 'the blocking issue is not mirrored' }
            }
        }
    }
    $edges = @($edges | Sort-Object { $_.issue }, { $_.blockedBy })

    $work = Join-Path ([IO.Path]::GetTempPath()) ("spiegel-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $results = @()
    try {
        New-WorkRepo $sourceRepo $work
        $references = @()
        $referencesRead = $false
        # What may still point at the original after the rules ran: reported, not changed.
        $residualPatterns = @(
            [regex]::Escape("$($p.SourceOwner)/$($p.SourceName)"),
            ('(?i)' + [regex]::Escape(($sourceRepo -replace '\\', '/')).Replace('/', '[\\/]'))
        )
        $webBase = $State.Api -replace '/api/v1$', ''

        foreach ($name in $names) {
            $fullName = "$($p.Owner)/$name"
            $rules = Get-AdapterRules $State.Api $p.SourceOwner $p.SourceName $p.Owner $name $sourceRepo $cloneRoot
            $commit = New-AdapterCommit $work $p.Base $adapterPath $rules $residualPatterns "chore(experiment): point the epic adapter at the mirror $name"
            if (-not $referencesRead) {
                $needles = @("$($p.SourceOwner)/$($p.SourceName)", ($sourceRepo -replace '\\', '/'), $sourceRepo) | Select-Object -Unique
                $references = @(Find-OriginalReferences $work $commit.Hash $needles $adapterPath)
                $referencesRead = $true
            }

            $deviations = New-Object System.Collections.ArrayList
            foreach ($c in $commit.Changes) { Add-Deviation $deviations $null 'adapter-line' $c }
            foreach ($c in $commit.Residual) { Add-Deviation $deviations $null 'adapter-reference-unchanged' $c }
            foreach ($f in $references) { Add-Deviation $deviations $null 'repository-reference-unchanged' @{ file = $f } }
            foreach ($d in $common) { $deviations.Add($d) | Out-Null }

            # 1. repo
            Invoke-GiteaWrite 'POST' "/orgs/$($p.Owner)/repos" ([ordered]@{ name = $name; private = $true; default_branch = 'main' }) | Out-Null
            # 2. push: the adapter commit carries the history of $Base
            $url = "$webBase/$fullName.git"
            if ($State.DryRun) { Write-Plan "git push $url $($commit.Hash):refs/heads/main" } else { Invoke-GitPush $work $url $commit.Hash }
            # 3. labels
            $labelIds = @{}
            $n = 0
            foreach ($labelName in $labelDefs.Keys) {
                $n++
                $def = $labelDefs[$labelName]
                $color = '#' + ([string]$def.color).TrimStart('#')
                $created = Invoke-GiteaWrite 'POST' "/repos/$fullName/labels" ([ordered]@{ name = $labelName; color = $color; description = [string]$def.description }) ([pscustomobject]@{ id = $n })
                $labelIds[$labelName] = [int]$created.Data.id
            }
            # 4. issues in fixed order; the number of the n-th issue of a fresh repo is n
            foreach ($id in $ids) {
                $body = [ordered]@{ title = [string]$issues[$id].title; body = $bodies[$id]; labels = @($labelsOf[$id] | ForEach-Object { $labelIds[$_] }) }
                $summary = "title=$("$($body.title)" -replace '\s+', ' ' | ForEach-Object { if ($_.Length -gt 60) { $_.Substring(0, 57) + '...' } else { $_ } }), labels=[$($labelsOf[$id] -join ',')], body=<$($body.body.Length) chars>, original #$id -> #$($mapping[$id])"
                $created = Invoke-GiteaWrite 'POST' "/repos/$fullName/issues" $body ([pscustomobject]@{ number = $mapping[$id] }) $summary
                if ([int]$created.Data.number -ne $mapping[$id]) {
                    throw "${fullName}: issue for #$id got number $($created.Data.number), expected $($mapping[$id]). The bodies are rewritten for the expected numbers, so the mirror is unusable; -Remove deletes it."
                }
            }
            # 5. edges: {index} in the URL is blocked by the issue in the body
            foreach ($edge in $edges) {
                Invoke-GiteaWrite 'POST' "/repos/$fullName/issues/$($edge.issue)/dependencies" ([ordered]@{ owner = $p.Owner; repo = $name; index = $edge.blockedBy }) | Out-Null
            }

            $children = [ordered]@{}
            foreach ($id in @($ids | Select-Object -Skip 1)) { $children["$id"] = $mapping[$id] }
            $results += [ordered]@{
                repo       = $fullName
                url        = "$webBase/$fullName"
                clone      = ((Join-Path $cloneRoot $name) -replace '\\', '/')
                base       = $commit.Hash
                epic       = $mapping[$ids[0]]
                children   = $children
                edges      = @($edges | ForEach-Object { [ordered]@{ issue = $_.issue; blockedBy = $_.blockedBy; original = $_.original } })
                rewrites   = $rewrites
                deviations = @($deviations)
            }
        }
    } finally {
        if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue }
    }
    Write-Json (ConvertTo-Json -InputObject @($results) -Depth 8)
}

function Invoke-Main($p) {
    try {
        Invoke-Spiegel $p
        return 0
    } catch {
        Write-Failure $_.Exception.Message
        return 1
    }
}

# Runs only when called directly; dot-sourcing (tests) defines the functions and stops.
if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-Main @{
        SourceRepo = $SourceRepo; Base = $Base; Owner = $Owner; Names = $Names; Epic = $Epic
        Children = $Children; Exclude = $Exclude; Api = $Api; SourceOwner = $SourceOwner
        SourceName = $SourceName; CloneRoot = $CloneRoot; WhatIf = [bool]$WhatIf; DoRemove = [bool]$Remove
    })
}
