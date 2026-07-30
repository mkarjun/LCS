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

$source  = Join-Path $PSScriptRoot 'LcsSetup.cs'
$scripts = @(
    (Join-Path $PSScriptRoot 'lcs-install.ps1'),
    (Join-Path $PSScriptRoot 'lcs.ps1')
)
foreach ($required in @($source) + $scripts) {
    if (-not (Test-Path $required)) { throw "Missing $required." }
}

# Catches a syntax error here rather than at install time on someone else's machine,
# where the only symptom is the installer window closing.
Write-Host '==> Checking the embedded scripts parse' -ForegroundColor Cyan
foreach ($script in $scripts) {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$null, [ref]$errors) | Out-Null
    if ($errors -and $errors.Count -gt 0) {
        $errors | ForEach-Object { Write-Host "    $($_.Extent.StartLineNumber): $($_.Message)" -ForegroundColor Red }
        throw "$(Split-Path -Leaf $script) has $($errors.Count) parse error(s)."
    }
    Write-Host "    $(Split-Path -Leaf $script)" -ForegroundColor Green
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null

$resourceArgs = $scripts | ForEach-Object { "/resource:$_,$(Split-Path -Leaf $_)" }

Write-Host "==> Compiling $(Split-Path -Leaf $OutputPath)" -ForegroundColor Cyan
& $csc /nologo /target:exe /platform:anycpu /optimize+ `
    "/out:$OutputPath" `
    @resourceArgs `
    $source

if ($LASTEXITCODE -ne 0) { throw "csc.exe failed with exit code $LASTEXITCODE." }

$size = [math]::Round((Get-Item $OutputPath).Length / 1KB, 1)
Write-Host "    $OutputPath (${size} KB)" -ForegroundColor Green
Write-Host ""
Write-Host "  To ship it for offline installs, export the image beside the exe:"
Write-Host "      docker save lcs/lcs:merged -o `"$(Join-Path (Split-Path -Parent $OutputPath) 'lcs-image.tar')`""
