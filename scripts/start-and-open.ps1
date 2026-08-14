$ErrorActionPreference = "Stop"

$Root = if ($PSScriptRoot) {
  Split-Path -Parent $PSScriptRoot
} else {
  Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

Set-Location $Root

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

function Test-ClaudioHealthUrl {
  param([string]$Url)

  if (-not $Url) { return $false }

  $healthUrl = $Url.TrimEnd("/") + "/api/health"
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
    return ($response.app -eq "ClaudioMusic" -and $response.appVersion)
  } catch {
    return $false
  }
}

function Get-ClaudioReadyUrlFromLog {
  param([string]$LogPath)

  if (-not (Test-Path $LogPath)) { return $null }

  $content = Get-Content -Path $LogPath -Raw -ErrorAction SilentlyContinue
  if (-not $content) { return $null }

  $matches = [regex]::Matches($content, "Claudio Music is ready at (http://127\.0\.0\.1:\d+/)")
  if ($matches.Count -eq 0) { return $null }

  return $matches[$matches.Count - 1].Groups[1].Value
}

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($false, "Local\ClaudioMusicLauncherStartup", [ref]$createdNew)
$lockTaken = $false
$process = $null
$exitCode = 1

try {
  try {
    $lockTaken = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
  } catch [System.Threading.AbandonedMutexException] {
    $lockTaken = $true
  }

  if (-not $lockTaken) {
    $existingUrl = Get-ClaudioHealthUrl
    if ($existingUrl) {
      Write-Host "Claudio Music is already running: $existingUrl" -ForegroundColor Green
      Start-Process $existingUrl
      $exitCode = 0
    } else {
      Write-Host "Another launcher is still starting Claudio Music. Please try again in a moment." -ForegroundColor Yellow
      $exitCode = 1
    }
  } else {
    $existingUrl = Get-ClaudioHealthUrl
    if ($existingUrl) {
      Write-Host "Claudio Music is already running: $existingUrl" -ForegroundColor Green
      Start-Process $existingUrl
      $exitCode = 0
    } else {
      $Node = Get-Command node -ErrorAction SilentlyContinue
      if (-not $Node) {
        Write-Host "Node.js not detected. Please install Node.js LTS first." -ForegroundColor Red
        $exitCode = 1
      } else {
        $logDir = Join-Path $Root ".tmp"
        if (-not (Test-Path $logDir)) {
          New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        }

        $outLog = Join-Path $logDir "claudio-start.out.log"
        $errLog = Join-Path $logDir "claudio-start.err.log"
        Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue

        $process = Start-Process -FilePath $Node.Source -ArgumentList "server.js" -WorkingDirectory $Root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -WindowStyle Normal

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
            $process = $null
            $exitCode = 1
            break
          }

          $readyUrl = Get-ClaudioReadyUrlFromLog $outLog
          if ($readyUrl -and (Test-ClaudioHealthUrl $readyUrl)) {
            $url = $readyUrl
            break
          }

          Start-Sleep -Milliseconds 500
        }

        if ($url) {
          Write-Host "Claudio Music started: $url" -ForegroundColor Green
          Start-Process $url
          Write-Host "Browser opened. Close this window or press Ctrl+C to stop the server." -ForegroundColor Yellow
          $exitCode = 0
        } elseif ($process) {
          Write-Host "Could not detect a running Claudio Music port within the time limit." -ForegroundColor Red
          $out = if (Test-Path $outLog) { Get-Content $outLog -Raw } else { "" }
          $err = if (Test-Path $errLog) { Get-Content $errLog -Raw } else { "" }
          if ($out) { Write-Host $out }
          if ($err) { Write-Host $err -ForegroundColor Red }
          if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
          $process = $null
          $exitCode = 1
        }
      }
    }
  }
} finally {
  if ($lockTaken) {
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
}

if ($exitCode -ne 0) {
  exit $exitCode
}

if ($process) {
  $process.WaitForExit()

  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}

exit 0
