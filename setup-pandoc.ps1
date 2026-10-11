<#
  setup-pandoc.ps1 -- check and, when needed, install Pandoc for mdTOdocx.

  What it does:
    1. looks for pandoc.exe (PATH plus the usual install folders)
    2. verifies version, the +server feature and "pandoc server --help"
    3. when missing / too old / not usable it installs the latest release:
         - preferred: winget install -e --id JohnMacFarlane.Pandoc
         - fallback : official windows-x86_64.zip from GitHub into
                      %LOCALAPPDATA%\Pandoc (+ idempotent user PATH update)
    4. reloads PATH for this session and verifies the result again

  Exit code: 0 = pandoc is ready, 1 = something failed.

  Examples:
    powershell -NoProfile -ExecutionPolicy Bypass -File setup-pandoc.ps1 -DryRun
    powershell -NoProfile -ExecutionPolicy Bypass -File setup-pandoc.ps1 -MinVersion 3.1
    powershell -NoProfile -ExecutionPolicy Bypass -File setup-pandoc.ps1 -Method zip -Force
#>
[CmdletBinding()]
param(
  [string]$MinVersion = '3.0',        # install/upgrade when the current version is older
  [string]$RequiredVersion = '',      # pin an exact version, e.g. 3.12.1 (empty = latest)
  [ValidateSet('auto', 'winget', 'zip')]
  [string]$Method = 'auto',           # auto = winget first, then the GitHub zip fallback
  [switch]$Force,                     # install even when the current pandoc is fine
  [switch]$DryRun                     # only report what would be done, never touch the machine
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$LASTEXITCODE = 0                  # set before the first external call (StrictMode safety)

# --------------------------------------------------------------- constants
$WINGET_ID   = 'JohnMacFarlane.Pandoc'
$RELEASE_API = 'https://api.github.com/repos/jgm/pandoc/releases/latest'
$ZIP_PATTERN = 'pandoc-*-windows-x86_64.zip'
$ZIP_HOME    = Join-Path $env:LOCALAPPDATA 'Pandoc'
$UA          = @{ 'User-Agent' = 'mdTOdocx-setup-pandoc' }

# PowerShell 5.1 needs -UseBasicParsing, PowerShell 6+ does not know that switch
$script:WebArgs = @{}
if ($PSVersionTable.PSVersion.Major -le 5) { $script:WebArgs['UseBasicParsing'] = $true }

# --------------------------------------------------------------- log helpers
function Write-Rule { Write-Host '--------------------------------------------' }
function Write-Step {
  param([int]$Index, [int]$Total, [string]$Message)
  Write-Host ''
  Write-Host ("[{0}/{1}] {2}" -f $Index, $Total, $Message)
}

# --------------------------------------------------------------- detection
function Get-PandocExe {
  # 1) anything named pandoc on PATH wins
  $cmd = Get-Command pandoc -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  # 2) otherwise look into the well known install locations
  $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Pandoc\pandoc.exe'),
    (Join-Path $env:ProgramFiles 'Pandoc\pandoc.exe'),
    (Join-Path $env:USERPROFILE 'scoop\shims\pandoc.exe'),
    'C:\ProgramData\chocolatey\bin\pandoc.exe'
  )
  if ($pf86) { $candidates += (Join-Path $pf86 'Pandoc\pandoc.exe') }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return ''
}

function Get-PandocInfo {
  param([string]$Exe)
  $result = [ordered]@{ Version = ''; Features = ''; ServerOk = $false; Raw = '' }
  if (-not $Exe) { return [pscustomobject]$result }
  try {
    $out = @(& $Exe --version 2>$null)
    if ($LASTEXITCODE -eq 0 -and $out.Count -gt 0) {
      $result.Raw = [string]$out[0]
      $m = [regex]::Match($result.Raw, '(\d+(\.\d+)+)')
      if ($m.Success) { $result.Version = $m.Groups[1].Value }
      foreach ($line in $out) {
        if ("$line" -match '^\s*Features:') { $result.Features = "$line".Trim(); break }
      }
    }
    # the server sub-command is what start-server.bat needs (pandoc 3.x + server)
    $null = & $Exe server --help 2>$null
    if ($LASTEXITCODE -eq 0) { $result.ServerOk = $true }
  } catch {
    # a broken pandoc.exe must not stop the script: it is reported as not usable
  }
  return [pscustomobject]$result
}

function Get-VersionParts {
  param([string]$Version)
  $clean = ($Version -replace '[^0-9\.].*$', '')
  $parts = @()
  foreach ($p in ($clean -split '\.')) { if ($p -ne '') { $parts += [int]$p } }
  while ($parts.Count -lt 3) { $parts += 0 }
  return $parts
}

