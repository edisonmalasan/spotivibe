# CANONICAL COPY - this is the runnable gate-batch apparatus.
#
#     frontend/scripts/gate-batch/run-gate-batch.ps1
#     frontend/scripts/gate-batch/verify-gate-batch.mjs
#
# A byte-identical pair exists at
# openspec/changes/archive/2026-10-05-harden-post-v1-verification/evidence/ and is **deliberately
# NOT repaired**. It is M21's frozen record of what that milestone shipped; editing it would destroy
# that record while making the defect invisible to the next reader. Do not run the archived copies.
#
# **The archived copies cannot run, and that is the defect repaired here.** Their root computation
# counts four parent directories from their own location - a count that was correct while the owning
# change sat at `openspec/changes/<change>/evidence` and became wrong the moment archiving inserted
# `archive/` beneath `changes/`, at which point the same arithmetic resolves to `<root>/openspec` and
# this script's own guard exits 1. Run the copies here, which resolve the repository root by walking
# up to a marker instead of counting levels.
#
# ---------------------------------------------------------------------------------------------
#
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
#   powershell -File run-gate-batch.ps1 -LogDir <directory> [-Runs 6]
#
# **The interpreter is `powershell`, not `pwsh`.** The archived copy's usage block said `pwsh -File`,
# which does not exist on a machine with only Windows PowerShell 5.1 - and 5.1 is what this script's
# body is written for, deliberately avoiding `` `e `` and `Tee-Object`` for exactly the 5.1 failures
# documented above. Its prose and its code disagreed about the interpreter, so a reader following the
# printed interface hit a wall. `pwsh` (PowerShell 7+) also runs this script if you have it; the
# printed form names the one that is actually present.
#
# Run it from the repository root. It drives `npm run gate`, which builds before it tests — that ordering
# is load-bearing, because `motion-budget.test.ts`'s six size rules need a build report and skip without
# one (21 with, 15 + 6 skipped without). A run that reports 15 there is missing its build, not failing.
#
# ### `-Runs 0` is a dry mode, and it is not evidence
#
#   powershell -File run-gate-batch.ps1 -LogDir <directory> -Runs 0
#
# Resolves the repository root and prints the command that completes the workflow, **without invoking
# the gate once**. It exists because a batch is roughly twenty minutes and the resolution and the
# printed interface are the two things that most need to be checkable in seconds.
#
# **A dry run is not criterion evidence and produces no logs.** It prints a `DRY RUN` line saying so,
# because the alternative is a green exit 0 from zero gate runs being read as a batch. The
# corroborator still demands as many logs as it is told to, so a dry run cannot corroborate anything.

param(
    [Parameter(Mandatory = $true)]
    [string]$LogDir,

    [int]$Runs = 6
)

$ErrorActionPreference = "Continue"

$evidenceDir = $PSScriptRoot

