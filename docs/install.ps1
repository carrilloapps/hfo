<#
  hfo install script for Windows (PowerShell 5+).

  Usage:
    irm https://hfo.carrillo.app/install.ps1 | iex

  Downloads the latest release binary matching your CPU architecture from
  https://github.com/carrilloapps/hfo/releases/latest and installs it to
  %LOCALAPPDATA%\Programs\hfo\hfo.exe, then appends that directory to your
  USER PATH. No admin / elevated prompt required.

  Override defaults via environment variables:
    $env:HFO_VERSION='v0.2.0'           install a specific tag (default: latest)
    $env:HFO_INSTALL_DIR='D:\Apps\hfo'  install to a custom directory
#>

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Repo        = 'carrilloapps/hfo'
$Version     = if ($env:HFO_VERSION)     { $env:HFO_VERSION }     else { 'latest' }
$InstallDir  = if ($env:HFO_INSTALL_DIR) { $env:HFO_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\hfo' }
$Target      = Join-Path $InstallDir 'hfo.exe'
$ReleasePath = if ($Version -eq 'latest') { 'releases/latest/download' } else { "releases/download/$Version" }

# --- Architecture detection -------------------------------------------
$arch = 'x64'
try {
  $proc = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1
  if ($proc.Architecture -eq 12) { $arch = 'arm64' }
} catch {
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
}

$asset = "hfo-win-$arch.exe"
$url   = "https://github.com/$Repo/$ReleasePath/$asset"

Write-Host "hfo: downloading $asset"

# --- Prepare directory + download -------------------------------------
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
try {
  # Use TLS 1.2 explicitly for older PowerShell hosts.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $Target -UseBasicParsing -ErrorAction Stop
} catch {
  Write-Error "hfo: download failed from $url. If v$Version is not published yet, install via npm instead:`n    npm i -g hfo-cli"
  exit 1
}

Write-Host "hfo: installed to $Target"

# --- PATH (user scope) ------------------------------------------------
$currentUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$paths = if ($currentUserPath) { $currentUserPath -split ';' | Where-Object { $_ } } else { @() }
if ($paths -notcontains $InstallDir) {
  $newPath = if ($currentUserPath) { "$currentUserPath;$InstallDir" } else { $InstallDir }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Write-Host "hfo: appended $InstallDir to your USER PATH. Open a new terminal for it to take effect."
} else {
  Write-Host "hfo: $InstallDir already on PATH."
}

# --- Verify + hint ----------------------------------------------------
try {
  & $Target --version
} catch {}
Write-Host ""
Write-Host "hfo: run 'hfo' to open the TUI, or 'hfo --help' for the CLI reference."
