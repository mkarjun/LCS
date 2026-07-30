<#
.SYNOPSIS
    Compiles LCS-Setup.exe from LcsSetup.cs, embedding lcs.ps1.

.DESCRIPTION
    Uses the .NET Framework 4 C# compiler that ships with Windows, so producing the
    installer needs no SDK download. The output is a single self-contained exe that runs
    on any Windows machine without a runtime install.

.EXAMPLE
    .\build-installer.ps1
#>
[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $PSScriptRoot 'dist\LCS-Setup.exe')
)

$ErrorActionPreference = 'Stop'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
    throw "No .NET Framework 4 C# compiler found under $env:WINDIR\Microsoft.NET. Install the .NET Framework 4.x developer files, or build with 'dotnet build' instead."
}

$source = Join-Path $PSScriptRoot 'LcsSetup.cs'
$script = Join-Path $PSScriptRoot 'lcs.ps1'
foreach ($required in @($source, $script)) {
    if (-not (Test-Path $required)) { throw "Missing $required." }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null

Write-Host "==> Compiling $(Split-Path -Leaf $OutputPath)" -ForegroundColor Cyan
& $csc /nologo /target:exe /platform:anycpu /optimize+ `
    "/out:$OutputPath" `
    "/resource:$script,lcs.ps1" `
    $source

if ($LASTEXITCODE -ne 0) { throw "csc.exe failed with exit code $LASTEXITCODE." }

$size = [math]::Round((Get-Item $OutputPath).Length / 1KB, 1)
Write-Host "    $OutputPath (${size} KB)" -ForegroundColor Green
Write-Host ""
Write-Host "  To ship it for offline installs, export the image beside the exe:"
Write-Host "      docker save lcs/lcs:merged -o `"$(Join-Path (Split-Path -Parent $OutputPath) 'lcs-image.tar')`""
