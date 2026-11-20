#!/usr/bin/env bash
# =============================================================================
# One-command public Cloud Run deployment for Gemini 3.8 Live Scaffold
# Usage:
#   ./deploy.sh [PROJECT_ID] [CLOUD_RUN_REGION] [GEMINI_LOCATION]
# Example:
#   ./deploy.sh your-gcp-project-id asia-southeast2 us-central1
# =============================================================================
set -euo pipefail

PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}}"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "Error: GCP Project ID is required."
  echo "Usage: ./deploy.sh <PROJECT_ID> [CLOUD_RUN_REGION] [GEMINI_LOCATION]"
  exit 1
fi
RUN_REGION="${2:-asia-southeast2}"
GEMINI_LOCATION="${3:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-gemini-38-live-scaffold}"

echo "Deploying '${SERVICE_NAME}' to Cloud Run..."
echo "  Project:         ${PROJECT_ID}"
echo "  Cloud Run Region:${RUN_REGION}"
echo "  Vertex AI Region:${GEMINI_LOCATION}"

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project "${PROJECT_ID}" \
  --region "${RUN_REGION}" \
  --allow-unauthenticated \
  --session-affinity \
  --timeout 3600 \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 40 \
  --set-env-vars "GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${GEMINI_LOCATION},GOOGLE_CLOUD_SEARCH_LOCATION=global,GEMINI_LIVE_MODEL=gemini-3.8-live,GEMINI_SEARCH_MODEL=gemini-3.8-flash,GEMINI_VOICE_NAME=Aoede,GEMINI_LANGUAGE_CODE=id-ID"

echo ""
echo "Deployment complete! Open the Service URL above in Chrome/Edge/Safari."
