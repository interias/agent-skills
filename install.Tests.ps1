# Pester 3.4 (ships with Windows PowerShell 5.1): Invoke-Pester .\install.Tests.ps1
# install.ps1 is copied into a small fake repository in $TestDrive (one skill, one agent) and runs as a
# separate powershell process with USERPROFILE pointing to a fake home in $TestDrive, so no test
# touches the real ~/.claude.

$source = Join-Path $PSScriptRoot 'install.ps1'

function New-Front([string]$name) { "---`nname: $name`ndescription: test`n---`n`n# $name`n" }

function New-Repo {
    $repo = Join-Path $TestDrive "repo-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    New-Item -ItemType Directory -Path "$repo\epic", "$repo\agents" | Out-Null
    Copy-Item $source "$repo\install.ps1"
    Set-Content -Path "$repo\epic\SKILL.md" -Value (New-Front 'epic')
    Set-Content -Path "$repo\agents\epic-kundschafter.md" -Value (New-Front 'epic-kundschafter')
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
    $out = Invoke-Install $repo $heim @()

    It 'installs into the redirected profile' {
        Test-Path "$heim\.claude\skills\epic\SKILL.md" | Should Be $true
        Test-Path "$heim\.claude\agents\epic-kundschafter.md" | Should Be $true
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
    $null = Invoke-Install $repo $heim @('-Skill', 'epic')

    It 'keeps the retired skill and agent' {
        Test-Path "$heim\.claude\skills\epic-flotte\SKILL.md" | Should Be $true
        Test-Path "$heim\.claude\agents\epic-lauf.md" | Should Be $true
    }
}
