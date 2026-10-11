<#
  setup-python.ps1 -- check and, when needed, install Python 3 for mdTOdocx.

  Why this exists:
    serve-pages.py (the no-cache page server, port 8080) and convert-server.py
    (the Word/HTML -> Markdown bridge, port 3040) are plain Python 3 scripts
    that only use the standard library. No pip packages are required, so a
    working interpreter plus a valid PATH is all this project needs.

  What it does:
    1. looks for a usable Python 3 interpreter:
         - the py launcher (py -3)
         - python / python3 on PATH (a Store alias stub fails the test below)
         - the usual install folders (python.org, Scoop, Chocolatey,
           Anaconda / Miniconda)
    2. verifies that the interpreter really runs and is >= -MinVersion
       (3.7 by default: ThreadingHTTPServer and SimpleHTTPRequestHandler with
       the directory argument need Python 3.7 or newer)
    3. only when nothing usable is found it installs the newest stable release
       that fits this machine:
         - preferred: winget install -e --id Python.Python.3.x
         - fallback : the official python.org installer for this CPU
                      (amd64 / arm64 / x86), then a regional mirror
    4. configures the environment afterwards:
         - rebuilds PATH for this session
         - appends the install dir and its Scripts folder to the USER PATH
           (idempotent, no admin rights, system PATH is never touched)
         - smoke tests: version, stdlib imports, syntax check of both scripts

  Installer options (every box ticked, default target directory, no admin):
    InstallAllUsers=0 PrependPath=1 Include_launcher=1 InstallLauncherAllUsers=0
    Include_pip=1 Include_doc=1 Include_dev=1 Include_exe=1 Include_lib=1
    Include_test=1 Include_tcltk=1 Include_tools=1 AssociateFiles=1
    Shortcuts=1 CompileAll=1
    (-IncludeDebug adds Include_debug=1 Include_symbols=1; off by default,
     because it turns a ~30 MB download into a 400 MB+ one)
    TargetDir is never passed, so the official default location is used:
      user scope    : %LOCALAPPDATA%\Programs\Python\Python3xx
      machine scope : %ProgramFiles%\Python3xx

  Exit code: 0 = Python is ready, 1 = something failed.

  Examples:
    powershell -NoProfile -ExecutionPolicy Bypass -File setup-python.ps1 -DryRun
    powershell -NoProfile -ExecutionPolicy Bypass -File setup-python.ps1 -MinVersion 3.8
    powershell -NoProfile -ExecutionPolicy Bypass -File setup-python.ps1 -Method official
    powershell -NoProfile -ExecutionPolicy Bypass -File setup-python.ps1 -Force
