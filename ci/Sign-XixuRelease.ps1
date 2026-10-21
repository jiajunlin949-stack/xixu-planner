[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string]$UnsignedApp,
  [Parameter(Mandatory = $true)] [string]$OutputApp,
  [string]$SignTool = $env:XIXU_SIGN_TOOL,
  [string]$KeyAlias = $env:XIXU_SIGN_KEY_ALIAS,
  [string]$KeyStore = $env:XIXU_SIGN_KEYSTORE,
  [string]$Certificate = $env:XIXU_SIGN_CERTIFICATE,
  [string]$Profile = $env:XIXU_SIGN_PROFILE
)

$ErrorActionPreference = 'Stop'
function Read-Secret([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ($value) { return $value }
  $file = [Environment]::GetEnvironmentVariable("${Name}_FILE")
  if ($file -and (Test-Path -LiteralPath $file)) { return (Get-Content -LiteralPath $file -Raw).Trim() }
  return $null
}

if (-not $SignTool) {
  $toolCandidates = @(
  )
  $SignTool = $toolCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
$keyPassword = Read-Secret 'XIXU_SIGN_KEY_PASSWORD'
$storePassword = Read-Secret 'XIXU_SIGN_STORE_PASSWORD'
$required = @{
  XIXU_SIGN_TOOL = $SignTool
  XIXU_SIGN_KEY_ALIAS = $KeyAlias
  XIXU_SIGN_KEYSTORE = $KeyStore
  XIXU_SIGN_CERTIFICATE = $Certificate
  XIXU_SIGN_PROFILE = $Profile
  XIXU_SIGN_KEY_PASSWORD = $keyPassword
  XIXU_SIGN_STORE_PASSWORD = $storePassword
}
$missing = @($required.Keys | Where-Object { -not $required[$_] })
if ($missing.Count) { throw "Missing release signing settings: $($missing -join ', ')" }
foreach ($file in @($SignTool, $KeyStore, $Certificate, $Profile, $UnsignedApp)) {
  if (-not (Test-Path -LiteralPath $file)) { throw "Required signing file does not exist: $file" }
}

$outputDirectory = Split-Path -Parent $OutputApp
if ($outputDirectory) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }
$previousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& java -jar $SignTool sign-app -mode localSign -keyAlias $KeyAlias -keyPwd $keyPassword -appCertFile $Certificate -profileFile $Profile -profileSigned 1 -inFile $UnsignedApp -inForm zip -signAlg SHA256withECDSA -keystoreFile $KeyStore -keystorePwd $storePassword -outFile $OutputApp -compatibleVersion 12 -signCode 0
$signExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorPreference
if ($signExitCode -ne 0) { throw "HarmonyOS APP signing failed with exit code $signExitCode" }

& (Join-Path $PSScriptRoot 'Test-XixuApp.ps1') -AppPath $OutputApp -RequireReleaseSignature -SignTool $SignTool
