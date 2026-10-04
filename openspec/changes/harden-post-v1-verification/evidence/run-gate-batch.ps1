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

$evidenceDir = $PSScriptRoot
$changeDir = Split-Path -Parent $evidenceDir
$changesDir = Split-Path -Parent $changeDir
$openspecDir = Split-Path -Parent $changesDir
# FOUR parents, not three. `$PSScriptRoot` is `<repo>/openspec/changes/<change>/evidence`, so three
# `Split-Path -Parent` calls land on `<repo>/openspec` and print a path that does not exist. That is not
# hypothetical: the first run of this driver printed `--frontend <repo>\openspec\frontend`, the reviewer
# followed it, and the checker then reported a phase as UNAVAILABLE and exited 0 - which
# `verify-gate-batch.mjs` has now been repaired to refuse. The path a script prints is an interface, and it
# is only correct if something runs it.
#
# Asserted rather than assumed, because the number of levels is the thing that was wrong once already and a
# comment saying "four" is not a check that there are four.
$repoRoot = Split-Path -Parent $openspecDir
if (-not (Test-Path (Join-Path $repoRoot "frontend\package.json"))) {
    Write-Host "FAIL the computed repository root is not a repository root: $repoRoot"
    Write-Host "     (expected <root>\frontend\package.json beneath it, from evidence dir $evidenceDir)"
    exit 1
}
$encoding = New-Object System.Text.UTF8Encoding($false)
$escape = [char]27

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$summary = @()

# **Round 13's WARNING 1: the log did not say which commit it ran against.** Six logs carrying every green
# figure still cannot be tied to a commit by their own contents, so a criterion claim about "the tree at
# <commit>" rests on timestamps and arithmetic. Batch 16's logs predate this stamp and therefore cannot
# acquire it - this binds future batches only, and that limitation is recorded at `tasks.md` 8.30 rather
# than papered over by a stamp added too late.
#
# Resolved ONCE, above the loop, so all six logs of a batch name the same commit. Inside the loop it would
# re-resolve per run, and a batch that spanned a commit change would stamp all six logs with whatever HEAD
# was last seen - a batch appearing to be six runs of one tree when it was six runs of two.
#
# `git` absent, or a detached/unborn HEAD, yields `unknown` rather than a plausible-looking guess. A stamp
# reading `unknown` proves the driver ran and does not prove what it ran against, so the checker requires
# presence and not informativeness - see its own comment for why refusing `unknown` would be wrong.
$commit = "unknown"
try {
    $described = & git -C $repoRoot rev-parse --short=12 HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and $described) { $commit = ($described | Out-String).Trim() }
} catch {
    $commit = "unknown"
}
Write-Host "commit under test: $commit"

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
    # **Round 11's WARNING 3: the criterion is six consecutive GREEN runs, and the exit status had no
    # artefact anywhere.** `$exitCode` went to the console and the log received the gate's stdout and
    # nothing else, so the checker could confirm the figures and never the verdict. Measured: a log carrying
    # every green figure plus a trailing `npm error code 1` was corroborated, exit 0.
    #
    # It is written as a leading marker line rather than appended, so it cannot be confused with the gate's
    # own output and so a reader sees it before reading anything the gate claimed. The checker refuses a log
    # without one rather than defaulting it, because "absent" and "green" must not collapse.
    [System.IO.File]::WriteAllText($logPath, "gate exit$exitCode`ncommit $commit`n$clean", $encoding)

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
Write-Host "repository root computed from evidence dir: $repoRoot"
Write-Host ""
Write-Host "Now verify the logs with the checker that ships beside this script:"
# **Round 11's NIT 1: the printed interface omitted `--runs`.** The script's own header calls a printed path
# an interface that is only correct if something runs it - and it was correct only for `-Runs 6`, because the
# checker's default is 6. A `-Runs 3` batch printed a command that then failed loudly on four unexamined
# logs. Loud beats silent, so this was a NIT and not a WARNING, but the interface was wrong for every
# non-default value, which is the whole of what an interface is for.
Write-Host "  node `"$(Join-Path $PSScriptRoot 'verify-gate-batch.mjs')`" `"$LogDir`" --frontend `"$(Join-Path $repoRoot 'frontend')`" --runs $Runs"