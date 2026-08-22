#!/usr/bin/env bun
/**
 * Stops the CalebX Form Bot on Azure Container Apps to pause compute & billing.
 */

import { spawnSync } from "node:child_process";

const RESOURCE_GROUP = process.env.RESOURCE_GROUP ?? "rg-calebx-centralindia";
const APP_NAME = process.env.APP_NAME ?? "calebx-form-bot";

console.log(
  `⏹️ Stopping Azure Container App (${APP_NAME}) in ${RESOURCE_GROUP}...`,
);

const res = spawnSync(
  "az",
  [
    "containerapp",
    "stop",
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
  console.log("✓ Bot stopped successfully on Azure.");
  console.log("To start it again anytime, run: bun run azure:start\n");
} else {
  console.error("❌ Failed to stop Container App.");
  process.exit(res.status ?? 1);
}
