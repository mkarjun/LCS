<#
.SYNOPSIS
    Installs LCS and everything it needs on Windows.

.DESCRIPTION
    Driven by LCS-Setup.exe, which embeds this script. Runnable directly for scripted
    installs.

    Runs in stages so elevation is scoped as narrowly as possible:

      All          (default, as the signed-in user) preflight, consent, then hand the
                   dependency work to an elevated child process, then install LCS itself
                   and start it.
      Dependencies (elevated) install WSL2 and Docker Desktop, and nothing else.
      Plan         (read-only) report what an install would do, and change nothing.

    Splitting All and Dependencies matters: if the whole installer ran elevated,
    $env:LOCALAPPDATA, the Start Menu, and the Desktop would all resolve to the
    administrator's profile, and the user would end up with an install and shortcuts they
    cannot see.

.PARAMETER Stage
    All (default), Dependencies, or Plan. Dependencies requires an elevated session and is
    what the All stage relaunches. Plan only probes.

.PARAMETER Silent
    Skip the confirmation screen. Implies consent to install Docker Desktop and accept its
    licence terms, so only use it for unattended provisioning.

.PARAMETER InstallDir
    Where the launcher goes. Defaults to %LOCALAPPDATA%\LCS. Per-user, so no admin rights
    are needed for this part.

.PARAMETER Image
    LCS image to run. Defaults to lcs/lcs:merged.

.PARAMETER SkipDependencies
    Do not touch WSL2 or Docker. Fails if Docker is not already working.

.PARAMETER NoStart
    Install, but do not start LCS at the end.

.PARAMETER Ui
    Emit machine-readable progress lines (@@LCS|...) alongside the normal output, and take
    no input. LCS-Setup.exe sets this and turns those lines into the graphical installer;
    the human-readable output stays exactly as it is, and becomes the details view.

.PARAMETER UiLog
    File the Dependencies stage mirrors its output into, so the graphical installer can follow
    elevated work that has no pipe back to it. The All stage passes this down to the elevated
    child; it never writes the file itself.

.PARAMETER BuildFromSource
    Build the image from a repository checkout if it cannot be obtained any other way.
    Takes 10-20 minutes, so -Ui never does it unless asked.
#>
[CmdletBinding()]
param(
    [ValidateSet('All', 'Dependencies', 'Plan')]
    [string]$Stage = 'All',

    [switch]$Silent,
    [switch]$Ui,
    [string]$UiLog,
    [switch]$BuildFromSource,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'LCS'),
    [string]$Image = 'lcs/lcs:merged',
    [switch]$SkipDependencies,
    [switch]$NoStart,
    [int]$DaemonTimeoutSeconds = 240,

    # Where to look for lcs-image.tar[.gz]. LCS-Setup.exe extracts these scripts to a temp
    # directory and passes its own location here, so a bundle's image archive is found
    # beside the exe rather than beside the extracted script.
    [string]$PayloadDir = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$script:ProductName = 'LCS'

# Official Docker download hosts. Kept in one place so there is exactly one thing to audit
# when asking "where does this installer fetch code from".
$script:DockerDesktopUrls = @{
    'x64'   = 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe'
    'arm64' = 'https://desktop.docker.com/win/main/arm64/Docker%20Desktop%20Installer.exe'
}

# The elevated stage has no pipe back to the graphical installer: -Verb RunAs needs
# ShellExecute to raise the UAC prompt, and that cannot hand back a redirected stream. So when
# it is given a log it writes every line it prints into that file as well, and the front-end
# follows it. Without this, installing Docker Desktop is five minutes of a window sitting
# still.
#
# The file is written here rather than by redirecting the child's output because Windows
# PowerShell's Tee-Object and > both write UTF-16 and wrap at the console width - either of
# which turns a protocol line into something the reader cannot parse.
$script:Mirror = ($Stage -eq 'Dependencies') -and $UiLog

function Write-Mirror {
    param([string]$Text)
    if (-not $script:Mirror) { return }
    try {
        [IO.File]::AppendAllText($UiLog, $Text + "`r`n", (New-Object Text.UTF8Encoding($false)))
    } catch {
        # A locked log must never fail an install that is otherwise going fine.
    }
}

function Write-Step { param($m) Write-Host "==> $m" -ForegroundColor Cyan; Write-Mirror "==> $m" }
function Write-Ok   { param($m) Write-Host "    $m" -ForegroundColor Green; Write-Mirror "    $m" }
function Write-Info { param($m) Write-Host "    $m"; Write-Mirror "    $m" }
function Write-Warn { param($m) Write-Host "    $m" -ForegroundColor Yellow; Write-Mirror "    $m" }
function Write-Err  { param($m) Write-Host "    $m" -ForegroundColor Red; Write-Mirror "    $m" }

# Anything that would otherwise ask a question has to check this. -Ui installs have already
# taken their answers in the graphical front-end, so a Read-Host there would hang a window
# with no console attached to type into.
$script:Interactive = -not ($Silent -or $Ui)

