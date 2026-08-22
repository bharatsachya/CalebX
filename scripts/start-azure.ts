#!/usr/bin/env bun
/**
 * Starts the CalebX Form Bot on Azure Container Apps.
 */

import { spawnSync } from "node:child_process";

const RESOURCE_GROUP = process.env.RESOURCE_GROUP ?? "rg-calebx-centralindia";
const APP_NAME = process.env.APP_NAME ?? "calebx-form-bot";

console.log(
  `▶️ Starting Azure Container App (${APP_NAME}) in ${RESOURCE_GROUP}...`,
);

const res = spawnSync(
  "az",
  [
    "containerapp",
    "start",
    "--name",
    APP_NAME,
    "--resource-group",
    RESOURCE_GROUP,
    "-o",
    "none",
  ],
  { stdio: "inherit" },
);

if (res.status === 0) {
  console.log("✓ Bot started and polling on Azure.");
  console.log(
    `To stream logs, run: az containerapp logs show --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --follow\n`,
  );
} else {
  console.error("❌ Failed to start Container App.");
  process.exit(res.status ?? 1);
}
