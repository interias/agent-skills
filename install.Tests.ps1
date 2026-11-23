# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\install.Tests.ps1
# install.ps1 is copied into a small fake repository in $TestDrive (one skill, one agent) and runs as a
# separate powershell process with USERPROFILE pointing to a fake home in $TestDrive, so no test
# touches the real ~/.claude.

$source = Join-Path $PSScriptRoot 'install.ps1'

function New-Front([string]$name) { "---`nname: $name`ndescription: test`n---`n`n# $name`n" }

function New-Repo {
    $repo = Join-Path $TestDrive "repo-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    New-Item -ItemType Directory -Path "$repo\mission", "$repo\agents" | Out-Null
    Copy-Item $source "$repo\install.ps1"
    Set-Content -Path "$repo\mission\SKILL.md" -Value (New-Front 'mission')
    Set-Content -Path "$repo\agents\kundschafter.md" -Value (New-Front 'kundschafter')
    $repo
}

function New-Home {
    $heim = Join-Path $TestDrive "home-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    New-Item -ItemType Directory -Path "$heim\.claude\skills", "$heim\.claude\agents" | Out-Null
    $heim
}

function Add-Skill([string]$heim, [string]$folder, [string]$name) {
    $dir = "$heim\.claude\skills\$folder"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Set-Content -Path "$dir\notes.txt" -Value 'kept'
    if ($name) { Set-Content -Path "$dir\SKILL.md" -Value (New-Front $name) }
}

function Add-Agent([string]$heim, [string]$file, [string]$name) {
    Set-Content -Path "$heim\.claude\agents\$file" -Value (New-Front $name)
}

function Invoke-Install([string]$repo, [string]$heim, [string[]]$argumente) {
    if (-not $heim.StartsWith($TestDrive)) { throw "Fake home $heim is not under $TestDrive." }
    $alt = $env:USERPROFILE
    $env:USERPROFILE = $heim
    try { & powershell -NoProfile -ExecutionPolicy Bypass -File "$repo\install.ps1" @argumente 2>&1 | ForEach-Object { "$_" } }
    finally { $env:USERPROFILE = $alt }
}

function Get-Backups([string]$heim, [string]$filter) {
    @(Get-ChildItem -Path "$heim\.claude\skills-backup" -Directory -Filter $filter -ErrorAction SilentlyContinue)
}

Describe 'install.ps1 removes installed copies of retired skills and agents' {
    $repo = New-Repo
    $heim = New-Home
    Add-Skill $heim 'epic-flotte' 'epic-flotte'
    Add-Skill $heim 'leitstand' 'leitstand'
    Add-Skill $heim 'eigener' 'eigener'
    Add-Agent $heim 'epic-lauf.md' 'epic-lauf'
    Add-Agent $heim 'mein-agent.md' 'mein-agent'
    Add-Skill $heim 'epic' 'epic'
    Add-Agent $heim 'epic-implementer-standard.md' 'epic-implementer-standard'
    Add-Agent $heim 'epic-kundschafter.md' 'epic-kundschafter'
    $out = Invoke-Install $repo $heim @()

    It 'installs into the redirected profile' {
        Test-Path "$heim\.claude\skills\mission\SKILL.md" | Should Be $true
        Test-Path "$heim\.claude\agents\kundschafter.md" | Should Be $true
    }

    It 'removes the skills and agents under their names before the Sprachraum (hard switch, ADR-0003)' {
        Test-Path "$heim\.claude\skills\epic" | Should Be $false
        (Get-Backups $heim 'epic-2*').Count | Should Be 1
        Test-Path "$heim\.claude\agents\epic-implementer-standard.md" | Should Be $false
        Test-Path "$heim\.claude\agents\epic-kundschafter.md" | Should Be $false
    }

    It 'removes a retired skill folder whose SKILL.md carries its name' {
        Test-Path "$heim\.claude\skills\epic-flotte" | Should Be $false
        Test-Path "$heim\.claude\skills\leitstand" | Should Be $false
        ($out | Where-Object { $_ -like "Removed *epic-flotte" }) | Should Not BeNullOrEmpty
    }

    It 'backs up the retired skill folder before removing it' {
        $backup = Get-Backups $heim 'epic-flotte-*'
        $backup.Count | Should Be 1
        Test-Path "$($backup[0].FullName)\SKILL.md" | Should Be $true
        Test-Path "$($backup[0].FullName)\notes.txt" | Should Be $true
        (Get-Backups $heim 'leitstand-*').Count | Should Be 1
    }

    It 'leaves a skill folder that is not on the list' {
        Test-Path "$heim\.claude\skills\eigener\SKILL.md" | Should Be $true
    }

    It 'removes the retired agent epic-lauf.md after a backup and leaves a foreign agent' {
        Test-Path "$heim\.claude\agents\epic-lauf.md" | Should Be $false
        $backup = Get-Backups $heim 'agents-*'
        $backup.Count | Should Be 1
        Test-Path "$($backup[0].FullName)\epic-lauf.md" | Should Be $true
        Test-Path "$heim\.claude\agents\mein-agent.md" | Should Be $true
    }
}