# ── Progress protocol ─────────────────────────────────────────────────────────
#
# One line per event, pipe-delimited, on stdout among the ordinary output:
#
#   @@LCS|FACT|arch|x64                        a fact about this machine
#   @@LCS|STEPS|checks:Checks|wsl:WSL2         the steps an install will work through
#   @@LCS|PLAN|docker|Install Docker...|~600MB a thing the install will do (Plan stage)
#   @@LCS|STEP|docker|Installing Docker        this step started
#   @@LCS|STATUS|Downloading 218/604 MB|36     detail for the current step, percent or -1
#   @@LCS|STEPDONE|docker|ok                   ok | skip | warn | fail
#   @@LCS|SUMMARY|Console  http://...          a line of the closing summary
#   @@LCS|DONE|ok|LCS is running               ok | restart | incomplete | fail
#
# Deliberately one-directional and line-based: the front-end is a reader of this script's
# output, never a second implementation of its logic, so the two cannot disagree about what
# an install does.
function Write-Ui {
    param([Parameter(Mandatory)][string]$Kind, [string[]]$Fields = @())
    if (-not $Ui) { return }

    # A newline would fake a second event and a pipe would fake a field, so neither
    # survives into a message. Nothing in the text needs them.
    $clean = @($Fields | ForEach-Object { (($_ -replace '[\r\n|]', ' ') -replace '\s+', ' ').Trim() })
    $line = "@@LCS|$Kind|" + ($clean -join '|')
    Write-Host $line
    Write-Mirror $line
}

function Start-UiStep {
    param([string]$Key, [string]$Label)
    $script:UiStep = $Key
    Write-Ui 'STEP' @($Key, $Label)
}

# Percent -1 means "no idea how long this takes", which the front-end shows as a moving
# indeterminate bar rather than a lie about progress.
function Write-UiStatus {
    param([string]$Text, [int]$Percent = -1)
    Write-Ui 'STATUS' @($Text, [string]$Percent)
}

function Complete-UiStep {
    param([ValidateSet('ok', 'skip', 'warn', 'fail')][string]$State = 'ok')
    if (-not $script:UiStep) { return }
    Write-Ui 'STEPDONE' @($script:UiStep, $State)
    $script:UiStep = $null
}

# ── Environment ───────────────────────────────────────────────────────────────