#>
[CmdletBinding()]
param(
  [string]$MinVersion = '3.7',        # a Python older than this counts as missing
  [string]$RequiredVersion = '',      # pin an exact version, e.g. 3.13.7 (empty = newest stable)
  [ValidateSet('auto', 'winget', 'official', 'mirror')]
  [string]$Method = 'auto',           # auto = winget first, then official installer, then mirror
  [ValidateSet('User', 'AllUsers')]
  [string]$Scope = 'User',            # User = %LOCALAPPDATA%, no admin rights needed
  [switch]$IncludeDebug,              # also tick "Download debug binaries" (adds ~370 MB)
  [switch]$Quiet,                     # /quiet instead of /passive (no progress window)
  [switch]$Force,                     # install even when a usable Python exists
  [switch]$DryRun                     # only report what would be done, change nothing
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$LASTEXITCODE = 0                  # set before the first external call (StrictMode safety)

# --------------------------------------------------------------- constants
$SCRIPT_DIR   = Split-Path -Parent $MyInvocation.MyCommand.Path
$WINGET_IDS   = @('Python.Python.3.15', 'Python.Python.3.14', 'Python.Python.3.13', 'Python.Python.3.12')
$PY_FTP_INDEX = 'https://www.python.org/ftp/python/'
$MIRROR_INDEX = @(
  'https://mirrors.huaweicloud.com/python/',
  'https://registry.npmmirror.com/-/binary/python/'
)
$UA           = @{ 'User-Agent' = 'mdTOdocx-setup-python' }
$SMOKE_FILES  = @('serve-pages.py', 'convert-server.py')

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

# --------------------------------------------------------------- version helpers
function Get-VersionParts {
  # '3.13.7' -> @(3,13,7); anything unparsable becomes zeros
  param([string]$Version)
  $clean = ($Version -replace '[^0-9\.].*$', '')
  $parts = @()
  foreach ($p in ($clean -split '\.')) {
    if ($p -match '^\d+$') { $parts += [int]$p } else { $parts += 0 }
  }
  while ($parts.Count -lt 3) { $parts += 0 }
  return @($parts[0], $parts[1], $parts[2])
}

function Test-VersionGE {
  # true when $Have is greater or equal to $Need
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
  return (($h[0] -eq $n[0]) -and ($h[1] -eq $n[1]) -and ($h[2] -eq $n[2]))
}

function Compare-VersionNewer {
  # true when $A is strictly newer than $B (both plain x.y.z strings)
  param([string]$A, [string]$B)
  $x = Get-VersionParts $A
  $y = Get-VersionParts $B
  for ($i = 0; $i -lt 3; $i++) {
    if ($x[$i] -gt $y[$i]) { return $true }
    if ($x[$i] -lt $y[$i]) { return $false }
  }
  return $false
}

# --------------------------------------------------------------- detection
function Get-PythonInfo {
  # runs one candidate and returns its version plus the real executable path
  param([string]$Exe)
  $result = [ordered]@{ Exe = $Exe; Version = ''; RealPath = ''; Usable = $false }
  if (-not $Exe) { return [pscustomobject]$result }
  if (-not (Test-Path -LiteralPath $Exe)) { return [pscustomobject]$result }
  try {
    # Python 3.4+ prints --version on stdout; a Store alias stub fails here
    $out = @(& $Exe --version 2>&1)
    if ($out.Count -gt 0) {
      $m = [regex]::Match(($out -join ' '), '(\d+\.\d+\.\d+)')
      if ($m.Success) { $result.Version = $m.Groups[1].Value }
    }
  } catch { }
  if (-not $result.Version) { return [pscustomobject]$result }
  try {
    # no spaces in the snippet, so no quoting trouble on any PowerShell version
    $real = @(& $Exe -c 'import sys;print(sys.executable)' 2>&1)
    if ($real.Count -gt 0) { $result.RealPath = ($real[0] | Out-String).Trim() }
  } catch { }
  if (-not $result.RealPath) { $result.RealPath = $Exe }
  $result.Usable = $true
  return [pscustomobject]$result
}

function Get-PythonCandidates {
  # every place a Python 3 interpreter may live on this machine
  $list = @()

  # 1) the py launcher knows every registered installation
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if ($launcher) {
    try {
      $found = @(& $launcher.Source -3 -c 'import sys;print(sys.executable)' 2>$null)
      foreach ($f in $found) {
        $p = ($f | Out-String).Trim()
        if ($p -and (Test-Path -LiteralPath $p)) { $list += $p }
      }
    } catch { }
  }

  # 2) python / python3 on PATH (a Store alias stub is dropped by the caller)
  foreach ($name in @('python', 'python3')) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { $list += $cmd.Source }
  }

  # 3) the well known install folders, including conda and scoop
  $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  $patterns = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python3*\python.exe'),
    (Join-Path $env:ProgramFiles 'Python3*\python.exe'),
    (Join-Path $env:USERPROFILE 'anaconda3\python.exe'),
    (Join-Path $env:USERPROFILE 'miniconda3\python.exe'),
    (Join-Path $env:USERPROFILE 'scoop\shims\python.exe'),
    'C:\ProgramData\chocolatey\bin\python.exe'
  )
  if ($pf86) { $patterns += (Join-Path $pf86 'Python3*\python.exe') }
  if ($env:ProgramData) {
    $patterns += (Join-Path $env:ProgramData 'anaconda3\python.exe')
    $patterns += (Join-Path $env:ProgramData 'miniconda3\python.exe')
  }
  foreach ($pattern in $patterns) {
    foreach ($hit in (Resolve-Path -Path $pattern -ErrorAction SilentlyContinue)) {
      $list += $hit.Path
    }
  }

  # de-duplicate, keep the original order
  $seen = @{}
  $unique = @()
  foreach ($item in $list) {
    $key = $item.ToLowerInvariant()
    if (-not $seen.ContainsKey($key)) { $seen[$key] = $true; $unique += $item }
  }
  return $unique
}

