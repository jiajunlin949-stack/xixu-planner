[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$AppPath,
  [switch]$RequireReleaseSignature,
  [string]$SignTool = $env:XIXU_SIGN_TOOL
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$resolvedApp = (Resolve-Path -LiteralPath $AppPath).Path
$appConfigPath = Join-Path $root 'xixu-harmony/AppScope/app.json5'
$appConfigText = Get-Content -LiteralPath $appConfigPath -Raw

function Read-Match([string]$Pattern, [string]$Label) {
  $match = [regex]::Match($appConfigText, $Pattern)
  if (-not $match.Success) { throw "Cannot read $Label from AppScope/app.json5" }
  return $match.Groups[1].Value
}

$expectedBundle = Read-Match '"bundleName"\s*:\s*"([^"]+)"' 'bundleName'
$expectedCode = [int](Read-Match '"versionCode"\s*:\s*(\d+)' 'versionCode')
$expectedName = Read-Match '"versionName"\s*:\s*"([^"]+)"' 'versionName'

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($resolvedApp)
try {
  $packEntry = $archive.Entries | Where-Object FullName -eq 'pack.info' | Select-Object -First 1
  if (-not $packEntry) { throw 'APP package does not contain pack.info' }
  $reader = [IO.StreamReader]::new($packEntry.Open())
  try { $pack = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }

  $hapEntry = $archive.Entries | Where-Object FullName -eq 'entry-default.hap' | Select-Object -First 1
  if (-not $hapEntry) { throw 'APP package does not contain entry-default.hap' }
} finally {
  $archive.Dispose()
}

$app = $pack.summary.app
$module = $pack.summary.modules | Select-Object -First 1
if ($app.bundleName -ne $expectedBundle) { throw "Bundle mismatch: $($app.bundleName)" }
if ([int]$app.version.code -ne $expectedCode) { throw "Version code mismatch: $($app.version.code)" }
if ([string]$app.version.name -ne $expectedName) { throw "Version name mismatch: $($app.version.name)" }
if ($app.bundleType -ne 'app') { throw "Unexpected bundle type: $($app.bundleType)" }
if ([int]$module.apiVersion.compatible -ne 12) { throw "Compatible API must be 12, got $($module.apiVersion.compatible)" }
if ([int]$module.apiVersion.target -ne 26) { throw "Target API must be 26, got $($module.apiVersion.target)" }
foreach ($device in @('phone', 'tablet')) {
  if ($module.deviceType -notcontains $device) { throw "Missing device type: $device" }
}

$signatureVerified = $false
$releaseCertificateVerified = $false
if ($RequireReleaseSignature) {
  if (-not $SignTool) {
    $toolCandidates = @(
    )
    $SignTool = $toolCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  }
  if (-not $SignTool -or -not (Test-Path -LiteralPath $SignTool)) {
    throw 'Release signature verification requested, but hap-sign-tool.jar was not found. Set XIXU_SIGN_TOOL.'
  }

  $verifyDir = Join-Path $env:TEMP ("xixu-verify-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $verifyDir | Out-Null
  try {
    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $verifyOutput = & java -jar $SignTool verify-app -inFile $resolvedApp -outCertChain (Join-Path $verifyDir 'certificate.cer') -outProfile (Join-Path $verifyDir 'profile.p7b') -inForm zip 2>&1 | Out-String
    $verifyExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorPreference
    if ($verifyExitCode -ne 0 -or $verifyOutput -notmatch 'Digest verify result:\s*true') {
      throw "Release signature verification failed.`n$verifyOutput"
    }
    if ($verifyOutput -match 'Subject:.*Development' -or $verifyOutput -notmatch 'Subject:.*Release') {
      throw "APP is signed with a non-release certificate. AppGallery packages must use the Release certificate.`n$verifyOutput"
    }
    $signatureVerified = $true
    $releaseCertificateVerified = $true
  } finally {
    Remove-Item -LiteralPath $verifyDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$stream = [IO.File]::OpenRead($resolvedApp)
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $hash = ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
} finally {
  $sha256.Dispose()
  $stream.Dispose()
}
[pscustomobject]@{
  app = $resolvedApp
  bundleName = $app.bundleName
  versionCode = [int]$app.version.code
  versionName = [string]$app.version.name
  compatibleApi = [int]$module.apiVersion.compatible
  targetApi = [int]$module.apiVersion.target
  deviceTypes = @($module.deviceType)
  releaseSignatureVerified = $signatureVerified
  releaseCertificateVerified = $releaseCertificateVerified
  sha256 = $hash
} | ConvertTo-Json -Depth 5
