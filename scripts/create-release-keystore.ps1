<#
.SYNOPSIS
Creates the long-lived upload keystore used to sign released APKs.

.DESCRIPTION
Every APK published so far was signed with the local Android debug certificate. That certificate
is regenerated per machine, and a changed signature forces users to uninstall before they can
update — which deletes the sandboxed automatic backups along with the app. A keystore created
once and kept safe removes that failure mode.

Back up the generated .jks file and its passwords somewhere durable. Losing them means no future
build can ever update an already-installed app; the only recovery is a new package name.

.EXAMPLE
pwsh -File scripts/create-release-keystore.ps1 -OutFile "$HOME\keys\spend-app-release.jks"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OutFile,

    [string]$Alias = 'spend-app',

    [int]$ValidityDays = 10950,

    [string]$Dname = 'CN=Realtime Expense Tracker, OU=Mobile, O=Realtime Expense Tracker, C=CN'
)

$ErrorActionPreference = 'Stop'

if (Test-Path -LiteralPath $OutFile) {
    throw "$OutFile already exists. Refusing to overwrite a keystore — pick another path or move the old one aside."
}

if (-not $env:JAVA_HOME) {
    throw 'JAVA_HOME is not set. Point it at the JDK used for the Android build.'
}

$keytool = Join-Path $env:JAVA_HOME 'bin/keytool.exe'
if (-not (Test-Path -LiteralPath $keytool)) {
    throw "keytool not found at $keytool"
}

$parent = Split-Path -Parent $OutFile
if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
}

$storePassword = Read-Host -AsSecureString 'Keystore password (min 6 chars)'
$confirmPassword = Read-Host -AsSecureString 'Confirm keystore password'
$plainStore = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePassword))
$plainConfirm = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmPassword))

if ($plainStore -ne $plainConfirm) { throw 'Passwords do not match.' }
if ($plainStore.Length -lt 6) { throw 'Keystore password must be at least 6 characters.' }

# One password for both store and key keeps the four CI secrets in step; keytool accepts it.
& $keytool -genkeypair -v `
    -keystore $OutFile `
    -storetype JKS `
    -storepass $plainStore `
    -keypass $plainStore `
    -alias $Alias `
    -keyalg RSA -keysize 4096 -validity $ValidityDays `
    -dname $Dname

if ($LASTEXITCODE -ne 0) { throw "keytool failed with exit code $LASTEXITCODE" }

$fingerprint = (& $keytool -list -v -keystore $OutFile -storepass $plainStore -alias $Alias |
    Select-String -Pattern 'SHA256:').Line.Trim()

Write-Host ''
Write-Host "Keystore written to $OutFile"
Write-Host $fingerprint
Write-Host ''
Write-Host 'Add these four GitHub repository secrets (Settings -> Secrets and variables -> Actions):'
Write-Host '  SPEND_RELEASE_KEYSTORE_BASE64  <- base64 of the .jks file, see below'
Write-Host "  SPEND_RELEASE_STORE_PASSWORD   <- the password you just entered"
Write-Host "  SPEND_RELEASE_KEY_ALIAS        <- $Alias"
Write-Host "  SPEND_RELEASE_KEY_PASSWORD     <- the password you just entered"
Write-Host ''
Write-Host 'Produce the base64 value with:'
Write-Host "  [Convert]::ToBase64String([IO.File]::ReadAllBytes('$OutFile')) | Set-Clipboard"
Write-Host ''
Write-Host 'Then store the .jks and password in a password manager. Losing them means no future'
Write-Host 'build can update an installed app.'
