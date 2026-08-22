#!/usr/bin/env bun
/**
 * Destroys all Azure resources in rg-calebx-centralindia.
 */

import { spawnSync } from "node:child_process";

const RESOURCE_GROUP = process.env.RESOURCE_GROUP ?? "rg-calebx-centralindia";

console.log(`⚠️ Deleting all Azure resources in ${RESOURCE_GROUP}...`);

const res = spawnSync(
  "az",
  ["group", "delete", "--name", RESOURCE_GROUP, "--yes", "--no-wait"],
  { stdio: "inherit" },
);

if (res.status === 0) {
  console.log(
    "✓ Deletion requested. Azure is cleaning up all cloud resources.\n",
  );
} else {
  console.error("❌ Failed to delete resource group.");
  process.exit(res.status ?? 1);
}