function Find-UsablePython {
  # newest interpreter that really runs and satisfies $Need, or $null
  param([string]$Need)
  $best = $null
  foreach ($exe in @(Get-PythonCandidates)) {
    $info = Get-PythonInfo -Exe $exe
    if (-not $info.Usable) { continue }
    if (-not (Test-VersionGE $info.Version $Need)) { continue }
    if ($null -eq $best -or (Compare-VersionNewer $info.Version $best.Version)) { $best = $info }
  }
  return $best
}

# --------------------------------------------------------------- release lookup
function Get-InstallerArch {
  # the suffix the official installer uses for this CPU
  $arch = ''
  if ($env:PROCESSOR_ARCHITECTURE) { $arch = $env:PROCESSOR_ARCHITECTURE.ToUpperInvariant() }
  if ($arch -eq 'ARM64') { return 'arm64' }
  if (-not [Environment]::Is64BitOperatingSystem) { return 'x86' }   # 32-bit Windows
  return 'amd64'
}

function Get-InstallerFileName {
  param([string]$Version, [string]$Arch)
  if ($Arch -eq 'x86') { return ('python-{0}.exe' -f $Version) }
  return ('python-{0}-{1}.exe' -f $Version, $Arch)
}

function Get-IndexVersions {
  # parses a python.org style directory listing; '3.15.0a5/' and '3.15.0rc1/'
  # never match the pattern below, so pre-releases are filtered out
  param([string]$Url)
  $text = ''
  try {
    $resp = Invoke-WebRequest -Uri $Url -Headers $UA -TimeoutSec 15 @script:WebArgs
    $text = [string]$resp.Content
  } catch {
    Write-Host ('  cannot read ' + $Url + ' : ' + $_.Exception.Message)
    return @()
  }
  $versions = @()
  foreach ($m in [regex]::Matches($text, 'href="(\d+\.\d+\.\d+)/?"')) {
    $versions += $m.Groups[1].Value
  }
  # an empty result collapses to $null here; every caller wraps the call in
  # @(...) so that .Count stays valid under Set-StrictMode
  return @($versions | Sort-Object -Unique)
}

function Resolve-NewestStableVersion {
  # newest stable release: python.org first, then the regional mirrors
  # (-Method mirror flips the order so a domestic mirror answers first)
  param([string]$Prefer = 'official')
  $indexes = @($PY_FTP_INDEX) + $MIRROR_INDEX
  if ($Prefer -eq 'mirror') { $indexes = @($MIRROR_INDEX + $PY_FTP_INDEX) }
  foreach ($index in $indexes) {
    Write-Host ('  reading release list: ' + $index)
    $versions = @(Get-IndexVersions -Url $index)
    if ($versions.Count -eq 0) { continue }
    $candidate = ''
    foreach ($v in $versions) {
      if ($candidate -eq '' -or (Compare-VersionNewer $v $candidate)) { $candidate = $v }
    }
    if ($candidate) {
      Write-Host ('  newest stable release found: ' + $candidate)
      return $candidate
    }
  }
  return ''
}

function Get-InstallerUrls {
  # official download first, regional mirrors last (or reversed with -Method mirror)
  param([string]$Version, [string]$Arch, [string]$Prefer)
  $file = Get-InstallerFileName -Version $Version -Arch $Arch
  $official = @('https://www.python.org/ftp/python/' + $Version + '/' + $file)
  $mirrors = @(
    ('https://mirrors.huaweicloud.com/python/{0}/{1}' -f $Version, $file),
    ('https://registry.npmmirror.com/-/binary/python/{0}/{1}' -f $Version, $file)
  )
  if ($Prefer -eq 'mirror') { return @($mirrors + $official) }
  return @($official + $mirrors)
}