function Test-Elevated {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Architecture {
    switch ($env:PROCESSOR_ARCHITECTURE) {
        'AMD64' { return 'x64' }
        'ARM64' { return 'arm64' }
        'x86'   { return 'x86' }
        default { return $env:PROCESSOR_ARCHITECTURE }
    }
}

# Runs a native command without letting its stderr abort the script.
#
# $ErrorActionPreference = 'Stop' makes PowerShell 7 treat native stderr as terminating, so
# probes whose failure is a normal answer ("is Docker there?") must go through this.
function Invoke-Native {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @()
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $FilePath @Arguments 2>&1
        return [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output   = ($output | Out-String).Trim()
        }
    } catch {
        return [pscustomobject]@{ ExitCode = -1; Output = $_.Exception.Message }
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Test-Preflight {
    Write-Step 'Checking this machine'
    Start-UiStep 'checks' 'Checking this machine'

    $os    = Get-CimInstance Win32_OperatingSystem
    $build = [int](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuildNumber
    $arch  = Get-Architecture

    Write-Info "$($os.Caption) (build $build, $arch)"
    Write-Ui 'FACT' @('os', "$($os.Caption) (build $build)")
    Write-Ui 'FACT' @('arch', $arch)
    Write-Ui 'FACT' @('memory', "$([math]::Round($os.TotalVisibleMemorySize / 1MB)) GB RAM")

    if ($arch -eq 'x86') {
        throw "32-bit Windows is not supported: Docker Desktop requires 64-bit x64 or arm64."
    }
    if (-not $script:DockerDesktopUrls.ContainsKey($arch)) {
        throw "No Docker Desktop build for architecture '$arch'."
    }

    # Docker Desktop's WSL2 backend needs Windows 10 2004 (build 19041) or newer. Below
    # that the install appears to succeed and then the daemon never starts.
    if ($build -lt 19041) {
        throw @"
Windows 10 version 2004 (build 19041) or newer is required; this machine is build $build.

Docker Desktop's WSL2 backend does not exist on older builds. Update Windows, then run
this installer again.
"@
    }

    if ($build -lt 19045) {
        Write-Warn "Build $build is older than Windows 10 22H2. Docker Desktop should work but is no longer tested on it."
    }

    Write-Ok 'Supported.'
    Complete-UiStep 'ok'
    return [pscustomobject]@{ Build = $build; Architecture = $arch }
}

# ── Docker detection ──────────────────────────────────────────────────────────

function Get-DockerStatus {
    $cli = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $cli) {
        # Docker Desktop puts the CLI on PATH, but a shell opened before the install will
        # not see it. Check the canonical location before concluding it is absent.
        $fallback = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'
        if (Test-Path $fallback) {
            $env:Path = "$env:Path;$(Split-Path -Parent $fallback)"
            $cli = Get-Command docker -ErrorAction SilentlyContinue
        }
    }

    if (-not $cli) {
        return [pscustomobject]@{ Installed = $false; DaemonRunning = $false; Version = $null }
    }

    $info = Invoke-Native docker @('info', '--format', '{{.ServerVersion}}')
    return [pscustomobject]@{
        Installed     = $true
        DaemonRunning = ($info.ExitCode -eq 0)
        Version       = if ($info.ExitCode -eq 0) { $info.Output } else { $null }
    }
}

function Get-WslStatus {
    if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{ Present = $false; Version2 = $false }
    }
    # `wsl --status` fails when no kernel is installed, which is exactly the case that
    # needs `wsl --install`.
    $status = Invoke-Native wsl @('--status')
    return [pscustomobject]@{
        Present  = $true
        Version2 = ($status.ExitCode -eq 0)
    }
}

# ── Consent ───────────────────────────────────────────────────────────────────

# The single description of what an install does, so the console prompt, the graphical
# consent screen, and the step rail are all three the same answer to that question.
#
# Each item is one thing that will happen: Key is what the front-end matches a step against,
# Text is the promise, Detail is the caveat behind it.
function Get-InstallPlan {
    param($Machine, $Docker, $Wsl)

    $plan = @()

    if (-not $Wsl.Version2) {
        $plan += [pscustomobject]@{
            Key    = 'wsl'
            Text   = 'Enable the Windows Subsystem for Linux'
            Detail = 'wsl --install --no-distribution. Needs administrator rights, and may ask for a restart.'
        }
    }

    if (-not $Docker.Installed) {
        $plan += [pscustomobject]@{
            Key    = 'docker'
            Text   = 'Install Docker Desktop, about 600 MB, from Docker Inc'
            Detail = "Downloaded from $($script:DockerDesktopUrls[$Machine.Architecture]) and checked against Docker Inc's code-signing certificate before it runs. Needs administrator rights. Free for personal use, education, and small business; larger organisations need a paid subscription, and installing accepts the Docker Desktop licence terms."
        }
    }

    $plan += [pscustomobject]@{
        Key    = 'launcher'
        Text   = "Install the LCS launcher to $InstallDir"
        Detail = 'Per-user, so no administrator rights, plus Start Menu and Desktop shortcuts.'
    }

    if (-not $NoStart) {
        $plan += [pscustomobject]@{
            Key    = 'start'
            Text   = 'Start LCS, listening on 127.0.0.1:4566'
            Detail = 'Local only: LCS accepts any credentials and has no authentication, so it is not published to your network.'
        }
    }

    return $plan
}

# The steps the front-end draws down the side. Ordered the way the install runs them, which
# is not the order of the plan: dependencies come first, and the image after the launcher.
function Get-InstallSteps {
    param($Docker, $Wsl)

    $steps = @([pscustomobject]@{ Key = 'checks'; Label = 'Checks' })
    if ((-not $Wsl.Version2) -or (-not $Docker.Installed)) {
        $steps += [pscustomobject]@{ Key = 'elevate'; Label = 'Permission' }
    }
    if (-not $Wsl.Version2)    { $steps += [pscustomobject]@{ Key = 'wsl';    Label = 'WSL2' } }
    if (-not $Docker.Installed){ $steps += [pscustomobject]@{ Key = 'docker'; Label = 'Docker Desktop' } }
    $steps += [pscustomobject]@{ Key = 'daemon';   Label = 'Docker engine' }
    $steps += [pscustomobject]@{ Key = 'launcher'; Label = 'Launcher' }
    $steps += [pscustomobject]@{ Key = 'image';    Label = 'Emulator image' }
    if (-not $NoStart) { $steps += [pscustomobject]@{ Key = 'start'; Label = 'First start' } }
    return $steps
}

function Write-PlanText {
    param($Plan)

    Write-Host ''
    Write-Host '  This installer will:' -ForegroundColor White
    Write-Host ''
    foreach ($item in $Plan) {
        Write-Host "   * $($item.Text)."
        Write-Host "     $($item.Detail)" -ForegroundColor DarkGray
    }
    Write-Host ''
    Write-Host '  It will not change any other system setting, and installs nothing else.' -ForegroundColor DarkGray
    Write-Host ''
}

function Show-Plan {
    param($Plan)

    Write-PlanText $Plan
    if (-not $script:Interactive) { return $true }

    Write-Host '  Continue? [Y/n] ' -NoNewline
    $answer = Read-Host
    return ([string]::IsNullOrWhiteSpace($answer) -or $answer.Trim().ToLower().StartsWith('y'))
}

# Read-only: probes the machine and reports what an install would do. The graphical
# installer runs this before it draws its first screen, so the consent it collects is for
# the work this script would actually perform on this machine.
function Invoke-PlanStage {
    $machine = Test-Preflight
    $docker  = Get-DockerStatus
    $wsl     = Get-WslStatus

    Write-Ui 'FACT' @('docker', $(if ($docker.DaemonRunning) { "running, $($docker.Version)" } elseif ($docker.Installed) { 'installed, not running' } else { 'not installed' }))
    Write-Ui 'FACT' @('wsl',    $(if ($wsl.Version2) { 'enabled' } else { 'not enabled' }))
    Write-Ui 'FACT' @('image',  $Image)

    # Offered rather than assumed: a checkout means the image can be built, but 10-20
    # minutes is not something to start without being asked.
    $checkout = Find-SourceCheckout
    if ($checkout) { Write-Ui 'FACT' @('checkout', $checkout) }

    $steps = Get-InstallSteps -Docker $docker -Wsl $wsl
    Write-Ui 'STEPS' @($steps | ForEach-Object { "$($_.Key):$($_.Label)" })

    $plan = Get-InstallPlan -Machine $machine -Docker $docker -Wsl $wsl
    foreach ($item in $plan) {
        Write-Ui 'PLAN' @($item.Key, $item.Text, $item.Detail)
    }

    # Printed, not asked: this stage changes nothing, so there is nothing here to consent to.
    if (-not $Ui) { Write-PlanText $plan }

    Write-Ui 'DONE' @('ok', 'Plan complete.')
    return 0
}

# ── Dependency stage (elevated) ───────────────────────────────────────────────

function Install-Wsl {
    Write-Step 'Enabling Windows Subsystem for Linux'
    Start-UiStep 'wsl' 'Enabling the Windows Subsystem for Linux'
    Write-UiStatus 'Installing the WSL2 kernel and platform features'

    # --no-distribution keeps this to the kernel and platform features. Docker Desktop
    # creates its own distro; installing Ubuntu here would be an unrequested extra.
    $result = Invoke-Native wsl @('--install', '--no-distribution')
    if ($result.ExitCode -ne 0) {
        Write-Warn "wsl --install exited $($result.ExitCode):"
        Write-Warn $result.Output
        Write-Warn 'Continuing: Docker Desktop can enable WSL2 itself, and will say so if it cannot.'
        Complete-UiStep 'warn'
        return $false
    }

    Write-Ok 'WSL2 enabled.'
    if ($result.Output -match 'restart|reboot') {
        Write-Warn 'Windows wants a restart to finish enabling WSL2.'
        Complete-UiStep 'warn'
        return $true
    }
    Complete-UiStep 'ok'
    return $false
}

# Downloads to a file while reporting how far along it is.
#
# Invoke-WebRequest is the obvious call and the wrong one here: it reports nothing this
# script can forward to a progress bar, and on Windows PowerShell its own progress rendering
# costs more than the transfer on a 600 MB file.
function Save-HttpFile {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [Parameter(Mandatory)][string]$OutFile,
        [string]$Activity = 'Downloading'
    )

    # Explicit TLS 1.2 so this works on hosts whose default is still older.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $request = [Net.HttpWebRequest]::Create($Uri)
    $request.UserAgent = 'lcs-installer'
    $response = $null
    $stream   = $null
    $output   = $null

    try {
        $response = $request.GetResponse()
        $total    = $response.ContentLength
        $stream   = $response.GetResponseStream()
        $output   = [IO.File]::Create($OutFile)

        $buffer     = New-Object byte[] 131072
        $read       = 0
        $done       = [long]0
        $lastReport = -1

        while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $output.Write($buffer, 0, $read)
            $done += $read

            if ($total -le 0) { continue }
            $percent = [int](100 * $done / $total)
            if ($percent -eq $lastReport) { continue }

            $lastReport = $percent
            $mb = { param($b) [int]($b / 1MB) }
            Write-UiStatus "$Activity - $(& $mb $done) of $(& $mb $total) MB" $percent
        }
    } finally {
        if ($output)   { $output.Dispose() }
        if ($stream)   { $stream.Dispose() }
        if ($response) { $response.Dispose() }
    }
}

