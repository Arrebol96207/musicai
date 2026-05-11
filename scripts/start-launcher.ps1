$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$LogPath = Join-Path $Root ".claudio-launcher.log"
$PortStart = 3000
$PortEnd = 3010

function Write-LaunchLog {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Test-ClaudioPort {
  param([int]$Port)
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
    return $health.app -eq "ClaudioMusic" -and [string]::IsNullOrWhiteSpace($health.appVersion) -eq $false
  } catch {
    return $false
  }
}

function Find-ClaudioPort {
  foreach ($port in $PortStart..$PortEnd) {
    if (Test-ClaudioPort -Port $port) {
      return $port
    }
  }
  return 0
}

function Wait-ClaudioPort {
  param([int]$TimeoutSeconds)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $port = Find-ClaudioPort
    if ($port -gt 0) {
      return $port
    }
    Start-Sleep -Milliseconds 400
  }
  return 0
}

function Get-NodeCommand {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  return ""
}

$serverPath = Join-Path $Root "server.js"
if (-not (Test-Path -LiteralPath $serverPath)) {
  throw "server.js was not found. Put this launcher in the project root."
}

$node = Get-NodeCommand
if ([string]::IsNullOrWhiteSpace($node)) {
  throw "Node.js was not found. Install Node.js first, then run this launcher again."
}

$existingPort = Find-ClaudioPort
if ($existingPort -gt 0) {
  $url = "http://127.0.0.1:$existingPort/"
  Write-Host "Claudio Music is already running: $url"
  Start-Process $url
  exit 0
}

Write-Host "Starting Claudio Music backend..."
Write-LaunchLog "Starting server with $node"

$process = Start-Process -FilePath $node -ArgumentList "server.js" -WorkingDirectory $Root -WindowStyle Hidden -PassThru
Write-LaunchLog "Started process $($process.Id)"

$port = Wait-ClaudioPort -TimeoutSeconds 15
if ($port -le 0) {
  Write-LaunchLog "Server did not become ready."
  throw "Backend startup timed out. Run npm start in the project folder to see details."
}

$url = "http://127.0.0.1:$port/"
Write-Host "Claudio Music is ready: $url"
Start-Process $url
