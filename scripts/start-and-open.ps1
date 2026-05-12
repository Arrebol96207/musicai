$ErrorActionPreference = "Stop"

$Root = if ($PSScriptRoot) {
  Split-Path -Parent $PSScriptRoot
} else {
  Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) {
  Write-Host "Node.js not detected. Please install Node.js LTS first." -ForegroundColor Red
  exit 1
}

Set-Location $Root

$logDir = Join-Path $Root ".tmp"
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$outLog = Join-Path $logDir "claudio-start.out.log"
$errLog = Join-Path $logDir "claudio-start.err.log"
Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue

$process = Start-Process -FilePath $Node.Source -ArgumentList "server.js" -WorkingDirectory $Root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -WindowStyle Normal

function Get-ClaudioHealthUrl {
  param([int]$StartPort = 3000, [int]$Count = 30)

  for ($port = $StartPort; $port -lt ($StartPort + $Count); $port++) {
    $healthUrl = "http://127.0.0.1:$port/api/health"
    try {
      $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
      if ($response.app -eq "ClaudioMusic" -and $response.appVersion) {
        return "http://127.0.0.1:$port/"
      }
    } catch {}
  }

  return $null
}

Write-Host "Waiting for Claudio Music to start..." -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(20)
$url = $null

while ((Get-Date) -lt $deadline) {
  if ($process.HasExited) {
    $out = if (Test-Path $outLog) { Get-Content $outLog -Raw } else { "" }
    $err = if (Test-Path $errLog) { Get-Content $errLog -Raw } else { "" }
    Write-Host "Server failed to start." -ForegroundColor Red
    if ($out) { Write-Host $out }
    if ($err) { Write-Host $err -ForegroundColor Red }
    exit 1
  }

  $url = Get-ClaudioHealthUrl
  if ($url) { break }
  Start-Sleep -Milliseconds 500
}

if (-not $url) {
  Write-Host "Could not detect a running Claudio Music port within the time limit." -ForegroundColor Red
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  exit 1
}

Write-Host "Claudio Music started: $url" -ForegroundColor Green
Start-Process $url
Write-Host "Browser opened. Close this window or press Ctrl+C to stop the server." -ForegroundColor Yellow
$process.WaitForExit()

if (-not $process.HasExited) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}