function Install-DockerDesktop {
    param([string]$Architecture)

    Write-Step 'Installing Docker Desktop'
    Start-UiStep 'docker' 'Installing Docker Desktop'

    # winget is preferred: it resolves the current version and verifies the package hash
    # and signature itself, so there is no URL or checksum here to go stale.
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info 'Using winget.'
        # winget reports its progress by redrawing a console line, which is not something
        # this script can turn into events, so this half of the step is honestly unknowable.
        Write-UiStatus 'Downloading and installing through winget - about 600 MB'
        $wingetArgs = @(
            'install', '--id', 'Docker.DockerDesktop', '--exact',
            '--accept-package-agreements', '--accept-source-agreements',
            '--disable-interactivity'
        )
        $result = Invoke-Native winget $wingetArgs
        if ($result.ExitCode -eq 0) {
            Write-Ok 'Docker Desktop installed via winget.'
            Complete-UiStep 'ok'
            return
        }
        Write-Warn "winget exited $($result.ExitCode); falling back to a direct download."
        Write-Warn $result.Output
    } else {
        Write-Info 'winget not available; downloading directly.'
    }

    $url     = $script:DockerDesktopUrls[$Architecture]
    $target  = Join-Path $env:TEMP 'DockerDesktopInstaller.exe'

    Write-Info "Downloading $url"
    Write-Info 'This is roughly 600 MB and takes a few minutes.'
    try {
        Save-HttpFile -Uri $url -OutFile $target -Activity 'Downloading Docker Desktop'
    } catch {
        throw "Could not download Docker Desktop: $($_.Exception.Message)"
    }

    Write-UiStatus 'Checking the download is signed by Docker Inc'
    Assert-SignedByDocker -Path $target

    Write-Info 'Running the Docker Desktop installer (silent).'
    Write-UiStatus 'Running the Docker Desktop installer - a few minutes'
    $result = Invoke-Native $target @('install', '--quiet', '--accept-license')
    if ($result.ExitCode -notin @(0, 3010)) {
        Complete-UiStep 'fail'
        throw "Docker Desktop installer exited $($result.ExitCode):`n$($result.Output)"
    }

    Remove-Item $target -Force -ErrorAction SilentlyContinue
    Write-Ok 'Docker Desktop installed.'
    if ($result.ExitCode -eq 3010) { Write-Warn 'The installer asked for a restart.' }
    Complete-UiStep 'ok'
}

