$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Project = Join-Path $Root "launcher\ClaudioMusicLauncher.csproj"
$Output = Join-Path $Root "launcher\bin\Release\net8.0\win-x64\ClaudioMusic.exe"
$Target = Join-Path $Root "ClaudioMusic.exe"

$SdkList = dotnet --list-sdks 2>$null
if (-not $SdkList) {
  throw "No .NET SDK was found. Install the .NET 8 SDK, then run scripts\build-launcher.ps1 again."
}

dotnet build $Project -c Release

if (-not (Test-Path $Output)) {
  throw "Build completed, but $Output was not found."
}

Copy-Item -LiteralPath $Output -Destination $Target -Force
Write-Host "Updated $Target"
