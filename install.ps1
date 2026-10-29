# Installs Ground Control on Windows in one line (packet I step 6, plan section 4.3), in PowerShell
# (Windows PowerShell 5.1 needs TLS 1.2 switched on first, hence the first half):
#
#   [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object Net.WebClient).DownloadString('https://github.com/vigneshrs-moxie/feature-workshop/releases/latest/download/install.ps1'))
#
# 1. Node 22 or later: when it is missing it prints the winget line that gets it and asks first.
# 2. Downloads the newest release's package file and SHA256SUMS and checks the one against the other.
#    Nothing is installed or run from a download that doesn't match.
# 3. Runs that package's `ground-control doctor --json`, and for each thing missing prints the fix
#    and asks (yes or no) before running it.
# 4. npm i -g <the package file>, then `ground-control install` (a Task Scheduler task from sign-in,
#    as you, never as administrator), then opens http://127.0.0.1:4477/next/. Without the rights
#    for the task, it says so: `ground-control start --here` then runs it fully in a window.
#
# Runs in Windows PowerShell 5.1 and PowerShell 7. It never exits the window it runs in.
#
# Settings, for trying the script:
#   GROUND_CONTROL_RELEASE_REPO   the GitHub repository the release comes from
#   GROUND_CONTROL_FROM           a folder that already holds a package file and its SHA256SUMS
#                                 (used instead of downloading; still checked)
#   GROUND_CONTROL_NO_SERVICE=1   install the program only: no service, nothing opened

$Product = 'Ground Control'
$Package = '@moxie/ground-control'
$Command = 'ground-control'
$DashboardUrl = 'http://127.0.0.1:4477/next/'
$NodeMajor = 22