# --------------------------------------------------------------- installation
function Get-InstallerOptions {
  # every checkbox ticked; TargetDir is intentionally absent (default location)
  $mode = '/passive'
  if ($Quiet) { $mode = '/quiet' }
  $allUsers = '0'
  if ($Scope -eq 'AllUsers') { $allUsers = '1' }
  $options = @(
    $mode,
    ('InstallAllUsers=' + $allUsers),
    'PrependPath=1',
    'Include_launcher=1',
    'InstallLauncherAllUsers=0',
    'Include_pip=1',
    'Include_doc=1',
    'Include_dev=1',
    'Include_exe=1',
    'Include_lib=1',
    'Include_test=1',
    'Include_tcltk=1',
    'Include_tools=1',
    'AssociateFiles=1',
    'Shortcuts=1',
    'CompileAll=1'
  )
  if ($IncludeDebug) { $options += @('Include_debug=1', 'Include_symbols=1') }
  return $options
}

function Add-UserPath {
  param([string]$Dir)
  # idempotent helper: repeated runs must not duplicate PATH entries
  if (-not $Dir) { return }
  if ($DryRun) { Write-Host ('  [dry-run] would add to user PATH: ' + $Dir); return }
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $current) { $current = '' }
  $parts = @($current -split ';' | Where-Object { $_ -ne '' })
  if ($parts -contains $Dir) { Write-Host ('  user PATH already contains: ' + $Dir); return }
  [Environment]::SetEnvironmentVariable('Path', (($parts + $Dir) -join ';'), 'User')
  Write-Host ('  added to user PATH: ' + $Dir)
}

function Update-SessionPath {
  # the installer writes to the registry, not into this process, so rebuild
  # $env:Path from Machine + User before the verification step
  if ($DryRun) { return }
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = ((@($machinePath, $userPath) | Where-Object { $_ }) -join ';')
}

function Get-RegisteredInstallDir {
  # reads the folders the official installer registered, newest first
  $found = @()
  foreach ($root in @('HKCU:\Software\Python\PythonCore', 'HKLM:\Software\Python\PythonCore')) {
    if (-not (Test-Path $root)) { continue }
    foreach ($key in (Get-ChildItem $root -ErrorAction SilentlyContinue)) {
      foreach ($sub in @('InstallPath', 'InstallPath\InstallPath')) {
        $probe = Join-Path $key.PSPath $sub
        if (-not (Test-Path $probe)) { continue }
        $prop = Get-ItemProperty -Path $probe -ErrorAction SilentlyContinue
        if (-not $prop) { continue }
        $exe = ''
        if ($prop.PSObject.Properties.Name -contains 'ExecutablePath') { $exe = [string]$prop.ExecutablePath }
        if ($exe) { $found += (Split-Path -Parent $exe) }
        $plain = [string]$prop.'(default)'
        if ($plain -and (Test-Path -LiteralPath (Join-Path $plain 'python.exe'))) { $found += $plain }
      }
    }
  }
  foreach ($dir in ($found | Select-Object -Unique)) {
    if (Test-Path -LiteralPath (Join-Path $dir 'python.exe')) { return $dir }
  }
  return ''
}

function Install-WithWinget {
  param([string]$Version)
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { Write-Host '  winget is not available on this machine'; return $false }
  $ids = @()
  if ($Version) {
    # 3.13.7 -> Python.Python.3.13
    $ids += ('Python.Python.' + ($Version -replace '^(\d+\.\d+).*$', '$1'))
  } else {
    $ids += $WINGET_IDS
  }
  foreach ($id in $ids) {
    $wargs = @('install', '-e', '--id', $id, '--silent',
               '--accept-package-agreements', '--accept-source-agreements')
    if ($Version) { $wargs += @('--version', $Version) }
    if ($DryRun) { Write-Host ('  [dry-run] winget ' + ($wargs -join ' ')); return $true }
    Write-Host ('  running: winget ' + ($wargs -join ' '))
    & $winget.Source @wargs
    if ($LASTEXITCODE -eq 0) { return $true }
    Write-Host ('  winget exited with code ' + $LASTEXITCODE)
  }
  return $false
}

