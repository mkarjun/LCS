<#
.SYNOPSIS
    Produces a self-contained LCS bundle that works on a machine that has never seen the
    image.

.DESCRIPTION
    LCS-Setup.exe on its own only works where the image already exists, because
    lcs/lcs:merged is a local build tag published to no registry. Handing someone just the
    exe leaves them with a launcher and nothing to launch.

    This packages the exe together with the image so the pair is genuinely click-and-run:

        dist/bundle/
            LCS-Setup.exe
            lcs-image.tar.gz     ~330 MB
            README.txt

    The installer looks for lcs-image.tar.gz beside itself, so the recipient just runs the
    exe.

.PARAMETER Image
    Image to export. Defaults to lcs/lcs:merged.

.PARAMETER Zip
    Also produce dist/LCS-Bundle.zip for transfer as one file.

.EXAMPLE
    .\make-bundle.ps1 -Zip
#>
[CmdletBinding()]
param(
    [string]$Image = 'lcs/lcs:merged',
    [switch]$Zip,
    [string]$OutputDir = (Join-Path $PSScriptRoot 'dist\bundle')
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($m) Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "    $m" -ForegroundColor Green }

docker image inspect $Image 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Image '$Image' is not on this machine. Build it first:`n    docker build -f docker/Dockerfile -t $Image ."
}

# Always rebuild the exe: shipping a bundle whose installer predates the current scripts is
# exactly the sort of mismatch that is invisible until it fails on someone else's laptop.
Write-Step 'Building LCS-Setup.exe'
& (Join-Path $PSScriptRoot 'build-installer.ps1') | Out-Null
$exe = Join-Path $PSScriptRoot 'dist\LCS-Setup.exe'
if (-not (Test-Path $exe)) { throw 'build-installer.ps1 did not produce LCS-Setup.exe.' }
Write-Ok 'LCS-Setup.exe'

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Copy-Item $exe $OutputDir -Force

Write-Step "Exporting $Image (a few minutes)"
$tar = Join-Path $env:TEMP 'lcs-image-bundle.tar'
docker save $Image -o $tar
if ($LASTEXITCODE -ne 0) { throw 'docker save failed.' }
Write-Ok "$([math]::Round((Get-Item $tar).Length / 1MB)) MB raw"

Write-Step 'Compressing'
$gz = Join-Path $OutputDir 'lcs-image.tar.gz'
$input = [IO.File]::OpenRead($tar)
$output = [IO.File]::Create($gz)
try {
    $gzip = New-Object IO.Compression.GZipStream($output, [IO.Compression.CompressionLevel]::Optimal)
    $input.CopyTo($gzip)
    $gzip.Dispose()
} finally {
    $output.Dispose()
    $input.Dispose()
    Remove-Item $tar -Force -ErrorAction SilentlyContinue
}
Write-Ok "$([math]::Round((Get-Item $gz).Length / 1MB)) MB compressed"

Write-Step 'Writing README.txt'
@"
LCS - Local Cloud Services
==========================

An AWS-compatible cloud emulator that runs on your own machine.

TO INSTALL
----------

  1. Keep both files in this folder together.
  2. Double-click LCS-Setup.exe.

That is all. The installer checks your machine, installs Docker Desktop if you
do not have it, loads the emulator image from lcs-image.tar.gz, and starts LCS.

Requires Windows 10 version 2004 (build 19041) or newer, 64-bit.
Installing Docker Desktop needs administrator rights; nothing else does.

AFTER INSTALLING
----------------

  Console      http://localhost:4566/_lcs/ui/
  Endpoint     http://localhost:4566

  Start Menu > LCS > Start LCS

  From a terminal:
      lcs up        start
      lcs down      stop
      lcs status    is it running
      lcs logs      follow the log
      lcs console   open the console

  Point the AWS CLI at it:
      aws --endpoint-url http://localhost:4566 s3 ls

  Any credentials work; 'test' / 'test' is conventional.

NOTES
-----

LCS listens on 127.0.0.1 only. It has no authentication and accepts any
credentials, so it is deliberately not reachable from your network.

Resources live in memory: stopping LCS discards them. To keep them:
    lcs up -Persist "%LOCALAPPDATA%\LCS\data"

Image: $Image
Built: $(Get-Date -Format 'yyyy-MM-dd')
"@ | Set-Content -Path (Join-Path $OutputDir 'README.txt') -Encoding UTF8
Write-Ok 'README.txt'

if ($Zip) {
    Write-Step 'Zipping'
    $zipPath = Join-Path (Split-Path -Parent $OutputDir) 'LCS-Bundle.zip'
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    # The payload is already gzip, so store rather than spend minutes re-compressing it.
    Compress-Archive -Path "$OutputDir\*" -DestinationPath $zipPath -CompressionLevel NoCompression
    Write-Ok "$zipPath ($([math]::Round((Get-Item $zipPath).Length / 1MB)) MB)"
}

Write-Host ''
Write-Host "  Bundle ready: $OutputDir" -ForegroundColor Green
Write-Host '  Send the whole folder. The recipient runs LCS-Setup.exe.'
Write-Host ''