Describe 'install.ps1 keeps a folder under a retired name it did not install' {
    $repo = New-Repo
    $heim = New-Home
    Add-Skill $heim 'epic-flotte' 'etwas-anderes'
    Add-Skill $heim 'epic-lagebesprechung' $null
    Add-Agent $heim 'epic-lauf.md' 'etwas-anderes'
    $out = Invoke-Install $repo $heim @()

    It 'keeps a folder whose SKILL.md names something else' {
        Test-Path "$heim\.claude\skills\epic-flotte\SKILL.md" | Should Be $true
        (Get-Backups $heim 'epic-flotte-*').Count | Should Be 0
    }

    It 'keeps a folder without SKILL.md' {
        Test-Path "$heim\.claude\skills\epic-lagebesprechung\notes.txt" | Should Be $true
    }

    It 'keeps an agent file whose name is something else' {
        Test-Path "$heim\.claude\agents\epic-lauf.md" | Should Be $true
    }

    It 'says in one line why it kept each one' {
        @($out | Where-Object { $_ -like 'Kept *' }).Count | Should Be 3
    }
}

Describe 'install.ps1 keeps a folder under a renamed skill name it did not install' {
    $repo = New-Repo
    $heim = New-Home
    New-Item -ItemType Directory -Path "$repo\mission-nacharbeit" | Out-Null
    Set-Content -Path "$repo\mission-nacharbeit\SKILL.md" -Value (New-Front 'mission-nacharbeit')
    Add-Skill $heim 'epic' 'etwas-anderes'
    Add-Skill $heim 'prd-nacharbeit' $null
    Add-Skill $heim 'prd' 'prd'
    $out = Invoke-Install $repo $heim @()

    It 'keeps a folder whose SKILL.md names something else, and one without SKILL.md' {
        Test-Path "$heim\.claude\skills\epic\SKILL.md" | Should Be $true
        Test-Path "$heim\.claude\skills\prd-nacharbeit\notes.txt" | Should Be $true
        (Get-Backups $heim 'epic-2*').Count | Should Be 0
        (Get-Backups $heim 'prd-nacharbeit-*').Count | Should Be 0
        @($out | Where-Object { $_ -like 'Kept *' }).Count | Should Be 2
    }

    It 'still removes the old folder this repository installed (its name: matches)' {
        Test-Path "$heim\.claude\skills\prd" | Should Be $false
        (Get-Backups $heim 'prd-2*').Count | Should Be 1
    }
}

function New-Linked {
    $linked = Join-Path $TestDrive "linked-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    New-Item -ItemType Directory -Path $linked | Out-Null
    Set-Content -Path "$linked\SKILL.md" -Value (New-Front 'epic-flotte')
    $linked
}

Describe 'install.ps1 keeps a retired folder that is a junction' {
    $repo = New-Repo
    $heim = New-Home
    $linked = New-Linked
    New-Item -ItemType Junction -Path "$heim\.claude\skills\epic-flotte" -Value $linked | Out-Null
    $out = Invoke-Install $repo $heim @()

    It 'keeps the junction and what it points at, backs up nothing and says why' {
        Test-Path "$heim\.claude\skills\epic-flotte" | Should Be $true
        Test-Path "$linked\SKILL.md" | Should Be $true
        (Get-Backups $heim 'epic-flotte-*').Count | Should Be 0
        ($out | Where-Object { $_ -like 'ABORT:*epic-flotte*reparse point*' }) | Should Not BeNullOrEmpty
    }
}