function Install-WithInstaller {
  param([string]$Version, [string]$Arch, [string]$Prefer)
  $file = Get-InstallerFileName -Version $Version -Arch $Arch
  $urls = Get-InstallerUrls -Version $Version -Arch $Arch -Prefer $Prefer
  $options = Get-InstallerOptions
  if ($DryRun) {
    Write-Host ('  [dry-run] would download: ' + $urls[0])
    Write-Host ('  [dry-run] would run: ' + $file + ' ' + ($options -join ' '))
    return $true
  }
  $target = Join-Path $env:TEMP $file
  $downloaded = $false
  foreach ($url in $urls) {
    try {
      Write-Host ('  downloading ' + $url + ' ...')
      Invoke-WebRequest -Uri $url -OutFile $target -Headers $UA -TimeoutSec 600 @script:WebArgs
      $downloaded = $true
      break
    } catch {
      Write-Host ('  download failed: ' + $_.Exception.Message)
    }
  }
  if (-not $downloaded) { return $false }
  $sizeMb = [math]::Round(((Get-Item -LiteralPath $target).Length / 1MB), 1)
  Write-Host ('  downloaded ' + $sizeMb + ' MB')
  Write-Host ('  running: ' + $file + ' ' + ($options -join ' '))
  $proc = Start-Process -FilePath $target -ArgumentList $options -Wait -PassThru
  Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
  if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) { return $true }
  if ($proc.ExitCode -eq 1602) { Write-Host '  the installation was cancelled by the user' }
  else { Write-Host ('  the installer exited with code ' + $proc.ExitCode) }
  return $false
}

function Invoke-SmokeTest {
  # proves the interpreter works for THIS project: version, stdlib, script syntax
  param([string]$Exe)
  if (-not $Exe) { return $false }
  $info = Get-PythonInfo -Exe $Exe
  if (-not $info.Usable) { Write-Host '  --version failed'; return $false }
  Write-Host ('  interpreter : ' + $info.Exe)
  Write-Host ('  version     : ' + $info.Version)
  $imports = 'import http.server,json,subprocess,zipfile,argparse,base64,shutil,re,io,time'
  $null = & $Exe -c $imports
  if ($LASTEXITCODE -ne 0) { Write-Host '  stdlib import check failed'; return $false }
  Write-Host '  stdlib imports: OK'
  # compile() only, so no __pycache__ folder is left inside the project
  $check = "import sys;compile(open(sys.argv[1],encoding='utf-8').read(),sys.argv[1],'exec')"
  foreach ($name in $SMOKE_FILES) {
    $path = Join-Path $SCRIPT_DIR $name
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $null = & $Exe -c $check $path
    if ($LASTEXITCODE -ne 0) { Write-Host ('  syntax check failed: ' + $name); return $false }
    Write-Host ('  syntax check: ' + $name + ' OK')
  }
  return $true
}

# =============================================================== main
Write-Host '============================================'
Write-Host ' Markdown to Word - Python setup'
Write-Host '============================================'
Write-Host ('  min version : ' + $MinVersion)
Write-Host ('  method      : ' + $Method)
Write-Host ('  scope       : ' + $Scope)
$modeText = '/passive (progress window)'
if ($Quiet) { $modeText = '/quiet (no window)' }
Write-Host ('  installer   : ' + $modeText)
if ($IncludeDebug) { Write-Host '  components  : every box, including debug binaries' }
else { Write-Host '  components  : every box except debug binaries (-IncludeDebug adds them)' }
if ($DryRun) { Write-Host '  DRY-RUN: nothing will be downloaded, installed or changed' }

Write-Step 1 5 'looking for an existing Python 3'
$found = Find-UsablePython -Need $MinVersion
if ($found) {
  Write-Host ('  found   : ' + $found.Exe)
  Write-Host ('  version : ' + $found.Version)
} else {
  Write-Host '  no usable Python 3 found (py launcher, PATH and the usual folders were checked)'
}

