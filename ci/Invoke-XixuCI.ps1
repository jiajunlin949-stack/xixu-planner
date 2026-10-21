[CmdletBinding()]
param(
  [switch]$SkipBrowserTests,
  [switch]$SkipNativeBuild,
  [switch]$SignRelease
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$reportDir = Join-Path $root 'outputs/ci'
$logDir = Join-Path $reportDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$started = Get-Date
$results = [Collections.Generic.List[object]]::new()

function Invoke-CiStep([string]$Name, [scriptblock]$Action) {
  $stepStarted = Get-Date
  Write-Host "`n==> $Name" -ForegroundColor Cyan
  try {
    & $Action
    $code = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    if ($code -ne 0) { throw "Step exited with code $code" }
    $results.Add([pscustomobject]@{ name=$Name; status='passed'; seconds=[math]::Round(((Get-Date)-$stepStarted).TotalSeconds,2); error=$null })
  } catch {
    $results.Add([pscustomobject]@{ name=$Name; status='failed'; seconds=[math]::Round(((Get-Date)-$stepStarted).TotalSeconds,2); error=$_.Exception.Message })
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  }
}

Push-Location $root
try {
  Invoke-CiStep 'Generate native offline resources' { node work/prepare-native.cjs }
  Invoke-CiStep 'Generate deterministic CI fixtures' { node work/create-ci-fixtures.cjs }

  if (-not $SkipBrowserTests) {
    $checks = Get-ChildItem -LiteralPath (Join-Path $root 'work') -Filter 'check-*.cjs' -File | Sort-Object Name
    foreach ($check in $checks) {
      $checkName = $check.BaseName
      $logFile = Join-Path $logDir "$checkName.log"
      Invoke-CiStep "Regression: $checkName" {
        # Windows PowerShell treats native stderr as an ErrorRecord. Capture it
        # before restoring Stop so a failing test also replaces any stale log.
        $checkErrorPreference = $ErrorActionPreference
        try {
          $ErrorActionPreference = 'Continue'
          $checkOutput = node $check.FullName 2>&1
          $checkExitCode = $LASTEXITCODE
        } finally {
          $ErrorActionPreference = $checkErrorPreference
        }
        $checkOutput | Tee-Object -FilePath $logFile
        if ($checkExitCode -ne 0) { throw "$checkName failed; see $logFile" }
      }
    }
  }

  if (-not $SkipNativeBuild) {
    Invoke-CiStep 'HarmonyOS release build' { node xixu-harmony/build-release.cjs }
    $unsigned = Get-ChildItem -LiteralPath (Join-Path $root 'xixu-harmony/build/outputs') -Recurse -File -Filter '*-unsigned.app' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $unsigned) {
      $results.Add([pscustomobject]@{ name='Validate unsigned APP'; status='failed'; seconds=0; error='No unsigned APP was produced' })
    } else {
      Invoke-CiStep 'Validate unsigned APP' { & (Join-Path $PSScriptRoot 'Test-XixuApp.ps1') -AppPath $unsigned.FullName | Tee-Object -FilePath (Join-Path $reportDir 'unsigned-app.json') }
      if ($SignRelease) {
        $appConfig = Get-Content -LiteralPath (Join-Path $root 'xixu-harmony/AppScope/app.json5') -Raw
        $version = [regex]::Match($appConfig, '"versionName"\s*:\s*"([^"]+)"').Groups[1].Value
        $signedApp = Join-Path $reportDir "xixu-$version-release.app"
        Invoke-CiStep 'Sign and verify release APP' { & (Join-Path $PSScriptRoot 'Sign-XixuRelease.ps1') -UnsignedApp $unsigned.FullName -OutputApp $signedApp | Tee-Object -FilePath (Join-Path $reportDir 'signed-app.json') }
      }
    }
  }
} finally {
  Pop-Location
}

$failed = @($results | Where-Object status -eq 'failed')
$report = [pscustomobject]@{
  project = 'xixu'
  startedAt = $started.ToString('o')
  finishedAt = (Get-Date).ToString('o')
  durationSeconds = [math]::Round(((Get-Date)-$started).TotalSeconds,2)
  passed = @($results | Where-Object status -eq 'passed').Count
  failed = $failed.Count
  results = $results
}
$reportJson = $report | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $reportDir 'summary.json'), $reportJson, [Text.UTF8Encoding]::new($false))
$report | ConvertTo-Json -Depth 6
if ($failed.Count) { exit 1 }
