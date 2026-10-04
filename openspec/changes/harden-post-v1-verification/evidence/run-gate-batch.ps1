# Six consecutive green full gate runs, and the batch driver that produced the logs.
#
# WHY THIS IS IN THE REPOSITORY, and it is not a filing habit:
#
# Eleven entries in this change's tasks.md reported their figures as "corroborated from the six logs by
# separate code", naming a script each time. Round 10 established that none of those scripts existed as
# repository files — `git grep -l gateruns` returned nothing. Every batch entry was therefore
# self-reported by the tool that produced it, which is the arrangement `verify-gateruns7.mjs` was created
# to replace, reintroduced one level up. So both halves of the evidence now ship: this driver, which
# produces the logs, and `verify-gate-batch.mjs`, which checks them.
#
# ## Why the log directory is a parameter and not a constant
#
# A checker hard-coded to one author's temporary directory is not runnable by the person reading it, which
# is the same defect as not shipping it. Both the log directory and the frontend path are arguments here.
#
# ## Two Windows-specific traps this script works around, both of which produced false evidence once
#
# 1. **ANSI stripping used a PowerShell `` `e `` escape.** That is PowerShell 6+; Windows PowerShell 5.1
#    does not have it, so the escape sequences were left in the text and the summary line did not match.
#    `[char]27` is the ESC byte and works everywhere.
# 2. **`Tee-Object` writes UTF-16LE on Windows PowerShell 5.1**, and a parser reading that log as UTF-8
#    sees half the characters as NULs — so `Test Files` is not *findable*, and a log full of passing tests
#    reads as an empty one. That is why the logs are written with `[System.IO.File]::WriteAllText` and an
#    explicit UTF-8 encoding here, and why `verify-gate-batch.mjs` asserts 0 NUL bytes and 0 U+FFFD per log.
#
# ## Usage
#
#   pwsh -File run-gate-batch.ps1 -LogDir <directory> [-Runs 6]
#
# Run it from the repository root. It drives `npm run gate`, which builds before it tests — that ordering
# is load-bearing, because `motion-budget.test.ts`'s six size rules need a build report and skip without
# one (21 with, 15 + 6 skipped without). A run that reports 15 there is missing its build, not failing.

param(
    [Parameter(Mandatory = $true)]
    [string]$LogDir,

    [int]$Runs = 6
)

$ErrorActionPreference = "Continue"

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$encoding = New-Object System.Text.UTF8Encoding($false)
$escape = [char]27

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$summary = @()

for ($run = 1; $run -le $Runs; $run += 1) {
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()

    # Captured to a variable and written afterwards, never piped: piping into `Select-Object -First` closes
    # the pipeline, kills npm, and reports a broken pipe beside output that looks like ordinary passing
    # test activity. That happened once, and `exit -1` next to green test lines is indistinguishable from a
    # hang.
    $raw = (& npm.cmd run gate 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
    $stopwatch.Stop()

    $clean = $raw -replace "$escape\[[0-9;]*m", ""
    $logPath = Join-Path $LogDir "run$run.log"
    [System.IO.File]::WriteAllText($logPath, $clean, $encoding)

    # Markers are located as strings before any number is read from their region. A number parsed out of a
    # region not yet known to contain its marker is how a working log gets reported as an empty one.
    $filesAt = $clean.IndexOf("Test Files")
    $budgetAt = $clean.IndexOf("tests/motion-budget.test.ts")
    $files = if ($filesAt -ge 0) { [regex]::Match($clean.Substring($filesAt), "(\d+) passed").Groups[1].Value } else { "?" }
    $budget = if ($budgetAt -ge 0) { [regex]::Match($clean.Substring($budgetAt), "\((\d+) tests?\)").Groups[1].Value } else { "?" }
    $skipped = [regex]::Match($clean, "(\d+) skipped").Groups[1].Value
    $testsAt = ($clean -split "`n" | Where-Object { $_ -match "Tests\s+.*\(\d+\)\s*$" } | Select-Object -Last 1)
    $tests = if ($testsAt) { [regex]::Match($testsAt, "\((\d+)\)\s*$").Groups[1].Value } else { "?" }

    $line = "run $run  exit $exitCode  $([Math]::Round($stopwatch.Elapsed.TotalSeconds))s  files $files  tests $tests  motion-budget $budget  skipped $(if ($skipped) { $skipped } else { 'none' })  log $logPath"
    Write-Host $line
    $summary += $line
}

Write-Host ""
Write-Host "distinct suite totals:   $((($summary | ForEach-Object { if ($_ -match 'tests (\d+)') { $Matches[1] } }) | Sort-Object -Unique) -join ', ')"
Write-Host "distinct file counts:    $((($summary | ForEach-Object { if ($_ -match 'files (\d+)') { $Matches[1] } }) | Sort-Object -Unique) -join ', ')"
Write-Host "distinct motion-budget:  $((($summary | ForEach-Object { if ($_ -match 'motion-budget (\d+)') { $Matches[1] } }) | Sort-Object -Unique) -join ', ')"
Write-Host ""
Write-Host "Now verify the logs with the checker that ships beside this script:"
Write-Host "  node `"$(Join-Path $PSScriptRoot 'verify-gate-batch.mjs')`" `"$LogDir`" --frontend `"$(Join-Path $repoRoot 'frontend')`""