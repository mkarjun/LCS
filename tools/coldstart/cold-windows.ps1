<#
.SYNOPSIS
    Cold-machine first-run test, layer 3: the Windows installer, as far as a
    machine that already has Docker Desktop can take it.

.DESCRIPTION
    This is the layer that cannot be honestly automated here, and the script
    says so rather than implying coverage it does not have.

    WHAT THIS TESTS
      * The machine check and the plan it shows before touching anything.
      * That an already-present Docker Desktop is detected and its install skipped.
      * Launcher install, PATH entry, Start Menu and Desktop shortcuts.
      * The lcs command: up, status, console reachable, down.

    WHAT IT CANNOT TEST, ON THIS MACHINE OR ANY MACHINE THAT ALREADY HAS DOCKER
      * Installing Docker Desktop. That branch -- download, code-signing
        verification, elevation, WSL2 enablement, the reboot it can require --
        is the riskiest part of the installer and is skipped entirely whenever
        Docker is already present. It needs a genuinely fresh Windows box.
      * The graphical front-end (LCS-Setup.exe with its window), which is what
        most users will actually run.
      * Behaviour when the machine is below the supported build, or on arm64.

    The installer ships no uninstaller, so this script records what it changed
    and puts it back. Run with -KeepInstall to leave it in place.

.PARAMETER KeepInstall
    Leave the installation on the machine instead of reverting it.

.PARAMETER PlanOnly
    Only run the read-only machine check. Changes nothing.
#>
[CmdletBinding()]
param(
    [switch]$KeepInstall,
    [switch]$PlanOnly
)

$ErrorActionPreference = 'Continue'

$RepoRoot   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Installer  = Join-Path $RepoRoot 'tools\windows\lcs-install.ps1'
$InstallDir = Join-Path $env:LOCALAPPDATA 'LCS'
$StartMenu  = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\LCS'
$Desktop    = [Environment]::GetFolderPath('Desktop')
$WorkDir    = if ($env:COLD_WORK_DIR) { $env:COLD_WORK_DIR } else { Join-Path $env:TEMP 'lcs-coldstart' }
$Report     = Join-Path $WorkDir 'cold-windows-report.txt'

$script:Checks   = 0
$script:Failures = 0

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
Set-Content -Path $Report -Value '' -Encoding utf8

