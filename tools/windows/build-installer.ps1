<#
.SYNOPSIS
    Compiles LCS-Setup.exe from LcsSetup.cs and ui\*.cs, embedding the PowerShell payload.

.DESCRIPTION
    Uses the .NET Framework 4 C# compiler that ships with Windows, so producing the
    installer needs no SDK download. The output is a single self-contained exe that runs
    on any Windows machine without a runtime install.

    That compiler is C# 5, and the installer's source is written to that language level
    deliberately - no string interpolation, no ?., no expression-bodied members.

.PARAMETER SkipIcon
    Do not generate lcs.ico. The icon is drawn with System.Drawing at build time; skip it if
    a build host has no GDI+.

.EXAMPLE
    .\build-installer.ps1
#>
[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $PSScriptRoot 'dist\LCS-Setup.exe'),
    [switch]$SkipIcon
)

$ErrorActionPreference = 'Stop'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
    throw "No .NET Framework 4 C# compiler found under $env:WINDIR\Microsoft.NET. Install the .NET Framework 4.x developer files, or build with 'dotnet build' instead."
}

$sources = @(Join-Path $PSScriptRoot 'LcsSetup.cs') +
           @(Get-ChildItem (Join-Path $PSScriptRoot 'ui') -Filter *.cs | ForEach-Object { $_.FullName })
$manifest = Join-Path $PSScriptRoot 'LcsSetup.manifest'
$scripts = @(
    (Join-Path $PSScriptRoot 'lcs-install.ps1'),
    (Join-Path $PSScriptRoot 'lcs.ps1')
)
foreach ($required in $sources + $scripts + @($manifest)) {
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

# Drawn rather than checked in: a binary asset in the tree is one more thing to keep in step
# with the palette, and this is a rounded square with a letter in it.
function New-SetupIcon {
    param([string]$Path)

    Add-Type -AssemblyName System.Drawing
    $sizes  = @(16, 32, 48, 256)
    $images = @()

    foreach ($size in $sizes) {
        $bitmap   = New-Object System.Drawing.Bitmap($size, $size)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.SmoothingMode = 'AntiAlias'
        $graphics.TextRenderingHint = 'AntiAliasGridFit'

        $radius = [int]($size / 5)
        # Not $path: this function's parameter is $Path, and PowerShell variable names are
        # case-insensitive, so assigning to it would coerce the shape to a string.
        $shape  = New-Object System.Drawing.Drawing2D.GraphicsPath
        $d      = $radius * 2
        $max    = $size - 1
        $shape.AddArc(0, 0, $d, $d, 180, 90)
        $shape.AddArc($max - $d, 0, $d, $d, 270, 90)
        $shape.AddArc($max - $d, $max - $d, $d, $d, 0, 90)
        $shape.AddArc(0, $max - $d, $d, $d, 90, 90)
        $shape.CloseFigure()

        $ink   = [System.Drawing.Color]::FromArgb(0x16, 0x19, 0x1F)
        $amber = [System.Drawing.Color]::FromArgb(0xFF, 0x99, 0x00)
        $graphics.FillPath((New-Object System.Drawing.SolidBrush($ink)), $shape)

        $font   = New-Object System.Drawing.Font('Segoe UI', ($size * 0.52), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $format = New-Object System.Drawing.StringFormat
        $format.Alignment = 'Center'
        $format.LineAlignment = 'Center'
        $graphics.DrawString('L', $font, (New-Object System.Drawing.SolidBrush($amber)),
            (New-Object System.Drawing.RectangleF(0, 0, $size, $size)), $format)

        $graphics.Dispose()

        $stream = New-Object System.IO.MemoryStream
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $bitmap.Dispose()
        $images += ,@($size, $stream.ToArray())
    }

    # ICO container by hand: a 6-byte header, a 16-byte directory entry per image, then the
    # PNG bytes. Windows has accepted PNG-compressed icon images since Vista.
    $out    = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($out)
    $writer.Write([uint16]0)               # reserved
    $writer.Write([uint16]1)               # type: icon
    $writer.Write([uint16]$images.Count)

    $offset = 6 + 16 * $images.Count
    foreach ($image in $images) {
        $size  = $image[0]
        $bytes = $image[1]
        $writer.Write([byte]($(if ($size -ge 256) { 0 } else { $size })))   # 0 means 256
        $writer.Write([byte]($(if ($size -ge 256) { 0 } else { $size })))
        $writer.Write([byte]0)             # palette entries
        $writer.Write([byte]0)             # reserved
        $writer.Write([uint16]1)           # colour planes
        $writer.Write([uint16]32)          # bits per pixel
        $writer.Write([uint32]$bytes.Length)
        $writer.Write([uint32]$offset)
        $offset += $bytes.Length
    }
    foreach ($image in $images) { $writer.Write($image[1]) }

    $writer.Flush()
    [System.IO.File]::WriteAllBytes($Path, $out.ToArray())
    $writer.Dispose()
}

$iconArgs = @()
if (-not $SkipIcon) {
    $icon = Join-Path $PSScriptRoot 'dist\lcs.ico'
    Write-Host '==> Drawing the setup icon' -ForegroundColor Cyan
    New-SetupIcon -Path $icon
    Write-Host "    $(Split-Path -Leaf $icon)" -ForegroundColor Green
    $iconArgs = @("/win32icon:$icon")
}

$resourceArgs = $scripts | ForEach-Object { "/resource:$_,$(Split-Path -Leaf $_)" }

Write-Host "==> Compiling $(Split-Path -Leaf $OutputPath)" -ForegroundColor Cyan
# /target:winexe so a double-click does not flash a console window behind the installer.
# /silent still writes to a console: the exe attaches to its caller's.
& $csc /nologo /target:winexe /platform:anycpu /optimize+ `
    "/out:$OutputPath" `
    "/win32manifest:$manifest" `
    /reference:System.Windows.Forms.dll `
    /reference:System.Drawing.dll `
    @iconArgs `
    @resourceArgs `
    @sources

if ($LASTEXITCODE -ne 0) { throw "csc.exe failed with exit code $LASTEXITCODE." }

$size = [math]::Round((Get-Item $OutputPath).Length / 1KB, 1)
Write-Host "    $OutputPath (${size} KB)" -ForegroundColor Green
Write-Host ""
Write-Host "  Look at the window without installing anything:"
Write-Host "      $OutputPath /preview"
Write-Host ""
Write-Host "  To ship it for offline installs, export the image beside the exe:"
Write-Host "      docker save lcs/lcs:merged -o `"$(Join-Path (Split-Path -Parent $OutputPath) 'lcs-image.tar')`""