# **Repaired: the root is located by walking up to a marker, not by counting levels.**
#
# The previous arithmetic applied `Split-Path -Parent` a fixed four times and asserted the result
# looked like a repository root. That count described ONE storage layout -
# `<repo>/openspec/changes/<change>/evidence` - and archiving inserts `archive/` beneath `changes/`,
# so the identical arithmetic resolves to `<repo>/openspec` and the guard below correctly refuses.
# The guard was never the defect; the count it was checking was. A level count is a property of a
# directory layout, and this repository's lifecycle moves these files without asking the script.
#
# `frontend\package.json` is a property of the repository instead. It exists in every layout the tool
# can be stored in, so relocating the tool - including the relocation that archiving performs - can no
# longer change whether it runs. `tests/gate-batch-apparatus.test.ts` asserts the same root is
# resolved from three different nesting depths, which is the check the old comment could not be.
$examined = @()
$repoRoot = $null
$probe = $evidenceDir
while ($true) {
    $examined += $probe
    if (Test-Path (Join-Path (Join-Path $probe "frontend") "package.json")) {
        $repoRoot = $probe
        break
    }
    $parent = Split-Path -Parent $probe
    # A parent equal to the probe means the filesystem root is reached; `Split-Path` returns the
    # input unchanged there rather than throwing, so the loop must be broken explicitly.
    if (-not $parent -or $parent -eq $probe) { break }
    $probe = $parent
}
if (-not $repoRoot) {
    Write-Host "FAIL no repository root found: no frontend\package.json at or above $evidenceDir"
    Write-Host "     (examined, nearest first: $($examined -join ' -> '))"
    exit 1
}
$markerRelative = Join-Path "frontend" "package.json"
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
# **Set ONCE, above the loop, and frozen into `$header`. Rounds 13-15 are why the freezing matters.**
#
# Rounds 14 and 15 each tried to pin "resolved once, outside the loop" by reading this file's text, and
# each pin was escaped by a *different* parse-valid rewrite: moving the resolution inside the loop, a decoy
# `$commit` above it, `Set-Variable -Name commit`, `Set-Item -Path variable:commit`, `${commit} =`, a decoy
# `for ($run`, and a column-0 closing brace that truncates any text-scanned loop body. **Three syntactic
# rungs, seven escapes** - and this comment first said "seven rungs, seven escapes" above an eight-row
# table, which round 16's NIT 1 correctly found unreproducible. The reason the count matters is that a
# ladder is a thing you can point at and count; an uncountable one cannot be shown to have grown.
# The reason the escapes stop is structural rather than a matter of not trying hard enough:
# **PowerShell can assign a variable many ways, and no spelling test can enumerate them.**
#
# So nothing here asserts where this resolution happens. The string is built ONCE and the per-run write
# consumes `$header` verbatim. Reassigning `$commit` inside the loop now **cannot affect the logs at all**,
# whatever syntax is used to do it — not "is detected", but "is inert". The data flow enforces it rather
# than a check asserting it about the syntax, which is what the three previous rungs failed to do.
#
# **Scope, narrowed by round 16's WARNING 1 and its mutation E.** The sentence above is true of `$commit`
# and of nothing else. Assigning `$header` *itself* from a loop-dependent value is not an assignment to
# `$commit`, nothing here enumerates it, and round 16 built that variant and this suite stayed green. It is
# not a defect in this driver, which does not do it — and it does not survive verification either, because a
# batch whose six logs are stamped `run1`…`run6` names six commits and `verify-gate-batch.mjs` refuses it
# with a non-zero exit. **Two layers: the data flow makes reassigning `$commit` inert, and the
# corroborator's commit-distinctness rule makes a per-run-varying stamp unusable. Neither layer is
# claimed to be exhaustive, and neither is claimed to be the only one.**
#
# Round 15 is recorded as the reason. It is also the reason `tests/evidence-scripts.test.ts` no longer
# tries to check the position of this resolution at all: the check that would fail is one that cannot be
# written, so the file asserts what CAN be observed — that the header carries a commit line, and that the
# stamp's absence is fatal to the corroborator — and says so where a reader will look for it.
$commit = "unknown"
try {
    $described = & git -C $repoRoot rev-parse --short=12 HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and $described) { $commit = ($described | Out-String).Trim() }
} catch {
    $commit = "unknown"
}
# Frozen. The loop below reads this string, not `$commit`.
# `$commit` is frozen into this string ONCE. The exit status is deliberately NOT frozen: it is per-run by
# nature, so freezing it would be wrong. Only the commit is constant across a batch, and only the commit
# is what a straddling batch needs to be caught by.
$header = "commit $commit"
Write-Host "commit under test: $commit"

# **A dry run is announced, because a green exit from zero gate runs is otherwise unreadable.**
# `$Runs -lt 1` skips the loop entirely, which was already true and was undocumented. It is now stated,
# and the line below exists so that nobody can read a dry run's exit 0 as a batch. The corroborator is
# the second layer: it demands as many logs as it is told to, and a dry run writes none, so no dry run
# can corroborate anything. `tests/gate-batch-apparatus.test.ts` asserts this line is present when
# `$Runs` is below 1 and absent otherwise - present-and-absent, because a line that is always printed
# would be as useless as one never printed.
if ($Runs -lt 1) {
    Write-Host "DRY RUN - no gate was invoked - this is not criterion evidence"
}

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
    # `$header` was frozen above the loop, so this line records the commit the batch was *started* at no
    # matter what happens to `$commit` inside the loop. See the long comment on `$header`.
    [System.IO.File]::WriteAllText($logPath, "gate exit$exitCode`n$header`n$clean", $encoding)

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
Write-Host "repository root resolved by walking up to ${markerRelative}: $repoRoot"
Write-Host "  (examined, nearest first: $($examined -join ' -> '))"
Write-Host ""
Write-Host "Now verify the logs with the checker that ships beside this script:"
# **Round 11's NIT 1: the printed interface omitted `--runs`.** The script's own header calls a printed path
# an interface that is only correct if something runs it - and it was correct only for `-Runs 6`, because the
# checker's default is 6. A `-Runs 3` batch printed a command that then failed loudly on four unexamined
# logs. Loud beats silent, so this was a NIT and not a WARNING, but the interface was wrong for every
# non-default value, which is the whole of what an interface is for.
Write-Host "  node `"$(Join-Path $PSScriptRoot 'verify-gate-batch.mjs')`" `"$LogDir`" --frontend `"$(Join-Path $repoRoot 'frontend')`" --runs $Runs"