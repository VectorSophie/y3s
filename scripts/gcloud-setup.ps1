# Automates the gcloud-scriptable parts of y3s setup on Windows: project +
# enabling the YouTube Data API v3. The OAuth client ID (application type
# "Chrome Extension") CANNOT be created from gcloud or any API — that step is
# Google Cloud Console only, and is printed at the end.
#
# Usage:
#   .\scripts\gcloud-setup.ps1 [-ProjectId my-proj]
param(
  [string]$ProjectId = $(if ($env:Y3S_PROJECT_ID) { $env:Y3S_PROJECT_ID } else { "y3s-ext" })
)
$ErrorActionPreference = "Stop"

# Resolve gcloud (the Windows installer doesn't always add it to PATH).
$gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source
if (-not $gcloud) {
  $candidate = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
  if (Test-Path $candidate) { $gcloud = $candidate }
}
if (-not $gcloud) {
  Write-Host "gcloud not found. Install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
  exit 1
}

# Ensure there's an active account.
$active = & $gcloud auth list --filter=status:ACTIVE --format="value(account)"
if (-not $active) {
  Write-Host "No active gcloud account - launching login..."
  & $gcloud auth login
}

# Create the project if it doesn't exist.
& $gcloud projects describe $ProjectId *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating project '$ProjectId'..."
  & $gcloud projects create $ProjectId --name="y3s"
} else {
  Write-Host "Project '$ProjectId' already exists."
}

& $gcloud config set project $ProjectId
Write-Host "Enabling YouTube Data API v3..."
& $gcloud services enable youtube.googleapis.com

Write-Host @"

------------------------------------------------------------------------------
 gcloud part done. Project: $ProjectId  -  YouTube Data API v3: enabled
------------------------------------------------------------------------------

 The OAuth client ID is console-only (gcloud cannot create the "Chrome
 Extension" client type). Finish these two steps by hand:

 1) OAuth consent screen
    https://console.cloud.google.com/auth/overview?project=$ProjectId
    - User type: External. Add yourself under "Test users".

 2) Create the OAuth client
    https://console.cloud.google.com/auth/clients?project=$ProjectId
    - Create client -> Application type: "Chrome Extension"
    - Application ID: your unpacked extension's ID from chrome://extensions
    - Copy the generated client_id into manifest.json -> oauth2.client_id,
      then run: npm run build  and reload the extension.
------------------------------------------------------------------------------
"@