function Write-Step { param($m) Write-Host ''; Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Info { param($m) Write-Host "    $m" }
function Write-Dim  { param($m) Write-Host "    $m" -ForegroundColor DarkGray }
function Write-Warn { param($m) Write-Host "    $m" -ForegroundColor Yellow }

function Add-Pass {
    param($m)
    $script:Checks++
    Write-Host "    PASS  $m" -ForegroundColor Green
    Add-Content -Path $Report -Value "PASS  $m"
}
function Add-Fail {
    param($m)
    $script:Checks++; $script:Failures++
    Write-Host "    FAIL  $m" -ForegroundColor Red
    Add-Content -Path $Report -Value "FAIL  $m"
}
function Add-Gap {
    param($m)
    Write-Host "    untestable here: $m" -ForegroundColor Yellow
    Add-Content -Path $Report -Value "GAP   $m"
}
function Add-Note {
    param($m)
    Write-Dim $m
    Add-Content -Path $Report -Value "NOTE  $m"
}

# ── Baseline, so anything we add can be taken back off ────────────────────────

function Get-UserPath { [Environment]::GetEnvironmentVariable('Path', 'User') }

$script:PathBefore       = Get-UserPath
$script:InstallDirBefore = Test-Path $InstallDir
$script:StartMenuBefore  = Test-Path $StartMenu
$script:DesktopLnkBefore = Test-Path (Join-Path $Desktop 'Start LCS.lnk')

Write-Host ''
Write-Host '  LCS cold-machine first-run test - layer 3 (Windows installer)' -ForegroundColor White
Write-Dim  "  Docker Desktop is already installed here, so the dependency branch is skipped."

# ── The machine check ─────────────────────────────────────────────────────────

Write-Step 'The plan the installer shows before touching anything'

$plan = & pwsh -NoProfile -ExecutionPolicy Bypass -File $Installer -Stage Plan 2>&1 | Out-String
Set-Content -Path (Join-Path $WorkDir 'windows-plan.log') -Value $plan -Encoding utf8

if ($LASTEXITCODE -eq 0) { Add-Pass 'the plan stage ran and changed nothing' }
else { Add-Fail "the plan stage exited $LASTEXITCODE" }

if ($plan -match 'Supported') { Add-Pass 'this machine was recognised as supported' }
else { Add-Fail 'the machine check did not report this machine as supported' }

if ($plan -match 'Docker Desktop' -and $plan -match 'Install Docker Desktop') {
    Add-Fail 'the plan proposes installing Docker Desktop even though it is already present'
} else {
    Add-Pass 'an existing Docker Desktop is detected and its install is not proposed'
}

if ($plan -match '127\.0\.0\.1') {
    Add-Pass 'the plan states the loopback-only bind before installing'
} else {
    Add-Fail 'the plan does not mention the loopback-only bind'
}

Add-Gap 'installing Docker Desktop: download, signature check, elevation, WSL2, reboot'
Add-Gap 'the LCS-Setup.exe graphical front-end, which is what most users run'
Add-Gap 'unsupported Windows builds and arm64 hosts'

if ($PlanOnly) {
    Write-Step 'Plan-only run; nothing was installed'
    Write-Host ''
    Write-Host "  Checks: $script:Checks, failures: $script:Failures" -ForegroundColor White
    Write-Host ''
    exit $script:Failures
}

# ── The install itself ────────────────────────────────────────────────────────

Write-Step 'Running the installer (per-user, no elevation)'

$installLog = Join-Path $WorkDir 'windows-install.log'
$out = & pwsh -NoProfile -ExecutionPolicy Bypass -File $Installer -Silent -NoStart 2>&1 | Out-String
Set-Content -Path $installLog -Value $out -Encoding utf8
$installRc = $LASTEXITCODE

if ($installRc -eq 0) { Add-Pass 'the installer completed (exit 0)' }
else {
    Add-Fail "the installer exited $installRc"
    ($out -split "`n" | Select-Object -Last 12) | ForEach-Object { Write-Dim $_.TrimEnd() }
}

if (Test-Path (Join-Path $InstallDir 'lcs.cmd')) { Add-Pass 'lcs.cmd installed' }
else { Add-Fail "lcs.cmd is missing from $InstallDir" }

if (Test-Path (Join-Path $InstallDir 'lcs.ps1')) { Add-Pass 'lcs.ps1 installed' }
else { Add-Fail "lcs.ps1 is missing from $InstallDir" }

if ((Get-UserPath) -split ';' -contains $InstallDir) {
    Add-Pass 'the install directory was added to the user PATH'
} else {
    Add-Fail 'the install directory is not on the user PATH'
}

$shortcuts = @(
    (Join-Path $StartMenu 'Start LCS.lnk'),
    (Join-Path $StartMenu 'Stop LCS.lnk'),
    (Join-Path $StartMenu 'LCS Console.lnk')
)
$missing = $shortcuts | Where-Object { -not (Test-Path $_) }
if ($missing.Count -eq 0) { Add-Pass 'Start Menu shortcuts created' }
else { Add-Fail "missing Start Menu shortcuts: $($missing -join ', ')" }

if (Test-Path (Join-Path $Desktop 'Start LCS.lnk')) { Add-Pass 'Desktop shortcut created' }
else { Add-Fail 'the Desktop shortcut was not created' }

# ── The launcher ──────────────────────────────────────────────────────────────

Write-Step 'Driving the installed lcs command'

$lcs = Join-Path $InstallDir 'lcs.cmd'
if (Test-Path $lcs) {
    $image = if ($env:COLD_IMAGE) { $env:COLD_IMAGE } else { 'mkarjun/lcs:latest' }
    $haveImage = $(docker image inspect $image 2>$null; $LASTEXITCODE -eq 0)

    if (-not $haveImage) {
        Add-Note "no $image on this machine, so lcs up was not exercised"
    } else {
        $upLog = Join-Path $WorkDir 'windows-lcs-up.log'
        $up = & $lcs up 2>&1 | Out-String
        Set-Content -Path $upLog -Value $up -Encoding utf8

        if ($LASTEXITCODE -eq 0) { Add-Pass 'lcs up succeeded' }
        else {
            Add-Fail "lcs up exited $LASTEXITCODE"
            ($up -split "`n" | Select-Object -Last 10) | ForEach-Object { Write-Dim $_.TrimEnd() }
        }

        $console = $null
        try {
            $console = Invoke-WebRequest -Uri 'http://127.0.0.1:4566/_lcs/ui/' -TimeoutSec 20 -UseBasicParsing
        } catch { }
        if ($console -and $console.StatusCode -eq 200) {
            Add-Pass 'the console answered on 127.0.0.1:4566 after lcs up'
        } else {
            Add-Fail 'the console did not answer after lcs up'
        }

        $status = & $lcs status 2>&1 | Out-String
        if ($status -match 'running|ready|up') { Add-Pass 'lcs status reports a running instance' }
        else { Add-Fail 'lcs status did not report a running instance' }

        & $lcs down 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Add-Pass 'lcs down stopped and removed the container' }
        else { Add-Fail "lcs down exited $LASTEXITCODE" }
    }
}

# ── Put the machine back ──────────────────────────────────────────────────────

Write-Step 'Reverting (the installer ships no uninstaller)'

if ($KeepInstall) {
    Write-Warn 'KeepInstall was set; leaving the installation in place.'
} else {
    if (-not $script:InstallDirBefore -and (Test-Path $InstallDir)) {
        Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
        Write-Info "removed $InstallDir"
    }
    if (-not $script:StartMenuBefore -and (Test-Path $StartMenu)) {
        Remove-Item -Recurse -Force $StartMenu -ErrorAction SilentlyContinue
        Write-Info "removed $StartMenu"
    }
    $desktopLnk = Join-Path $Desktop 'Start LCS.lnk'
    if (-not $script:DesktopLnkBefore -and (Test-Path $desktopLnk)) {
        Remove-Item -Force $desktopLnk -ErrorAction SilentlyContinue
        Write-Info "removed $desktopLnk"
    }
    if ((Get-UserPath) -ne $script:PathBefore) {
        [Environment]::SetEnvironmentVariable('Path', $script:PathBefore, 'User')
        Write-Info 'restored the user PATH'
    }
    Add-Note 'reverted by this script by hand; there is no supported uninstall path'
}

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Step 'Windows layer summary'
Write-Host ''
Write-Host "  Checks: $script:Checks, failures: $script:Failures" -ForegroundColor White
Write-Host "  Report: $Report" -ForegroundColor DarkGray
Write-Host ''
Write-Warn 'The Docker Desktop install branch is the real cold-Windows risk and is'
Write-Warn 'not covered by this run. It needs a fresh Windows machine.'
Write-Host ''

exit $script:Failures