function Install-GroundControl {
  $ErrorActionPreference = 'Continue'
  $repo = $env:GROUND_CONTROL_RELEASE_REPO
  if (-not $repo) { $repo = 'vigneshrs-moxie/feature-workshop' }
  $from = $env:GROUND_CONTROL_FROM
  $noService = [bool]$env:GROUND_CONTROL_NO_SERVICE

  function Say([string]$text) { Write-Host $text }
  function Stop-Install([string]$text) { throw [System.OperationCanceledException]::new($text) }
  function Test-Command([string]$name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
  function Update-PathFromSystem {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
  }
  function Ask([string]$question) {
    try { $answer = Read-Host "$question [y/N]" } catch { Say "$question [y/N] no (there is no window to answer in)"; return $false }
    return ($answer -match '^(y|yes)$')
  }
  # Runs a program in this window (its output shown, its questions answered here) and returns its
  # exit code. Start-Process keeps the program's output out of this function's return value.
  function Invoke-Visible([string]$file, [string]$arguments) {
    $p = Start-Process -FilePath $file -ArgumentList $arguments -NoNewWindow -Wait -PassThru
    return $p.ExitCode
  }
  function Invoke-Fix([string]$line) {
    $code = Invoke-Visible 'cmd.exe' "/d /s /c `"$line`""
    Update-PathFromSystem
    return ($code -eq 0)
  }
  function Get-NodeMajor {
    if (-not (Test-Command 'node')) { return 0 }
    $v = & node -p "process.versions.node.split('.')[0]" 2>$null
    $n = 0
    if ([int]::TryParse("$v".Trim(), [ref]$n)) { return $n }
    return 0
  }

  Say "Installing $Product on Windows."
  Say ''

  # ---------- 1. Node 22 or later ----------

  if ((Get-NodeMajor) -lt $NodeMajor) {
    if (Test-Command 'node') { Say "$Product needs Node $NodeMajor or later; this computer has Node $(& node -v)." }
    else { Say "$Product needs Node $NodeMajor or later, and this computer has no Node." }
    $line = 'winget install -e --id OpenJS.NodeJS.LTS'
    if (-not (Test-Command 'winget')) {
      Stop-Install "Get Node $NodeMajor or later from https://nodejs.org/en/download (winget isn't on this computer), then run this again. Nothing else was changed."
    }
    if (Ask "Run this to get it?  $line") { [void](Invoke-Fix $line) }
    if ((Get-NodeMajor) -lt $NodeMajor) {
      Stop-Install "Node $NodeMajor or later still isn't here. Run $line (or get it from https://nodejs.org/en/download), open a new PowerShell window and run this again. Nothing else was changed."
    }
  }
  Say "Node $(& node -v): OK"

  # ---------- 2. The package file, checked against SHA256SUMS ----------

  $work = Join-Path ([System.IO.Path]::GetTempPath()) ("ground-control-install-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    $sums = Join-Path $work 'SHA256SUMS'
    $base = "https://github.com/$repo/releases/latest/download"
    $useGh = $false
    if (-not $from -and (Test-Command 'gh')) {
      & gh auth status *> $null
      $useGh = ($LASTEXITCODE -eq 0)
    }
    if ($from) {
      Say "Using the release files in $from."
      if (-not (Test-Path -LiteralPath (Join-Path $from 'SHA256SUMS'))) { Stop-Install "$from has no SHA256SUMS. Nothing was changed." }
      Copy-Item -LiteralPath (Join-Path $from 'SHA256SUMS') -Destination $work
      Get-ChildItem -LiteralPath $from -Filter 'moxie-ground-control-*.tgz' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $work }
    } elseif ($useGh) {
      Say "Downloading the newest release of $Product from $repo (with GitHub CLI)."
      $code = Invoke-Visible 'gh' "release download --repo $repo --pattern moxie-ground-control-*.tgz --pattern SHA256SUMS --dir `"$work`""
      if ($code -ne 0) { Stop-Install "The download from $repo didn't finish. Check the network and run this again. Nothing was changed." }
    } else {
      Say "Downloading the newest release of $Product from $repo."
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      try { Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sums -ErrorAction Stop }
      catch { Stop-Install "SHA256SUMS couldn't be downloaded from $base. Check the network and run this again. Nothing was changed." }
    }

    # The package file's name and its sum, from SHA256SUMS ("<sha256>  <name>" lines).
    $name = $null
    $want = $null
    foreach ($l in (Get-Content -LiteralPath $sums)) {
      if ($l -match '^([0-9a-fA-F]{64})\s+\*?(moxie-ground-control-[^\s/\\]+\.tgz)\s*$') { $want = $Matches[1].ToLower(); $name = $Matches[2]; break }
    }
    if (-not $name) { Stop-Install "SHA256SUMS doesn't name a package file, so nothing can be checked. Nothing was changed." }
    $tgz = Join-Path $work $name
    if (-not (Test-Path -LiteralPath $tgz) -and -not $from -and -not $useGh) {
      try { Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $tgz -ErrorAction Stop }
      catch { Stop-Install "$name couldn't be downloaded. Check the network and run this again. Nothing was changed." }
    }
    if (-not (Test-Path -LiteralPath $tgz)) { Stop-Install "$name isn't there to check. Nothing was changed." }
    $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $tgz).Hash.ToLower()
    if ($got -ne $want) { Stop-Install "The download didn't match its checksum. Nothing was changed." }
    Say "${name}: checksum OK"
    Say ''

    # ---------- 3. What else is missing (doctor --json), each fix only after a yes ----------

    Say "Checking what else $Product needs (ground-control doctor)."
    $report = $null
    if (Test-Command 'tar.exe') {
      $unpacked = Join-Path $work 'package-files'
      New-Item -ItemType Directory -Path $unpacked | Out-Null
      & tar.exe -xzf $tgz -C $unpacked *> $null
      $cli = Join-Path $unpacked 'package\bin\ground-control.js'
      if (Test-Path -LiteralPath $cli) {
        # Node writes UTF-8; read it as UTF-8 so its curly quotes come through as they are.
        $before = [Console]::OutputEncoding
        try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
        $json = (& node $cli doctor --json 2>$null) -join "`n"
        try { [Console]::OutputEncoding = $before } catch { }
        try { $report = $json | ConvertFrom-Json } catch { $report = $null }
      }
    }
    if (-not $report) {
      Say "Doctor couldn't run before the install; run $Command doctor afterwards to see what is missing."
    } else {
      $missing = @($report.checks | Where-Object { -not $_.ok -and $_.fix -and $_.id -ne 'service' -and $_.id -ne 'admin' })
      if ($missing.Count -eq 0) { Say 'Everything it needs is here.' }
      foreach ($c in $missing) {
        Say ''
        Say "$($c.name): $($c.found)"
        if ($c.runnable) {
          if (Ask "Run this to fix it?  $($c.fix)") {
            if (-not (Invoke-Fix $c.fix)) { Say "That didn't finish; you can run it again later: $($c.fix)" }
          }
        } else {
          Say "  To do by hand: $($c.fix)"
        }
      }
    }
    Say ''

    # ---------- 4. Install, set up the service, open it ----------

    Say "Installing $Product ($Package) with npm."
    if ((Invoke-Visible 'npm.cmd' "i -g `"$tgz`"") -ne 0) { Stop-Install "npm couldn't install $Product (its message is above). Nothing else was changed." }
    Update-PathFromSystem
    $prefix = ((& npm.cmd prefix -g) -join '').Trim()
    $bin = Join-Path $prefix "$Command.cmd"
    if (-not (Test-Path -LiteralPath $bin)) { $bin = "$Command.cmd" }

    if ($noService) {
      Say ''
      Say "$Product is installed (no service, as asked). Start it with: $Command start --here"
      return 0
    }

    Say ''
    if ((Invoke-Visible $bin 'install') -eq 0) {
      Say ''
      Say "Opening $DashboardUrl"
      Start-Process $DashboardUrl
      Say "Done. Next: $Command token set saves your Orbit token, and $Command doctor checks everything again."
      return 0
    }
    Say ''
    Say "$Product is installed, but it isn't running as a service (the reason is above)."
    Say "It works fully when you start it yourself: $Command start --here (keep that window open), then open $DashboardUrl"
    return 1
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$installCode = 1
try {
  $installCode = Install-GroundControl
} catch [System.OperationCanceledException] {
  Write-Host $_.Exception.Message
  $installCode = 1
}
# Run as a file (powershell -File install.ps1): its exit code. Through iex: the window stays.
if ($PSCommandPath) { exit $installCode }
