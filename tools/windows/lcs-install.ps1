<#
.SYNOPSIS
    Installs LCS and everything it needs on Windows.

.DESCRIPTION
    Driven by LCS-Setup.exe, which embeds this script. Runnable directly for scripted
    installs.

    Runs in two stages so elevation is scoped as narrowly as possible:

      All          (default, as the signed-in user) preflight, consent, then hand the
                   dependency work to an elevated child process, then install LCS itself
                   and start it.
      Dependencies (elevated) install WSL2 and Docker Desktop, and nothing else.

    Splitting them matters: if the whole installer ran elevated, $env:LOCALAPPDATA,
    the Start Menu, and the Desktop would all resolve to the administrator's profile, and
    the user would end up with an install and shortcuts they cannot see.

.PARAMETER Stage
    All (default) or Dependencies. Dependencies requires an elevated session and is what
    the All stage relaunches.

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
#>
[CmdletBinding()]
param(
    [ValidateSet('All', 'Dependencies')]
    [string]$Stage = 'All',

    [switch]$Silent,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'LCS'),
    [string]$Image = 'lcs/lcs:merged',
    [switch]$SkipDependencies,
    [switch]$NoStart,
    [int]$DaemonTimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
$script:ProductName = 'LCS'

# Official Docker download hosts. Kept in one place so there is exactly one thing to audit
# when asking "where does this installer fetch code from".
$script:DockerDesktopUrls = @{
    'x64'   = 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe'
    'arm64' = 'https://desktop.docker.com/win/main/arm64/Docker%20Desktop%20Installer.exe'
}

