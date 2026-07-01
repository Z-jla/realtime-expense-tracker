$ErrorActionPreference = 'Stop'

$condaJavaHome = Join-Path $env:CONDA_PREFIX 'Library\lib\jvm'
if (-not $env:JAVA_HOME -and $env:CONDA_PREFIX -and (Test-Path $condaJavaHome)) {
  $env:JAVA_HOME = $condaJavaHome
}

if (-not $env:ANDROID_HOME -and $env:ANDROID_SDK_ROOT) {
  $env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
}

if (-not $env:JAVA_HOME) {
  throw 'JAVA_HOME is not set. Install JDK 21 or run this script inside the spend-app conda environment.'
}

if (-not $env:ANDROID_HOME) {
  throw 'ANDROID_HOME is not set. Install Android SDK and set ANDROID_HOME or ANDROID_SDK_ROOT.'
}

$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

Set-Location (Join-Path $PSScriptRoot '..\android')
.\gradlew.bat assembleDebug --no-daemon --stacktrace --info --console=plain