Write-Step 2 5 'checking this machine and the target release'
$arch = Get-InstallerArch
Write-Host ('  machine architecture: ' + $arch)
$prefer = 'official'
if ($Method -eq 'mirror') { $prefer = 'mirror' }
$targetVersion = $RequiredVersion
if (-not $targetVersion -and -not $found -and $Method -ne 'winget') {
  $targetVersion = Resolve-NewestStableVersion -Prefer $prefer
  if (-not $targetVersion) { Write-Host '  no release list could be read - winget or a manual install is required' }
}
if ($targetVersion) { Write-Host ('  target version: ' + $targetVersion) }

Write-Step 3 5 'evaluating the installation'
$reason = ''
if (-not $found) { $reason = 'no usable Python 3 was found' }
elseif ($RequiredVersion -and -not (Test-VersionEQ $found.Version $RequiredVersion)) {
  $reason = 'version ' + $found.Version + ' does not match the required ' + $RequiredVersion
}

$needsInstall = $false
if ($reason) {
  Write-Host ('  result: needs setup - ' + $reason)
  $needsInstall = $true
} elseif ($Force) {
  Write-Host '  result: usable, but -Force was given -> installing the newest release anyway'
  $needsInstall = $true
} else {
  Write-Host '  result: OK, nothing to do'
}

Write-Step 4 5 'installing Python (only when needed)'
if (-not $needsInstall) {
  Write-Host '  skipped: the existing Python already satisfies this project'
} else {
  $installed = $false
  if ($Method -eq 'auto' -or $Method -eq 'winget') {
    $installed = Install-WithWinget -Version $RequiredVersion
    if (-not $installed -and $Method -eq 'winget') {
      Write-Host '  winget was requested explicitly: the installer fallback is skipped'
    }
  }
  if (-not $installed -and $Method -ne 'winget') {
    if (-not $targetVersion) { $targetVersion = Resolve-NewestStableVersion -Prefer $prefer }
    if (-not $targetVersion) {
      Write-Host '  [ERROR] the release to install could not be determined'
    } else {
      Write-Host ('  using the official installer: ' + $targetVersion + ' / ' + $arch)
      $installed = Install-WithInstaller -Version $targetVersion -Arch $arch -Prefer $prefer
    }
  }
  if (-not $installed) {
    Write-Rule
    Write-Host ' [ERROR] the automatic installation failed.'
    Write-Host ' Install Python manually and run this script again:'
    Write-Host ('   winget install -e --id ' + $WINGET_IDS[1])
    Write-Host '   https://www.python.org/downloads/windows/'
    exit 1
  }
}

Write-Step 5 5 'configuring the environment and re-checking'
Update-SessionPath
$final = Find-UsablePython -Need $MinVersion
$finalOk = $false
if ($final) {
  $dir = Split-Path -Parent $final.Exe
  $registryDir = Get-RegisteredInstallDir
  if ($registryDir) { $dir = $registryDir }
  Write-Host ('  install dir: ' + $dir)
  if ($needsInstall) {
    # 1) user PATH for new shells, 2) the Scripts folder for pip entry points
    Add-UserPath -Dir $dir
    $scriptsDir = Join-Path $dir 'Scripts'
    if (Test-Path -LiteralPath $scriptsDir) { Add-UserPath -Dir $scriptsDir }
    Update-SessionPath
  }
  $finalOk = Invoke-SmokeTest -Exe $final.Exe
}

Write-Rule
if ($finalOk) {
  Write-Host ' [OK] Python is ready. You can start start-server.bat now.'
  if ($DryRun) { Write-Host '      (dry-run: nothing was installed and nothing was changed)' }
  exit 0
}
if ($DryRun) {
  Write-Host ' [DRY-RUN] no change was made. Run the script again without -DryRun to install.'
  exit 0
}
Write-Host ' [ERROR] Python is still not usable - see the messages above.'
exit 1
