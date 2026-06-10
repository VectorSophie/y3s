#!/usr/bin/env bash
# Automates the gcloud-scriptable parts of y3s setup: project + enabling the
# YouTube Data API v3. The OAuth client ID (application type "Chrome Extension")
# CANNOT be created from gcloud or any API — that step is Google Cloud Console
# only, and is printed at the end.
#
# Usage:
#   ./scripts/gcloud-setup.sh [PROJECT_ID]
#   Y3S_PROJECT_ID=my-proj ./scripts/gcloud-setup.sh
set -euo pipefail

PROJECT_ID="${1:-${Y3S_PROJECT_ID:-y3s-ext}}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud not found. Install the Google Cloud SDK:"
  echo "  https://cloud.google.com/sdk/docs/install"
  exit 1
fi

# Ensure there's an active, logged-in account.
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
  echo "No active gcloud account — launching login…"
  gcloud auth login
fi

# Create the project if it doesn't exist yet.
if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Creating project '$PROJECT_ID'…"
  gcloud projects create "$PROJECT_ID" --name="y3s"
else
  echo "Project '$PROJECT_ID' already exists."
fi

gcloud config set project "$PROJECT_ID"

echo "Enabling YouTube Data API v3…"
gcloud services enable youtube.googleapis.com

cat <<EOF

──────────────────────────────────────────────────────────────────────────────
 gcloud part done. Project: $PROJECT_ID  ·  YouTube Data API v3: enabled
──────────────────────────────────────────────────────────────────────────────

 The OAuth client ID is console-only (gcloud cannot create the "Chrome
 Extension" client type). Finish these two steps by hand:

 1) OAuth consent screen
    https://console.cloud.google.com/auth/overview?project=$PROJECT_ID
    - User type: External.  Add yourself under "Test users".

 2) Create the OAuth client
    https://console.cloud.google.com/auth/clients?project=$PROJECT_ID
    - Create client → Application type: "Chrome Extension"
    - Application ID: jdahkeplppmncjgkfabngnclfieeledp  (pinned via manifest "key")
    - Copy the generated client_id into manifest.json -> oauth2.client_id,
      then: npm run build  and reload the extension.
──────────────────────────────────────────────────────────────────────────────
EOF