# Refuses to run a downloaded binary unless Windows says Docker Inc signed it.
#
# Without this the installer would execute whatever arrived over the network, and TLS alone
# only proves who served the bytes, not who built them.
function Assert-SignedByDocker {
    param([Parameter(Mandatory)][string]$Path)

    Write-Info 'Verifying the download is signed by Docker Inc.'
    $signature = Get-AuthenticodeSignature -FilePath $Path

    if ($signature.Status -ne 'Valid') {
        Remove-Item $Path -Force -ErrorAction SilentlyContinue
        throw "The downloaded Docker Desktop installer has an invalid signature (status: $($signature.Status)). It has been deleted. Install Docker Desktop yourself from https://docs.docker.com/desktop/install/windows-install/ and run this again."
    }

    $subject = $signature.SignerCertificate.Subject
    if ($subject -notmatch 'Docker\s*,?\s*Inc') {
        Remove-Item $Path -Force -ErrorAction SilentlyContinue
        throw "The downloaded installer is signed, but by '$subject' rather than Docker Inc. It has been deleted."
    }

    Write-Ok "Signed by: $subject"
}

function Invoke-DependencyStage {
    if (-not (Test-Elevated)) {
        throw 'The Dependencies stage must run elevated.'
    }

    $machine = Test-Preflight
    $wsl     = Get-WslStatus
    $docker  = Get-DockerStatus
    $restart = $false

    if (-not $wsl.Version2) {
        $restart = Install-Wsl
    } else {
        Write-Ok 'WSL2 already enabled.'
        Start-UiStep 'wsl' 'WSL2'
        Complete-UiStep 'skip'
    }

    if (-not $docker.Installed) {
        Install-DockerDesktop -Architecture $machine.Architecture
    } else {
        Write-Ok 'Docker already installed.'
        Start-UiStep 'docker' 'Docker Desktop'
        Complete-UiStep 'skip'
    }

    if ($restart) { return 3010 }
    return 0
}

# ── Docker daemon ─────────────────────────────────────────────────────────────

function Start-DockerDesktop {
    $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path $exe)) { return $false }
    if (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue) { return $true }

    Write-Info 'Starting Docker Desktop.'
    Start-Process -FilePath $exe | Out-Null
    return $true
}

function Wait-DockerDaemon {
    Write-Step 'Waiting for the Docker daemon'
    Start-UiStep 'daemon' 'Starting the Docker engine'
    Start-DockerDesktop | Out-Null

    $started   = Get-Date
    $deadline  = $started.AddSeconds($DaemonTimeoutSeconds)
    $announced = $false

    while ((Get-Date) -lt $deadline) {
        $docker = Get-DockerStatus
        if ($docker.DaemonRunning) {
            Write-Ok "Docker daemon $($docker.Version) is up."
            Complete-UiStep 'ok'
            return
        }
        if (-not $announced) {
            Write-Info 'Docker Desktop takes 30-90 seconds to start the first time.'
            $announced = $true
        }

        # Waiting on somebody else's startup has no real percentage, but 90 seconds is what
        # a first start costs, so that is the scale the bar is drawn against.
        $elapsed = [int]((Get-Date) - $started).TotalSeconds
        Write-UiStatus "Waiting for Docker Desktop - ${elapsed}s of the 30-90s a first start takes" ([Math]::Min(95, [int](100 * $elapsed / 90)))
        Start-Sleep -Seconds 3
    }

    Complete-UiStep 'fail'
    throw @"
The Docker daemon did not start within ${DaemonTimeoutSeconds}s.

If Docker Desktop was just installed, Windows may need a restart before its WSL2 backend
works. Restart, let Docker Desktop finish starting, then run:

    $(Join-Path $InstallDir 'lcs.cmd')
"@
}

# ── LCS stage (as the user) ───────────────────────────────────────────────────

function Install-Launcher {
    Write-Step "Installing the launcher to $InstallDir"
    Start-UiStep 'launcher' 'Installing the launcher and shortcuts'
    Write-UiStatus "Writing to $InstallDir"
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    # LCS-Setup.exe extracts its embedded copies next to this script; a direct run uses the
    # repository checkout.
    $source = Join-Path $PSScriptRoot 'lcs.ps1'
    if (-not (Test-Path $source)) {
        throw "Cannot find lcs.ps1 next to this script ($PSScriptRoot)."
    }
    Copy-Item $source (Join-Path $InstallDir 'lcs.ps1') -Force
    Write-Ok 'lcs.ps1'

    # The .cmd wrapper is what lets a shortcut, a double-click, and `lcs` on PATH all work
    # without anyone having to change the PowerShell execution policy.
    $cmd = @"
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lcs.ps1" %*
"@
    Set-Content -Path (Join-Path $InstallDir 'lcs.cmd') -Value $cmd -Encoding ASCII
    Write-Ok 'lcs.cmd'

    Add-ToUserPath $InstallDir
}

