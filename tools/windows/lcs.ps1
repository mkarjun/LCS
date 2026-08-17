<#
.SYNOPSIS
    Starts, stops, and inspects the LCS emulator container.

.DESCRIPTION
    LCS runs as a single Docker container that serves the AWS-compatible API and the
    console on port 4566. This script wraps the container lifecycle so nobody has to
    remember the flags, and it fails loudly with an actionable message instead of leaving
    a half-started container behind.

    Two run flags are load-bearing and are always applied:

      -e FLOCI_TLS_ENABLED=true
          Required by the TLS-dependent paths and by the compatibility suites.

      -v /var/run/docker.sock:/var/run/docker.sock  (with -u root)
          Lambda, RDS, ECS, and EC2 start real containers of their own. Without the
          socket, Lambda invocations fail with an opaque socket error.

.PARAMETER Action
    Up (default), Down, Restart, Status, Logs, or Console. Positional, so `lcs up` and
    `lcs -Action Up` are the same command.

.PARAMETER Image
    Image to run. Defaults to mkarjun/lcs:latest, or $env:LCS_IMAGE if set.

.PARAMETER Port
    Host port for the API and console. Defaults to 4566.

.PARAMETER BindAddress
    Host interface to publish on. Defaults to 127.0.0.1 - LCS has no authentication and
    accepts any credentials, so binding it to every interface would hand anyone on the
    network an unauthenticated API that can start containers on this machine. Pass
    0.0.0.0 only on a network you control and understand.

.PARAMETER PublishDbPorts
    Also publish the RDS proxy port range so databases created through RDS are reachable
    from the host at localhost:<port>. Off by default: publishing the range costs several
    seconds of startup on Docker Desktop and most users never connect a SQL client.

.PARAMETER DbPortRange
    Range published by -PublishDbPorts. Defaults to 7000-7019.

.PARAMETER Persist
    Bind-mount a host directory at /app/data so resources survive a restart. Without it,
    everything is in-memory and a restart starts empty.

.PARAMETER NoBrowser
    Do not open the console when the container becomes healthy.

.EXAMPLE
    lcs
    Starts LCS and opens the console.

.EXAMPLE
    lcs status

.EXAMPLE
    .\lcs.ps1 -Action Up -Persist "$env:LOCALAPPDATA\LCS\data" -PublishDbPorts
    Starts LCS with persistent storage and reachable database ports.

.EXAMPLE
    .\lcs.ps1 -Action Down
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('Up', 'Down', 'Restart', 'Status', 'Logs', 'Console')]
    [string]$Action = 'Up',

    [string]$Image = $(if ($env:LCS_IMAGE) { $env:LCS_IMAGE } else { 'mkarjun/lcs:latest' }),
    [string]$ContainerName = 'lcs',
    [int]$Port = 4566,
    [string]$BindAddress = '127.0.0.1',
    [switch]$PublishDbPorts,
    [string]$DbPortRange = '7000-7019',
    [string]$Persist,
    [switch]$NoBrowser,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'

# What local builds were tagged before the image had a published home. Still
# honoured so a checkout built the old way keeps working offline.
$script:LegacyImage = 'lcs/lcs:merged'

