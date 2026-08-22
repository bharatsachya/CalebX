#!/usr/bin/env bun
/**
 * Automated Azure Container Apps deployment script.
 * Reads environment variables natively via Bun (handles multiline PEM private keys safely).
 */

import { spawnSync } from "node:child_process";

const RESOURCE_GROUP = process.env.RESOURCE_GROUP ?? "rg-calebx-prod";
const LOCATION = process.env.LOCATION ?? "centralindia";
const ENVIRONMENT_NAME = process.env.ENVIRONMENT_NAME ?? "cae-calebx-prod";

const ACR_NAME =
  process.env.ACR_NAME ?? `acrcalebx${Math.floor(1000 + Math.random() * 9000)}`;
const APP_NAME = process.env.APP_NAME ?? "calebx-form-bot";
const IMAGE_TAG = process.env.IMAGE_TAG ?? "v1.0.0";

console.log("==========================================");
console.log("  Deploying CalebX Form Bot to Azure");
console.log("==========================================");
console.log(`Resource Group: ${RESOURCE_GROUP}`);
console.log(`Location:       ${LOCATION}`);
console.log(`Environment:    ${ENVIRONMENT_NAME}`);
console.log(`ACR Name:       ${ACR_NAME}`);
console.log(`App Name:       ${APP_NAME}`);
console.log(`Image Tag:      ${IMAGE_TAG}`);
console.log("==========================================\n");

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY;

if (!botToken || !spreadsheetId || !serviceAccountEmail || !privateKey) {
  console.error(
    "❌ Missing required environment variables in .env (TELEGRAM_BOT_TOKEN, GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY)",
  );
  process.exit(1);
}

function run(cmd: string, args: string[], captureOutput = false): string {
  console.log(`▶ ${cmd} ${args.slice(0, 4).join(" ")}...`);
  const res = spawnSync(cmd, args, {
    stdio: captureOutput ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf-8",
  });
  if (res.status !== 0) {
    console.error(`❌ Command failed with exit code ${res.status}`);
    process.exit(res.status ?? 1);
  }
  return res.stdout?.trim() ?? "";
}

// 1. Create Resource Group
console.log(`\n📦 1. Creating Resource Group (${RESOURCE_GROUP})...`);
run("az", [
  "group",
  "create",
  "--name",
  RESOURCE_GROUP,
  "--location",
  LOCATION,
  "-o",
  "none",
]);

// 2. Create ACR
console.log(`\n🏭 2. Creating Azure Container Registry (${ACR_NAME})...`);
run("az", [
  "acr",
  "create",
  "--resource-group",
  RESOURCE_GROUP,
  "--name",
  ACR_NAME,
  "--sku",
  "Basic",
  "--admin-enabled",
  "true",
  "-o",
  "none",
]);

// 3. Create Container Apps Environment
console.log(
  `\n🌐 3. Creating Container Apps Environment (${ENVIRONMENT_NAME})...`,
);
run("az", [
  "containerapp",
  "env",
  "create",
  "--name",
  ENVIRONMENT_NAME,
  "--resource-group",
  RESOURCE_GROUP,
  "--location",
  LOCATION,
  "-o",
  "none",
]);

// 4. Build and push image
console.log("\n🔨 4. Building and pushing Docker image to Azure...");
run("az", [
  "acr",
  "build",
  "--registry",
  ACR_NAME,
  "--image",
  `${APP_NAME}:${IMAGE_TAG}`,
  ".",
]);

// 5. Get ACR Credentials
console.log("\n🔑 5. Retrieving ACR credentials...");
const acrPassword = run(
  "az",
  [
    "acr",
    "credential",
    "show",
    "--name",
    ACR_NAME,
    "--query",
    "passwords[0].value",
    "-o",
    "tsv",
  ],
  true,
);

// 6. Deploy Container App
console.log(`\n🚀 6. Deploying Container App (${APP_NAME})...`);
run("az", [
  "containerapp",
  "create",
  "--name",
  APP_NAME,
  "--resource-group",
  RESOURCE_GROUP,
  "--environment",
  ENVIRONMENT_NAME,
  "--image",
  `${ACR_NAME}.azurecr.io/${APP_NAME}:${IMAGE_TAG}`,
  "--registry-server",
  `${ACR_NAME}.azurecr.io`,
  "--registry-username",
  ACR_NAME,
  "--registry-password",
  acrPassword,
  "--min-replicas",
  "1",
  "--max-replicas",
  "1",
  "--cpu",
  "0.25",
  "--memory",
  "0.5Gi",
  "--secrets",
  `telegram-token=${botToken}`,
  `google-private-key=${privateKey}`,
  "--env-vars",
  "NODE_ENV=production",
  "LOG_LEVEL=info",
  `GOOGLE_SHEETS_SPREADSHEET_ID=${spreadsheetId}`,
  `GOOGLE_SERVICE_ACCOUNT_EMAIL=${serviceAccountEmail}`,
  "TELEGRAM_BOT_TOKEN=secretref:telegram-token",
  "GOOGLE_PRIVATE_KEY=secretref:google-private-key",
  "-o",
  "none",
]);

console.log("\n🎉 Deployment complete!");
console.log("To stream live logs, run:");
console.log(
  `  az containerapp logs show --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --follow\n`,
);