# Puts `lcs` on the command line for this user only, so no admin rights and no effect on
# other accounts.
function Add-ToUserPath {
    param([string]$Directory)

    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($current -and ($current -split ';' | Where-Object { $_.TrimEnd('\') -ieq $Directory.TrimEnd('\') })) {
        Write-Ok 'Already on PATH.'
        return
    }

    $updated = if ([string]::IsNullOrEmpty($current)) { $Directory } else { "$current;$Directory" }
    [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
    $env:Path = "$env:Path;$Directory"
    Write-Ok "Added to PATH; 'lcs' works in a new terminal."
}

function New-Shortcuts {
    Write-Step 'Creating shortcuts'
    $target = Join-Path $InstallDir 'lcs.cmd'

    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) $script:ProductName
    New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
    New-Shortcut (Join-Path $startMenu 'Start LCS.lnk')   $target '-Action Up'
    New-Shortcut (Join-Path $startMenu 'Stop LCS.lnk')    $target '-Action Down'
    New-Shortcut (Join-Path $startMenu 'LCS Console.lnk') $target '-Action Console'
    Write-Ok "Start Menu > $script:ProductName"

    $desktop = [Environment]::GetFolderPath('DesktopDirectory')
    New-Shortcut (Join-Path $desktop 'Start LCS.lnk') $target '-Action Up'
    Write-Ok 'Desktop > Start LCS'
    Complete-UiStep 'ok'
}

function New-Shortcut {
    param([string]$LinkPath, [string]$Target, [string]$Arguments)

    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($LinkPath)
    $link.TargetPath       = $Target
    $link.Arguments        = $Arguments
    $link.WorkingDirectory = Split-Path -Parent $Target
    $link.Description      = 'Local Cloud Services - AWS-compatible emulator'
    $link.Save()
}

# Gets the LCS image by whichever route is available: already present, a tarball beside the
# installer, a registry pull, or a build from a source checkout.
#
# Returns $true only if the image actually ends up on the machine. Reporting a successful
# install when LCS cannot start is what made the first version of this installer useless on
# a machine that had never seen the image.
function Install-Image {
    Write-Step "Checking for the $Image image"
    Start-UiStep 'image' 'Getting the emulator image'
    Write-UiStatus "Looking for $Image"

    if ((Invoke-Native docker @('image', 'inspect', $Image)).ExitCode -eq 0) {
        Write-Ok 'Already present.'
        Complete-UiStep 'skip'
        return $true
    }

    if ((Install-ImageFromArchive) -or (Install-ImageFromRegistry) -or (Install-ImageFromSource)) {
        Complete-UiStep 'ok'
        return $true
    }

    Complete-UiStep 'fail'
    return $false
}

# An archive beside the installer is the offline route. .tar.gz is accepted because the
# image is ~570 MB raw and ~330 MB compressed, and that difference decides whether it fits
# in whatever the user is using to move it.
function Install-ImageFromArchive {
    # PayloadDir is where a bundle keeps the archive; PSScriptRoot covers running this
    # script straight out of a checkout. Deduplicated so a direct run does not scan twice.
    $searchDirs = @($PayloadDir, $PSScriptRoot) | Where-Object { $_ } | Select-Object -Unique

    foreach ($dir in $searchDirs) {
    foreach ($name in @('lcs-image.tar', 'lcs-image.tar.gz', 'lcs-image.tgz')) {
        $archive = Join-Path $dir $name
        if (-not (Test-Path $archive)) { continue }

        $size = [math]::Round((Get-Item $archive).Length / 1MB)
        Write-Info "Loading $name (${size} MB) - this takes a minute."
        Write-UiStatus "Loading $name (${size} MB) - about a minute"

        # docker load detects and decompresses gzip itself, so every supported archive
        # goes through the same call and nothing is expanded to a temporary file.
        $load = Invoke-Native docker @('load', '-i', $archive)

        if ($load.ExitCode -ne 0) {
            Write-Warn "Loading $name failed: $($load.Output)"
            continue
        }

        # Kept beside the launcher so it can be reloaded after a `docker image prune`.
        Copy-Item $archive (Join-Path $InstallDir $name) -Force -ErrorAction SilentlyContinue
        Write-Ok 'Image loaded.'
        return $true
    }
    }
    return $false
}

# Only attempted for a namespaced reference. `lcs/lcs:merged` is a local build tag that
# exists on no registry, so pulling it would spend a minute to fail confusingly.
function Install-ImageFromRegistry {
    if ($Image -notmatch '[./]' -or $Image -like 'lcs/lcs:*') {
        return $false
    }

    Write-Info "Trying to pull $Image."
    Write-UiStatus "Pulling $Image"
    $pull = Invoke-Native docker @('pull', $Image)
    if ($pull.ExitCode -eq 0) {
        Write-Ok 'Image pulled.'
        return $true
    }
    Write-Warn 'Pull failed; the image is not on a registry this machine can reach.'
    return $false
}

# Building takes 10-20 minutes, so it is offered rather than assumed - but on a developer's
# machine with a checkout it is the difference between a working install and a dead end.
function Install-ImageFromSource {
    $repo = Find-SourceCheckout
    if (-not $repo) { return $false }

    Write-Info "Found an LCS checkout at $repo."
    if ($script:Interactive) {
        Write-Host '    Build the image from it now? This takes 10-20 minutes. [y/N] ' -NoNewline
        $answer = Read-Host
        if ($answer -notmatch '^(y|yes)$') { return $false }
    } elseif ($Silent -or $BuildFromSource) {
        Write-Info 'Building from source, as asked.'
    } else {
        # -Ui without -BuildFromSource: the graphical installer offers this as a checkbox on
        # its consent screen, so silence here means the answer was no.
        Write-Info 'Not building from source: -BuildFromSource was not given.'
        return $false
    }

    Write-Step 'Building the LCS image'
    Write-Info 'Progress is shown by Docker; this is the slow part.'
    Write-UiStatus 'Building the image from source - 10 to 20 minutes'
    & docker build -f (Join-Path $repo 'docker\Dockerfile') -t $Image $repo
    if ($LASTEXITCODE -ne 0) {
        Write-Warn 'The build failed.'
        return $false
    }
    Write-Ok 'Image built.'
    return $true
}

# Walks up from the installer looking for the repository root, so running the script from
# tools\windows inside a checkout just works.
function Find-SourceCheckout {
    $candidate = $PSScriptRoot
    for ($depth = 0; $depth -lt 5 -and $candidate; $depth++) {
        if ((Test-Path (Join-Path $candidate 'docker\Dockerfile')) -and
            (Test-Path (Join-Path $candidate 'pom.xml'))) {
            return $candidate
        }
        $candidate = Split-Path -Parent $candidate
    }
    return $null
}

function Invoke-AllStages {
    $machine = Test-Preflight
    $docker  = Get-DockerStatus
    $wsl     = Get-WslStatus

    # -Ui has already shown this plan on its consent screen and been told to go ahead;
    # printing it again would only push the log's useful part off the top.
    if (-not $Ui) {
        if (-not (Show-Plan (Get-InstallPlan -Machine $machine -Docker $docker -Wsl $wsl))) {
            Write-Warn 'Cancelled. Nothing was changed.'
            return 2
        }
    } else {
        Write-Ui 'STEPS' @(Get-InstallSteps -Docker $docker -Wsl $wsl | ForEach-Object { "$($_.Key):$($_.Label)" })
    }

    $needsDependencies = (-not $docker.Installed) -or (-not $wsl.Version2)

    if ($needsDependencies -and $SkipDependencies) {
        throw 'Docker is not installed and -SkipDependencies was given.'
    }

    if ($needsDependencies) {
        Write-Step 'Installing dependencies (an administrator prompt will appear)'
        Start-UiStep 'elevate' 'Waiting for the administrator prompt'
        Write-UiStatus 'Windows is asking permission to install WSL2 and Docker Desktop'
        $exitCode = Invoke-ElevatedDependencyStage
        # The elevated child reported its own wsl and docker steps through the tee'd log;
        # this closes the parent's own "waiting for permission" step, whatever came between.
        $script:UiStep = 'elevate'
        Complete-UiStep $(if ($exitCode -in @(0, 3010)) { 'ok' } else { 'fail' })
        if ($exitCode -eq 3010) {
            Write-Host ''
            Write-Warn 'Windows needs a restart before Docker can run.'
            Write-Warn 'Restart, then launch: Start Menu > LCS > Start LCS'
            # Finish the user-scoped part so the shortcuts exist after the reboot.
            Install-Launcher
            New-Shortcuts
            Write-Ui 'DONE' @('restart', 'Restart Windows to finish installing LCS.')
            return 3010
        }
        if ($exitCode -ne 0) {
            throw "Dependency installation failed (exit code $exitCode). Nothing else was changed."
        }
    }

    Wait-DockerDaemon
    Install-Launcher
    New-Shortcuts
    $haveImage = Install-Image

    Show-Summary -HaveImage $haveImage

    # A non-zero exit is what stops a scripted install from reporting success when the
    # emulator cannot run.
    if (-not $haveImage) {
        Write-Ui 'DONE' @('incomplete', "The launcher is installed, but the $Image image is not on this machine.")
        return 4
    }

    if (-not $NoStart) {
        Write-Step 'Starting LCS'
        Start-UiStep 'start' 'Starting LCS'
        Write-UiStatus 'Starting the container and waiting for the console to answer'
        # -NoBrowser because the graphical installer offers "Open console" on its last
        # screen; opening a browser tab behind the window is not the same as being asked.
        $startArgs = @('-Action', 'Up')
        if ($Ui) { $startArgs += '-NoBrowser' }
        & (Join-Path $InstallDir 'lcs.cmd') @startArgs
        if ($LASTEXITCODE -ne 0) {
            Complete-UiStep 'fail'
            Write-Ui 'DONE' @('fail', 'LCS is installed, but it did not start. The details view has the reason.')
            return 5
        }
        Complete-UiStep 'ok'
    }

    Write-Ui 'DONE' @('ok', 'LCS is installed and running.')
    return 0
}

# Relaunches only the dependency stage with elevation, so the LCS install itself stays in
# the calling user's profile.
function Invoke-ElevatedDependencyStage {
    $arguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$PSCommandPath`"",
        '-Stage', 'Dependencies',
        '-Image', $Image
    )
    if ($Silent) { $arguments += '-Silent' }

    # The child mirrors its output into this file, which is the only way the graphical
    # installer can see the elevated half of the install. Hidden, because there is nothing in
    # that console the window is not already showing.
    $windowStyle = 'Normal'
    if ($Ui) {
        $arguments += @('-Ui')
        if ($UiLog) { $arguments += @('-UiLog', "`"$UiLog`"") }
        $windowStyle = 'Hidden'
    }

    try {
        $process = Start-Process -FilePath (Get-Process -Id $PID).Path `
            -ArgumentList $arguments -Verb RunAs -Wait -PassThru -WindowStyle $windowStyle
        return $process.ExitCode
    } catch {
        throw "Could not start the elevated installer: $($_.Exception.Message). Approve the administrator prompt, or install Docker Desktop yourself and re-run with -SkipDependencies."
    }
}

function Show-Summary {
    param([bool]$HaveImage)

    Write-Host ''

    # Without the image nothing can run, so this is a failure with a launcher installed -
    # not a success with a caveat. Saying "Installed." here sent someone away with a
    # shortcut that does nothing.
    if (-not $HaveImage) {
        Write-Host '  Not finished - LCS cannot start yet.' -ForegroundColor Red
        Write-Host ''
        Write-Host "  The launcher is installed at $InstallDir, but the emulator image"
        Write-Host "  '$Image' is not on this machine and could not be obtained."
        Write-Host ''
        Write-Host '  Any one of these fixes it:' -ForegroundColor White
        Write-Host ''
        Write-Host '   1. Get lcs-image.tar.gz from whoever gave you this installer, put it'
        Write-Host '      in the same folder as LCS-Setup.exe, and run the installer again.'
        Write-Host ''
        Write-Host '   2. If you have a checkout of the LCS repository:'
        Write-Host "          docker build -f docker/Dockerfile -t $Image ." -ForegroundColor DarkGray
        Write-Host '          lcs up' -ForegroundColor DarkGray
        Write-Host ''
        Write-Host '   3. If the image is on a registry you can reach:'
        Write-Host '          docker pull <registry>/lcs:<tag>' -ForegroundColor DarkGray
        Write-Host "          docker tag <registry>/lcs:<tag> $Image" -ForegroundColor DarkGray
        Write-Host '          lcs up' -ForegroundColor DarkGray
        Write-Host ''

        # Two fields, label then value. Aligning with spaces would not survive Write-Ui, which
        # collapses runs of whitespace so a message can never contain a line break.
        Write-Ui 'SUMMARY' @('', 'Any one of these fixes it:')
        Write-Ui 'SUMMARY' @('1', 'Put lcs-image.tar.gz next to LCS-Setup.exe and run this again.')
        Write-Ui 'SUMMARY' @('2', "From a checkout: docker build -f docker/Dockerfile -t $Image .")
        Write-Ui 'SUMMARY' @('3', 'From a registry: docker pull, then docker tag it as ' + $Image)
        return
    }

    Write-Host '  Installed.' -ForegroundColor Green
    Write-Host ''
    Write-Host '  Start        Start Menu > LCS > Start LCS'
    Write-Host '  Command line lcs up | lcs down | lcs status | lcs logs'
    Write-Host ''
    Write-Host '  Console      http://localhost:4566/_lcs/ui/'
    Write-Host '  Endpoint     http://localhost:4566'
    Write-Host ''
    Write-Host '  Bound to 127.0.0.1 only. LCS accepts any credentials and has no' -ForegroundColor DarkGray
    Write-Host '  authentication, so it is not exposed to your network by default.' -ForegroundColor DarkGray
    Write-Host ''

    Write-Ui 'SUMMARY' @('Start', 'Start Menu > LCS > Start LCS')
    # Slashes rather than the console version's pipes: a pipe is the protocol's field
    # separator, so Write-Ui would strip it and run the four commands together.
    Write-Ui 'SUMMARY' @('Commands', 'lcs up / lcs down / lcs status / lcs logs')
    Write-Ui 'SUMMARY' @('Console', 'http://localhost:4566/_lcs/ui/')
    Write-Ui 'SUMMARY' @('Endpoint', 'http://localhost:4566')
}

# ── Entry point ───────────────────────────────────────────────────────────────

try {
    if ($Stage -eq 'Dependencies') {
        exit (Invoke-DependencyStage)
    }
    if ($Stage -eq 'Plan') {
        exit (Invoke-PlanStage)
    }

    Write-Host ''
    Write-Host "  $script:ProductName - Local Cloud Services" -ForegroundColor White
    Write-Host '  An AWS-compatible emulator that runs on your own machine.'
    Write-Host '  --------------------------------------------------------'

    exit (Invoke-AllStages)
} catch {
    Write-Host ''
    Write-Err "Setup failed: $($_.Exception.Message)"
    Write-Host ''
    # The front-end has no other way to know a throw happened: the process exit code arrives
    # after the window has already decided what to show.
    Complete-UiStep 'fail'
    Write-Ui 'DONE' @('fail', $_.Exception.Message)
    exit 1
}