function Write-Step { param($Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param($Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Warn { param($Message) Write-Host "    $Message" -ForegroundColor Yellow }
function Write-Err  { param($Message) Write-Host "    $Message" -ForegroundColor Red }

$consoleUrl  = "http://localhost:$Port/_lcs/ui/"
$endpointUrl = "http://localhost:$Port"

# Runs docker and hands back the exit code instead of throwing.
#
# $ErrorActionPreference = 'Stop' makes PowerShell 7 treat a native command's stderr as a
# terminating error, so a plain `docker inspect` on a container that does not exist aborts
# the script. Every call whose failure is a normal outcome - "is it running?", "is the
# image here?" - goes through this.
function Invoke-Docker {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & docker @Arguments 2>&1
        return [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output   = ($output | Out-String).Trim()
        }
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Assert-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker CLI not found on PATH. Install Docker Desktop from https://docs.docker.com/desktop/install/windows-install/ and reopen this window."
    }
    # `docker info` is the only reliable liveness check: the CLI exists even when the
    # daemon is stopped, and every other command then fails with a confusing error.
    if ((Invoke-Docker info --format '{{.ServerVersion}}').ExitCode -ne 0) {
        throw "Docker is installed but the daemon is not responding. Start Docker Desktop, wait for the whale icon to stop animating, then run this again."
    }
}

function Get-ContainerState {
    $result = Invoke-Docker inspect $ContainerName --format '{{.State.Status}}'
    if ($result.ExitCode -ne 0) { return $null }
    return $result.Output
}

function Assert-ImagePresent {
    if ((Invoke-Docker image inspect $Image).ExitCode -eq 0) { return }

    Write-Warn "Image '$Image' is not present locally."

    # An archive beside this script is how the installer keeps an offline copy, so a
    # `docker image prune` does not leave the machine unable to start.
    foreach ($name in @('lcs-image.tar', 'lcs-image.tar.gz', 'lcs-image.tgz')) {
        $archive = Join-Path $PSScriptRoot $name
        if (-not (Test-Path $archive)) { continue }

        Write-Step "Loading image from $name (this takes a minute)"
        # docker load detects and decompresses gzip itself, so .tar and .tar.gz are the
        # same call and nothing is expanded to a temporary file.
        $load = Invoke-Docker load -i $archive
        if ($load.ExitCode -ne 0) { throw "docker load failed for ${archive}:`n$($load.Output)" }
        return
    }

    # No archive: try the registry. Before the image had a published home this
    # threw instead, which is why the README's own `docker run` could not work
    # on a machine that had never built LCS.
    Write-Step "Pulling $Image"
    if ((Invoke-Docker pull $Image).ExitCode -eq 0) { return }

    # A local build made before the published name existed still counts.
    if ((Invoke-Docker image inspect $script:LegacyImage).ExitCode -eq 0) {
        Write-Warn "Could not reach the registry; using the local $script:LegacyImage instead."
        $script:Image = $script:LegacyImage
        return
    }

    throw @"
Image '$Image' not found, could not be pulled, and there is no
lcs-image.tar/.tar.gz next to this script.

Any one of these fixes it:

  1. Put lcs-image.tar.gz next to this script and run it again.

  2. From a checkout of the LCS repository:
         docker build -f docker/Dockerfile -t $Image .

  3. Export it from a machine that already has it:
         docker save $Image | gzip > lcs-image.tar.gz
"@
}

function Assert-PortFree {
    $inUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $inUse) { return }

    # A container we own is fine - Start-Lcs removes it. Anything else is a real conflict,
    # and silently proceeding produces a container that exits immediately.
    $ourState = Get-ContainerState
    if ($ourState) { return }

    $pids = ($inUse | Select-Object -ExpandProperty OwningProcess -Unique)
    $names = $pids | ForEach-Object {
        $proc = Get-Process -Id $_ -ErrorAction SilentlyContinue
        if ($proc) { "$($proc.ProcessName) (PID $_)" } else { "PID $_" }
    }
    throw "Port $Port is already in use by $($names -join ', '). Stop it, or start LCS on another port with -Port <number>."
}

function Wait-Healthy {
    Write-Step "Waiting for LCS to become ready"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $state = Get-ContainerState
        if ($state -ne 'running') {
            Write-Err "Container stopped while starting (state: $state). Last output:"
            (Invoke-Docker logs --tail 40 $ContainerName).Output | Write-Host
            throw "LCS failed to start."
        }

        try {
            # The console is served by the same process as the API, so one 200 proves both.
            $response = Invoke-WebRequest -Uri $consoleUrl -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                $elapsed = [int]($TimeoutSeconds - ($deadline - (Get-Date)).TotalSeconds)
                Write-Ok "Ready after ${elapsed}s."
                return
            }
        } catch {
            Start-Sleep -Milliseconds 700
        }
    }

    Write-Err "LCS did not answer on $consoleUrl within ${TimeoutSeconds}s. Last output:"
    (Invoke-Docker logs --tail 40 $ContainerName).Output | Write-Host
    throw "Timed out waiting for LCS."
}