function Test-VersionGE {
  param([string]$Have, [string]$Need)
  $h = Get-VersionParts $Have
  $n = Get-VersionParts $Need
  for ($i = 0; $i -lt 3; $i++) {
    if ($h[$i] -gt $n[$i]) { return $true }
    if ($h[$i] -lt $n[$i]) { return $false }
  }
  return $true
}

function Test-VersionEQ {
  param([string]$Have, [string]$Need)
  if (-not $Have -or -not $Need) { return $false }
  $h = Get-VersionParts $Have
  $n = Get-VersionParts $Need
  for ($i = 0; $i -lt 3; $i++) { if ($h[$i] -ne $n[$i]) { return $false } }
  return $true
}

# --------------------------------------------------------------- installation
function Add-UserPath {
  param([string]$Dir)
  # idempotent helper: repeated repair runs must not duplicate PATH entries
  if ($DryRun) { Write-Host ('  [dry-run] would add to user PATH: ' + $Dir); return }
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $current) { $current = '' }
  $parts = @($current -split ';' | Where-Object { $_ -ne '' })
  if ($parts -contains $Dir) { Write-Host ('  user PATH already contains: ' + $Dir); return }
  [Environment]::SetEnvironmentVariable('Path', (($parts + $Dir) -join ';'), 'User')
  Write-Host ('  added to user PATH: ' + $Dir)
}

function Update-SessionPath {
  # winget and the MSI installer write to the registry, not into this process,
  # so rebuild $env:Path from Machine + User before the final verification
  if ($DryRun) { return }
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = ((@($machinePath, $userPath) | Where-Object { $_ }) -join ';')
}

function Install-WithWinget {
  param([string]$Version)
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { Write-Host '  winget is not available on this machine'; return $false }
  $wargs = @('install', '-e', '--id', $WINGET_ID, '--silent', '--accept-package-agreements', '--accept-source-agreements')
  if ($Version) { $wargs += @('--version', $Version) }
  if ($DryRun) { Write-Host ('  [dry-run] winget ' + ($wargs -join ' ')); return $true }
  Write-Host ('  running: winget ' + ($wargs -join ' '))
  & $winget.Source @wargs
  if ($LASTEXITCODE -eq 0) { return $true }
  Write-Host ('  winget exited with code ' + $LASTEXITCODE)
  return $false
}

