# Waits for a pull request's checks, merges it with a merge commit, then deletes its head branch on the
# remote only when the base branch provably contains every commit of it. Prints one summary line.
# Usage: merge.ps1 -Repo interias/hexanite -Pr 164 [-MaxMinuten 30] [-BranchBehalten]
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][int]$Pr,
    [int]$MaxMinuten = 30,
    [switch]$BranchBehalten
)

$pr = gh pr view $Pr --repo $Repo --json state,mergeable,headRefName,baseRefName,isDraft,closingIssuesReferences | ConvertFrom-Json
if ($pr.state -ne 'OPEN') { "NICHT GEMERGT #${Pr}: Zustand $($pr.state)"; exit 1 }
if ($pr.isDraft) { "NICHT GEMERGT #${Pr}: Entwurf"; exit 1 }

# Checks need a moment to register after a push; a repo without CI never reports any
$ende = (Get-Date).AddMinutes($MaxMinuten); $leerSeit = Get-Date
while ($true) {
    $checks = @(gh pr checks $Pr --repo $Repo --json name,bucket 2>$null | ConvertFrom-Json)
    if ($checks.Count -eq 0) {
        if (((Get-Date) - $leerSeit).TotalMinutes -ge 2) { break }
    } else {
        $rot = @($checks | Where-Object bucket -in 'fail', 'cancel')
        if ($rot) { "CHECKS ROT #${Pr}: $(($rot | ForEach-Object name) -join ', ')"; exit 1 }
        if (-not ($checks | Where-Object bucket -eq 'pending')) { break }
    }
    if ((Get-Date) -gt $ende) { "ZEIT UM #${Pr}: Checks nach $MaxMinuten min noch offen"; exit 1 }
    Start-Sleep 20
}

$pr = gh pr view $Pr --repo $Repo --json mergeable | ConvertFrom-Json
if ($pr.mergeable -eq 'CONFLICTING') { "KONFLIKT #${Pr}: nicht mergebar"; exit 1 }
gh pr merge $Pr --repo $Repo --merge | Out-Null
if ($LASTEXITCODE) { "MERGE FEHLGESCHLAGEN #$Pr"; exit 1 }

$pr = gh pr view $Pr --repo $Repo --json state,headRefName,baseRefName,closingIssuesReferences | ConvertFrom-Json
$zeile = "GEMERGT #$Pr -> $($pr.baseRefName)"
$issues = @($pr.closingIssuesReferences | ForEach-Object { "#$($_.number)" })
if ($issues) {
    $zu = @($pr.closingIssuesReferences | Where-Object { (gh issue view $_.number --repo $Repo --json state -q .state) -eq 'CLOSED' } | ForEach-Object { "#$($_.number)" })
    $zeile += "; Issues zu: $($zu -join ' ')"
    $offen = @($issues | Where-Object { $_ -notin $zu })
    if ($offen) { $zeile += "; NOCH OFFEN: $($offen -join ' ')" }
}
if (-not $BranchBehalten) {
    $voraus = gh api "repos/$Repo/compare/$($pr.baseRefName)...$($pr.headRefName)" --jq .ahead_by 2>$null
    if ($voraus -eq '0') {
        gh api -X DELETE "repos/$Repo/git/refs/heads/$($pr.headRefName)" 2>$null | Out-Null
        $zeile += if ($LASTEXITCODE) { "; Branch $($pr.headRefName) nicht geloescht" } else { "; Branch $($pr.headRefName) geloescht" }
    } else {
        $zeile += "; Branch $($pr.headRefName) behalten ($voraus Commits nicht in $($pr.baseRefName))"
    }
}
$zeile