function Start-Lcs {
    Assert-Docker
    Assert-ImagePresent
    Assert-PortFree

    $state = Get-ContainerState
    if ($state -eq 'running') {
        Write-Ok "LCS is already running."
    } else {
        if ($state) {
            # Reusing a stopped container would keep its old image and port mapping, which
            # is how a rebuilt image silently fails to take effect.
            Write-Step "Removing previous container ($state)"
            Invoke-Docker rm -f $ContainerName | Out-Null
        }

        $runArgs = @(
            'run', '-d',
            '--name', $ContainerName,
            '--restart', 'unless-stopped',
            '-p', "${BindAddress}:${Port}:4566",
            '-e', 'FLOCI_TLS_ENABLED=true',
            '-v', '/var/run/docker.sock:/var/run/docker.sock',
            '-u', 'root'
        )

        if ($BindAddress -ne '127.0.0.1' -and $BindAddress -ne 'localhost') {
            Write-Warn "Publishing on $BindAddress. LCS has no authentication and accepts any"
            Write-Warn "credentials, so anyone who can reach this port can drive it."
        }

        if ($PublishDbPorts) {
            $runArgs += @('-p', "${BindAddress}:${DbPortRange}:${DbPortRange}")
            Write-Warn "Publishing $DbPortRange - this can add several seconds to startup."
        }

        if ($Persist) {
            $full = [System.IO.Path]::GetFullPath($Persist)
            New-Item -ItemType Directory -Force -Path $full | Out-Null
            $runArgs += @('-v', "${full}:/app/data")
            Write-Ok "Persisting resources to $full"
        }

        $runArgs += $Image

        Write-Step "Starting $Image as '$ContainerName' on port $Port"
        $run = Invoke-Docker @runArgs
        if ($run.ExitCode -ne 0) { throw "docker run failed:`n$($run.Output)" }
    }

    Wait-Healthy

    Write-Host ""
    Write-Host "  LCS is up." -ForegroundColor Green
    Write-Host "  Console   $consoleUrl"
    Write-Host "  Endpoint  $endpointUrl"
    Write-Host ""
    Write-Host "  Point the AWS CLI at it:"
    Write-Host "      aws --endpoint-url $endpointUrl s3 ls"
    Write-Host ""
    Write-Host "  Any credentials work; 'test' / 'test' is conventional."
    if (-not $Persist) {
        Write-Host "  Resources are in-memory: a restart starts empty. Use -Persist <dir> to keep them." -ForegroundColor DarkGray
    }
    Write-Host ""

    if (-not $NoBrowser) { Start-Process $consoleUrl }
}

function Stop-Lcs {
    Assert-Docker
    $state = Get-ContainerState
    if (-not $state) { Write-Ok "LCS is not running."; return }

    Write-Step "Stopping and removing '$ContainerName'"
    $remove = Invoke-Docker rm -f $ContainerName
    if ($remove.ExitCode -ne 0) { throw "docker rm failed:`n$($remove.Output)" }
    Write-Ok "Stopped."
    Write-Warn "Databases and other resources LCS started as their own containers are left running; 'docker ps' shows them."
}

function Show-Status {
    Assert-Docker
    $state = Get-ContainerState
    if (-not $state) {
        Write-Host "LCS is not running. Start it with: .\lcs.ps1" -ForegroundColor Yellow
        return
    }

    (Invoke-Docker ps --filter "name=^$ContainerName$" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}").Output | Write-Host
    Write-Host ""
    try {
        Invoke-WebRequest -Uri $consoleUrl -UseBasicParsing -TimeoutSec 3 | Out-Null
        Write-Ok "Console answering at $consoleUrl"
    } catch {
        Write-Err "Container is up but $consoleUrl is not answering yet."
    }
}

try {
    switch ($Action) {
        'Up'      { Start-Lcs }
        'Down'    { Stop-Lcs }
        'Restart' { Stop-Lcs; Start-Lcs }
        'Status'  { Show-Status }
        'Console' { Start-Process $consoleUrl }
        # Streaming logs is the one place docker should own the console, so this is a
        # direct call rather than going through Invoke-Docker's output capture.
        'Logs'    { Assert-Docker; docker logs -f $ContainerName }
    }
} catch {
    Write-Host ""
    Write-Err $_.Exception.Message
    exit 1
}