function Write-Step { param($m) Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "    $m" -ForegroundColor Green }
function Write-Info { param($m) Write-Host "    $m" }
function Write-Warn { param($m) Write-Host "    $m" -ForegroundColor Yellow }
function Write-Err  { param($m) Write-Host "    $m" -ForegroundColor Red }

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

    $os    = Get-CimInstance Win32_OperatingSystem
    $build = [int](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuildNumber
    $arch  = Get-Architecture

    Write-Info "$($os.Caption) (build $build, $arch)"

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

function Show-Plan {
    param($Machine, $Docker, $Wsl)

    $needsDocker = -not $Docker.Installed
    $needsWsl    = -not $Wsl.Version2

    Write-Host ''
    Write-Host '  This installer will:' -ForegroundColor White
    Write-Host ''

    if ($needsWsl) {
        Write-Host '   * Enable the Windows Subsystem for Linux (wsl --install --no-distribution).'
        Write-Host '     Needs administrator rights, and may require a restart.' -ForegroundColor DarkGray
    }
    if ($needsDocker) {
        Write-Host '   * Install Docker Desktop, downloaded from Docker Inc:'
        Write-Host "       $($script:DockerDesktopUrls[$Machine.Architecture])" -ForegroundColor DarkGray
        Write-Host '     The download is verified against Docker Inc''s code-signing certificate'
        Write-Host '     before it runs. Needs administrator rights.' -ForegroundColor DarkGray
        Write-Host '     Docker Desktop is free for personal use, education, and small business;'
        Write-Host '     larger organisations need a paid subscription. Installing accepts its'
        Write-Host '     licence terms: https://docs.docker.com/subscription/desktop-license/' -ForegroundColor DarkGray
    }
    if (-not $needsDocker -and -not $needsWsl) {
        Write-Host '   * Nothing: Docker is already installed.'
    }

    Write-Host "   * Install the LCS launcher to $InstallDir (no admin rights needed)."
    Write-Host '   * Add Start Menu and Desktop shortcuts.'
    Write-Host "   * Start LCS, listening on 127.0.0.1:4566 only."
    Write-Host ''
    Write-Host '  It will not change any other system setting, and installs nothing else.' -ForegroundColor DarkGray
    Write-Host ''

    if ($Silent) { return $true }

    Write-Host '  Continue? [Y/n] ' -NoNewline
    $answer = Read-Host
    return ([string]::IsNullOrWhiteSpace($answer) -or $answer.Trim().ToLower().StartsWith('y'))
}

# ── Dependency stage (elevated) ───────────────────────────────────────────────

function Install-Wsl {
    Write-Step 'Enabling Windows Subsystem for Linux'

    # --no-distribution keeps this to the kernel and platform features. Docker Desktop
    # creates its own distro; installing Ubuntu here would be an unrequested extra.
    $result = Invoke-Native wsl @('--install', '--no-distribution')
    if ($result.ExitCode -ne 0) {
        Write-Warn "wsl --install exited $($result.ExitCode):"
        Write-Warn $result.Output
        Write-Warn 'Continuing: Docker Desktop can enable WSL2 itself, and will say so if it cannot.'
        return $false
    }

    Write-Ok 'WSL2 enabled.'
    if ($result.Output -match 'restart|reboot') {
        Write-Warn 'Windows wants a restart to finish enabling WSL2.'
        return $true
    }
    return $false
}

function Install-DockerDesktop {
    param([string]$Architecture)

    Write-Step 'Installing Docker Desktop'

    # winget is preferred: it resolves the current version and verifies the package hash
    # and signature itself, so there is no URL or checksum here to go stale.
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info 'Using winget.'
        $wingetArgs = @(
            'install', '--id', 'Docker.DockerDesktop', '--exact',
            '--accept-package-agreements', '--accept-source-agreements',
            '--disable-interactivity'
        )
        $result = Invoke-Native winget $wingetArgs
        if ($result.ExitCode -eq 0) {
            Write-Ok 'Docker Desktop installed via winget.'
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
        # Explicit TLS 1.2 so this works on hosts whose default is still older.
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
    } catch {
        throw "Could not download Docker Desktop: $($_.Exception.Message)"
    }

    Assert-SignedByDocker -Path $target

    Write-Info 'Running the Docker Desktop installer (silent).'
    $result = Invoke-Native $target @('install', '--quiet', '--accept-license')
    if ($result.ExitCode -notin @(0, 3010)) {
        throw "Docker Desktop installer exited $($result.ExitCode):`n$($result.Output)"
    }

    Remove-Item $target -Force -ErrorAction SilentlyContinue
    Write-Ok 'Docker Desktop installed.'
    if ($result.ExitCode -eq 3010) { Write-Warn 'The installer asked for a restart.' }
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
    }

    if (-not $docker.Installed) {
        Install-DockerDesktop -Architecture $machine.Architecture
    } else {
        Write-Ok 'Docker already installed.'
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
    Start-DockerDesktop | Out-Null

    $deadline = (Get-Date).AddSeconds($DaemonTimeoutSeconds)
    $announced = $false

    while ((Get-Date) -lt $deadline) {
        $docker = Get-DockerStatus
        if ($docker.DaemonRunning) {
            Write-Ok "Docker daemon $($docker.Version) is up."
            return
        }
        if (-not $announced) {
            Write-Info 'Docker Desktop takes 30-90 seconds to start the first time.'
            $announced = $true
        }
        Start-Sleep -Seconds 3
    }

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

function Install-Image {
    Write-Step "Checking for the $Image image"

    if ((Invoke-Native docker @('image', 'inspect', $Image)).ExitCode -eq 0) {
        Write-Ok 'Already present.'
        return $true
    }

    # A tarball beside the installer is how an offline install gets the image.
    $tar = Join-Path $PSScriptRoot 'lcs-image.tar'
    if (Test-Path $tar) {
        Write-Info "Loading $tar - this takes a minute."
        $load = Invoke-Native docker @('load', '-i', $tar)
        if ($load.ExitCode -ne 0) { throw "docker load failed:`n$($load.Output)" }
        Copy-Item $tar (Join-Path $InstallDir 'lcs-image.tar') -Force -ErrorAction SilentlyContinue
        Write-Ok 'Image loaded.'
        return $true
    }

    Write-Warn "Image '$Image' is not present, and no lcs-image.tar beside this installer."
    Write-Warn 'Build it from a checkout of the LCS repository:'
    Write-Warn "    docker build -f docker/Dockerfile -t $Image ."
    Write-Warn 'Everything else is installed; LCS will start once the image exists.'
    return $false
}

function Invoke-AllStages {
    $machine = Test-Preflight
    $docker  = Get-DockerStatus
    $wsl     = Get-WslStatus

    if (-not (Show-Plan -Machine $machine -Docker $docker -Wsl $wsl)) {
        Write-Warn 'Cancelled. Nothing was changed.'
        return 2
    }

    $needsDependencies = (-not $docker.Installed) -or (-not $wsl.Version2)

    if ($needsDependencies -and $SkipDependencies) {
        throw 'Docker is not installed and -SkipDependencies was given.'
    }

    if ($needsDependencies) {
        Write-Step 'Installing dependencies (an administrator prompt will appear)'
        $exitCode = Invoke-ElevatedDependencyStage
        if ($exitCode -eq 3010) {
            Write-Host ''
            Write-Warn 'Windows needs a restart before Docker can run.'
            Write-Warn 'Restart, then launch: Start Menu > LCS > Start LCS'
            # Finish the user-scoped part so the shortcuts exist after the reboot.
            Install-Launcher
            New-Shortcuts
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

    if ($haveImage -and -not $NoStart) {
        Write-Step 'Starting LCS'
        & (Join-Path $InstallDir 'lcs.cmd') -Action Up
    }
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

    try {
        $process = Start-Process -FilePath (Get-Process -Id $PID).Path `
            -ArgumentList $arguments -Verb RunAs -Wait -PassThru
        return $process.ExitCode
    } catch {
        throw "Could not start the elevated installer: $($_.Exception.Message). Approve the administrator prompt, or install Docker Desktop yourself and re-run with -SkipDependencies."
    }
}

function Show-Summary {
    param([bool]$HaveImage)

    Write-Host ''
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
    if (-not $HaveImage) {
        Write-Host ''
        Write-Warn 'The LCS image is still missing - see the note above.'
    }
    Write-Host ''
}

# ── Entry point ───────────────────────────────────────────────────────────────

try {
    if ($Stage -eq 'Dependencies') {
        exit (Invoke-DependencyStage)
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
    exit 1
}
