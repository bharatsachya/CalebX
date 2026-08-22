# Azure Container Apps Deployment Guide for CalebX Form Bot

This guide provides instructions for deploying the CalebX Telegram Form Bot to **Azure Container Apps** using the Azure CLI.

---

## 1. Architecture & Deployment Characteristics

- **Runtime**: Bun + TypeScript
- **Compute**: Azure Container Apps (Consumption Plan)
- **Scale**: Exactly **1 active replica** (`--min-replicas 1 --max-replicas 1`)
- **Transport**: Telegram Long Polling (`bot.start()`) — no inbound public ingress or webhooks required
- **Persistence**: Google Sheets (Candidates, Contacts, Matches) + Durable Google Sheets Consent & Identity Store
- **External Dependencies**: Telegram API, Google Sheets v4 API

> [!IMPORTANT]
> **Single Replica Requirement**: Telegram long polling allows only one consumer per bot token. Running multiple replicas concurrently would cause update drops and `409 Conflict` errors. Always set `min-replicas = 1` and `max-replicas = 1`.

---

## 2. Prerequisites

1. [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed (`az version`)
2. Telegram Bot Token from [@BotFather](https://t.me/botfather)
3. Google Cloud Service Account credentials with Google Sheets API access
4. Docker installed locally (or Azure Container Registry build task)

---

## 3. Configuration & Environment Variables

| Variable                       | Description                                                        | Secret? |
| :----------------------------- | :----------------------------------------------------------------- | :------ |
| `TELEGRAM_BOT_TOKEN`           | Telegram Bot Token from BotFather                                  | **Yes** |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | The ID string from the Google Sheet URL                            | No      |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email (e.g. `bot@project.iam.gserviceaccount.com`) | No      |
| `GOOGLE_PRIVATE_KEY`           | Private key PEM string (`-----BEGIN PRIVATE KEY-----\n...`)        | **Yes** |
| `NODE_ENV`                     | Environment identifier (`production`)                              | No      |
| `LOG_LEVEL`                    | Logging level (`info`, `debug`, `warn`, `error`)                   | No      |

---

## 4. Step-by-Step Deployment via Azure CLI

### Step 1: Login and Set Context

```bash
az login
az account set --subscription "<YOUR_SUBSCRIPTION_ID_OR_NAME>"
```

### Step 2: Set Variables

```bash
RESOURCE_GROUP="rg-calebx-prod"
LOCATION="eastus"
ENVIRONMENT_NAME="cae-calebx-prod"
ACR_NAME="acrcalebxprod"
APP_NAME="calebx-form-bot"
IMAGE_TAG="v1.0.0"
```

### Step 3: Create Resource Group and Container Registry

```bash
# 1. Create Resource Group
az group create --name $RESOURCE_GROUP --location $LOCATION

# 2. Create Azure Container Registry (Basic SKU)
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --admin-enabled true

# 3. Create Container Apps Environment
az containerapp env create \
  --name $ENVIRONMENT_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION
```

### Step 4: Build and Push Docker Image

```bash
# Build using Azure Container Registry Tasks (no local docker daemon required)
az acr build \
  --registry $ACR_NAME \
  --image ${APP_NAME}:${IMAGE_TAG} \
  .
```

_(Alternatively, build locally and push)_:

```bash
az acr login --name $ACR_NAME
docker build -t ${ACR_NAME}.azurecr.io/${APP_NAME}:${IMAGE_TAG} .
docker push ${ACR_NAME}.azurecr.io/${APP_NAME}:${IMAGE_TAG}
```

### Step 5: Deploy the Container App with Secrets

Retrieve ACR credentials:

```bash
ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query "passwords[0].value" -o tsv)
```

Create and launch the Container App:

```bash
az containerapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --environment $ENVIRONMENT_NAME \
  --image "${ACR_NAME}.azurecr.io/${APP_NAME}:${IMAGE_TAG}" \
  --registry-server "${ACR_NAME}.azurecr.io" \
  --registry-username $ACR_NAME \
  --registry-password "$ACR_PASSWORD" \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.5 \
  --memory 1.0Gi \
  --secrets \
    telegram-token="<YOUR_TELEGRAM_BOT_TOKEN>" \
    google-private-key="<YOUR_GOOGLE_PRIVATE_KEY>" \
  --env-vars \
    NODE_ENV="production" \
    LOG_LEVEL="info" \
    GOOGLE_SHEETS_SPREADSHEET_ID="<YOUR_SPREADSHEET_ID>" \
    GOOGLE_SERVICE_ACCOUNT_EMAIL="<YOUR_SERVICE_ACCOUNT_EMAIL>" \
    TELEGRAM_BOT_TOKEN=secretref:telegram-token \
    GOOGLE_PRIVATE_KEY=secretref:google-private-key
```

---

## 5. Verification & Monitoring

### Check Application Logs (Real-time Stream)

```bash
az containerapp logs show \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --follow
```

### Expected Startup Output

```text
{"env":"production","level":30,"time":...,"event":"bot_started","username":"calebx_form_bot","msg":"[audit] bot_started"}
📋 @calebx_form_bot up and polling — 32 questions, sheet tabs: Candidates, Contacts, Matches.
```

### Check Replica Status

```bash
az containerapp replica list \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  -o table
```

---

## 6. Updating & Redeploying

When shipping a new update:

1. Build and tag the new image:

   ```bash
   NEW_TAG="v1.0.1"
   az acr build --registry $ACR_NAME --image ${APP_NAME}:${NEW_TAG} .
   ```

2. Update the container app:
   ```bash
   az containerapp update \
     --name $APP_NAME \
     --resource-group $RESOURCE_GROUP \
     --image "${ACR_NAME}.azurecr.io/${APP_NAME}:${NEW_TAG}"
   ```

---

## 7. Rollback Strategy

Azure Container Apps creates a revision for each update. To roll back to a previous revision:

1. List available revisions:

   ```bash
   az containerapp revision list \
     --name $APP_NAME \
     --resource-group $RESOURCE_GROUP \
     -o table
   ```

2. Activate and point traffic to the previous revision:
   ```bash
   PREVIOUS_REVISION="<REVISION_NAME>"
   az containerapp revision activate \
     --name $APP_NAME \
     --resource-group $RESOURCE_GROUP \
     --revision $PREVIOUS_REVISION
   ```

---

## 8. Restart & Resilience Behavior

- **Automatic Restarts**: If the container process crashes or restarts, Container Apps automatically spins up a replacement replica.
- **State Preservation**: Identity mappings (`telegram_user_id`), candidate answers, contact details, and consent decisions are persisted directly in Google Sheets. The bot resumes conversations seamlessly without state loss.
- **Quota Safety**: The Google Sheets table adapter utilizes in-memory snapshotting with automatic write invalidation to stay well below the 60 requests/minute quota.