function Install-WithZip {
  # fallback without winget: download the official Windows zip and unpack it into
  # %LOCALAPPDATA%\Pandoc (no admin rights, no registry writes, one single exe)
  if ($DryRun) {
    $asset = $null
    $err = ''
    try {
      $release = Invoke-RestMethod -Uri $RELEASE_API -Headers $UA @script:WebArgs
      $asset = @($release.assets | Where-Object { $_.name -like $ZIP_PATTERN }) | Select-Object -First 1
    } catch { $err = $_.Exception.Message }
    if ($asset) {
      Write-Host ('  [dry-run] would download ' + $asset.name)
      Write-Host ('  [dry-run] would unpack it into ' + $ZIP_HOME)
    } elseif ($err) {
      Write-Host ('  [dry-run] GitHub request failed: ' + $err)
    } else {
      Write-Host ('  [dry-run] no asset matching ' + $ZIP_PATTERN + ' in the latest release')
    }
    return $true
  }
  $tempDir = Join-Path $env:TEMP ('md2docx-pandoc-' + (Get-Date -Format 'yyyyMMddHHmmss'))
  try {
    Write-Host '  querying the latest release on GitHub ...'
    $release = Invoke-RestMethod -Uri $RELEASE_API -Headers $UA @script:WebArgs
    $asset = @($release.assets | Where-Object { $_.name -like $ZIP_PATTERN }) | Select-Object -First 1
    if (-not $asset) {
      throw ('no asset matching ' + $ZIP_PATTERN + ' in release ' + $release.tag_name)
    }
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $zip = Join-Path $tempDir 'pandoc.zip'
    Write-Host ('  downloading ' + $asset.name + ' ...')
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -Headers $UA @script:WebArgs
    New-Item -ItemType Directory -Force -Path $ZIP_HOME | Out-Null
    Write-Host ('  unpacking into ' + $ZIP_HOME + ' ...')
    Expand-Archive -Path $zip -DestinationPath $ZIP_HOME -Force
    # the archive holds a versioned folder, so lift pandoc.exe up one level
    $exe = Join-Path $ZIP_HOME 'pandoc.exe'
    if (-not (Test-Path -LiteralPath $exe)) {
      $found = Get-ChildItem -Path $ZIP_HOME -Filter 'pandoc.exe' -Recurse -File | Select-Object -First 1
      if (-not $found) { throw 'pandoc.exe was not found inside the downloaded archive' }
      Copy-Item -LiteralPath $found.FullName -Destination $exe -Force
      Remove-Item -LiteralPath $found.Directory.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
    Add-UserPath $ZIP_HOME
    return $true
  } catch {
    Write-Host ('  zip install failed: ' + $_.Exception.Message)
    return $false
  } finally {
    if (Test-Path -LiteralPath $tempDir) {
      Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
# --------------------------------------------------------------- main
# GitHub needs TLS 1.2; Windows PowerShell 5.1 may still default to TLS 1.0
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

Write-Rule
Write-Host ' mdTOdocx - Pandoc environment check / setup'
Write-Rule
Write-Host ('  min version    : ' + $MinVersion)
Write-Host ('  exact version  : ' + $(if ($RequiredVersion) { $RequiredVersion } else { '(latest)' }))
Write-Host ('  install method : ' + $Method)
if ($DryRun) { Write-Host '  mode           : DRY-RUN (nothing will be installed or changed)' }

Write-Step 1 5 'looking for pandoc.exe'
$exe = Get-PandocExe
if ($exe) { Write-Host ('  found: ' + $exe) } else { Write-Host '  not found on PATH nor in the usual install folders' }

$info = [pscustomobject]@{ Version = ''; Features = ''; ServerOk = $false; Raw = '' }
if ($exe) {
  Write-Step 2 5 'reading version, features and server support'
  $info = Get-PandocInfo -Exe $exe
  Write-Host ('  version : ' + $(if ($info.Version) { $info.Version } else { '(unknown)' }))
  Write-Host ('  features: ' + $(if ($info.Features) { $info.Features } else { '(unknown)' }))
  Write-Host ('  pandoc server: ' + $(if ($info.ServerOk) { 'available' } else { 'NOT available' }))
}

Write-Step 3 5 'evaluating the installation'
$reason = ''
if (-not $exe) { $reason = 'pandoc is not installed' }
elseif (-not $info.Version) { $reason = 'pandoc --version could not be read' }
elseif ($RequiredVersion -and -not (Test-VersionEQ $info.Version $RequiredVersion)) { $reason = 'version ' + $info.Version + ' does not match the required ' + $RequiredVersion }
elseif (-not (Test-VersionGE $info.Version $MinVersion)) { $reason = 'version ' + $info.Version + ' is older than ' + $MinVersion }
elseif (-not $info.ServerOk) {
  if ($info.Features -notmatch '\+server') { $reason = 'this build has no +server feature (not an official release)' }
  else { $reason = 'the pandoc server sub-command is not usable' }
}

$needsInstall = $false
if ($reason) {
  Write-Host ('  result: needs setup - ' + $reason)
  $needsInstall = $true
} elseif ($Force) {
  Write-Host '  result: usable, but -Force was given -> installing the latest release'
  $needsInstall = $true
} else {
  Write-Host '  result: OK, nothing to do'
}
Write-Step 4 5 'installing pandoc (only when needed)'
if (-not $needsInstall) {
  Write-Host '  skipped: the current installation is already usable'
} else {
  $installed = $false
  if ($Method -eq 'auto' -or $Method -eq 'winget') {
    $installed = Install-WithWinget -Version $RequiredVersion
    if (-not $installed -and $Method -eq 'winget') {
      Write-Host '  winget was requested explicitly: the zip fallback is skipped'
    }
  }
  if (-not $installed -and $Method -ne 'winget') {
    Write-Host '  falling back to the official Windows zip from GitHub'
    $installed = Install-WithZip
  }
  if (-not $installed) {
    Write-Rule
    Write-Host ' [ERROR] automatic installation failed.'
    Write-Host ' Install Pandoc manually and run this script again:'
    Write-Host ('   winget install -e --id ' + $WINGET_ID)
    Write-Host '   https://pandoc.org/installing.html'
    exit 1
  }
}

Write-Step 5 5 're-checking after the installation step'
Update-SessionPath
$exeAfter = Get-PandocExe
$finalOk = $false
if ($exeAfter) {
  $after = Get-PandocInfo -Exe $exeAfter
  Write-Host ('  path    : ' + $exeAfter)
  Write-Host ('  version : ' + $(if ($after.Version) { $after.Version } else { '(unknown)' }))
  Write-Host ('  features: ' + $(if ($after.Features) { $after.Features } else { '(unknown)' }))
  if ($after.Version -and (Test-VersionGE $after.Version $MinVersion) -and $after.ServerOk) { $finalOk = $true }
}

Write-Rule
if ($finalOk) {
  Write-Host ' [OK] pandoc is ready. You can start start-server.bat now.'
  if ($DryRun) { Write-Host '      (dry-run: nothing was installed and nothing was changed)' }
  exit 0
}
if ($DryRun) {
  Write-Host ' [DRY-RUN] no change was made. Run the script again without -DryRun to install.'
  exit 0
}
Write-Host ' [ERROR] pandoc is still not usable - see the messages above.'
exit 1