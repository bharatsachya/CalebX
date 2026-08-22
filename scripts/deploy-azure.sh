#!/usr/bin/env bash
set -e

# Configuration
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-calebx-prod}"
LOCATION="${LOCATION:-centralindia}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-cae-calebx-prod}"

ACR_NAME="${ACR_NAME:-acrcalebx$RANDOM}"
APP_NAME="${APP_NAME:-calebx-form-bot}"
IMAGE_TAG="${IMAGE_TAG:-v1.0.0}"

echo "=========================================="
echo "  Deploying CalebX Form Bot to Azure"
echo "=========================================="
echo "Resource Group: $RESOURCE_GROUP"
echo "Location:       $LOCATION"
echo "Environment:    $ENVIRONMENT_NAME"
echo "ACR Name:       $ACR_NAME"
echo "App Name:       $APP_NAME"
echo "Image Tag:      $IMAGE_TAG"
echo "=========================================="

# Check for .env file
if [ ! -f .env ]; then
  echo "❌ .env file not found in current directory!"
  exit 1
fi

# Load .env variables
export $(grep -v '^#' .env | xargs)

# 1. Create Resource Group if not exists
echo "📦 1. Creating Resource Group ($RESOURCE_GROUP)..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" -o none

# 2. Create ACR if not exists
echo "🏭 2. Creating Azure Container Registry ($ACR_NAME)..."
az acr create --resource-group "$RESOURCE_GROUP" --name "$ACR_NAME" --sku Basic --admin-enabled true -o none

# 3. Create Container Apps Environment if not exists
echo "🌐 3. Creating Container Apps Environment ($ENVIRONMENT_NAME)..."
az containerapp env create --name "$ENVIRONMENT_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" -o none

# 4. Build and push image using ACR Tasks
echo "🔨 4. Building and pushing Docker image..."
az acr build --registry "$ACR_NAME" --image "${APP_NAME}:${IMAGE_TAG}" .

# 5. Get ACR Credentials
echo "🔑 5. Retrieving ACR credentials..."
ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

# 6. Deploy Container App
echo "🚀 6. Deploying Container App ($APP_NAME)..."
az containerapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENVIRONMENT_NAME" \
  --image "${ACR_NAME}.azurecr.io/${APP_NAME}:${IMAGE_TAG}" \
  --registry-server "${ACR_NAME}.azurecr.io" \
  --registry-username "$ACR_NAME" \
  --registry-password "$ACR_PASSWORD" \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.25 \
  --memory 0.5Gi \
  --secrets \
    telegram-token="$TELEGRAM_BOT_TOKEN" \
    google-private-key="$GOOGLE_PRIVATE_KEY" \
  --env-vars \
    NODE_ENV="production" \
    LOG_LEVEL="info" \
    GOOGLE_SHEETS_SPREADSHEET_ID="$GOOGLE_SHEETS_SPREADSHEET_ID" \
    GOOGLE_SERVICE_ACCOUNT_EMAIL="$GOOGLE_SERVICE_ACCOUNT_EMAIL" \
    TELEGRAM_BOT_TOKEN=secretref:telegram-token \
    GOOGLE_PRIVATE_KEY=secretref:google-private-key \
  -o none

echo ""
echo "🎉 Deployment complete!"
echo "To stream live logs, run:"
echo "  az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --follow"