Describe 'install.ps1 keeps a retired folder that contains a junction' {
    $repo = New-Repo
    $heim = New-Home
    $linked = New-Linked
    Add-Skill $heim 'leitstand' 'leitstand'
    New-Item -ItemType Junction -Path "$heim\.claude\skills\leitstand\link" -Value $linked | Out-Null
    $out = Invoke-Install $repo $heim @()

    It 'keeps the folder and what the junction points at, backs up nothing and says why' {
        Test-Path "$heim\.claude\skills\leitstand\SKILL.md" | Should Be $true
        Test-Path "$linked\SKILL.md" | Should Be $true
        (Get-Backups $heim 'leitstand-*').Count | Should Be 0
        ($out | Where-Object { $_ -like 'ABORT:*reparse points*leitstand*' }) | Should Not BeNullOrEmpty
    }
}

Describe 'install.ps1 -DryRun with retired copies' {
    $repo = New-Repo
    $heim = New-Home
    Add-Skill $heim 'epic-flotte' 'epic-flotte'
    Add-Agent $heim 'epic-lauf.md' 'epic-lauf'
    $out = Invoke-Install $repo $heim @('-DryRun')

    It 'removes and backs up nothing' {
        Test-Path "$heim\.claude\skills\epic-flotte\SKILL.md" | Should Be $true
        Test-Path "$heim\.claude\agents\epic-lauf.md" | Should Be $true
        Test-Path "$heim\.claude\skills-backup" | Should Be $false
    }

    It 'reports what it would remove' {
        ($out | Where-Object { $_ -like '`[DryRun`] Would back up *epic-flotte*remove it' }) | Should Not BeNullOrEmpty
        ($out | Where-Object { $_ -like '`[DryRun`] Would back up *epic-lauf.md*remove it' }) | Should Not BeNullOrEmpty
    }
}

Describe 'install.ps1 -Skill leaves retired copies alone' {
    $repo = New-Repo
    $heim = New-Home
    Add-Skill $heim 'epic-flotte' 'epic-flotte'
    Add-Agent $heim 'epic-lauf.md' 'epic-lauf'
    $null = Invoke-Install $repo $heim @('-Skill', 'mission')

    It 'keeps the retired skill and agent' {
        Test-Path "$heim\.claude\skills\epic-flotte\SKILL.md" | Should Be $true
        Test-Path "$heim\.claude\agents\epic-lauf.md" | Should Be $true
    }
}

Describe 'install.ps1 writes the stand of the source into each installed skill (#154)' {
    $repo = New-Repo
    $heim = New-Home
    Add-Skill $heim 'mission' 'mission'
    $env:GIT_COMMITTER_DATE = '2026-11-20T10:00:00+01:00'
    try {
        & git -C $repo init -q
        & git -C $repo -c user.name=t -c user.email=t@t add -A
        & git -C $repo -c user.name=t -c user.email=t@t commit -q -m 'Stand'
    } finally { Remove-Item Env:GIT_COMMITTER_DATE }
    $commit = (& git -C $repo rev-parse HEAD).Trim()
    $out = Invoke-Install $repo $heim @()
    $stand = Get-Content "$heim\.claude\skills\mission\stand.json" -Raw | ConvertFrom-Json

    It 'names commit, its date, the time of the install and the source' {
        $stand.commit | Should Be $commit
        $stand.datum | Should Be '2026-11-20T10:00:00+01:00'
        $stand.installiert | Should Not BeNullOrEmpty
        $stand.quelle | Should Be $repo
    }

    It 'says which stand it installed' {
        ($out | Where-Object { $_ -like "Stand $($commit.Substring(0, 7)) *" }) | Should Not BeNullOrEmpty
    }

    It 'a dry run writes no stand' {
        $heim2 = New-Home
        $null = Invoke-Install $repo $heim2 @('-DryRun')
        Test-Path "$heim2\.claude\skills\mission\stand.json" | Should Be $false
    }
}

Describe 'install.ps1 from a folder that is no git repository (#154)' {
    $repo = New-Repo
    $heim = New-Home
    $out = Invoke-Install $repo $heim @()

    It 'installs without a stand and says so' {
        Test-Path "$heim\.claude\skills\mission\SKILL.md" | Should Be $true
        Test-Path "$heim\.claude\skills\mission\stand.json" | Should Be $false
        ($out | Where-Object { $_ -like 'No stand*' }) | Should Not BeNullOrEmpty
    }
}
