#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { BOLD, DIM, GREEN, RED, RESET, YELLOW } from "./lib/output.ts";
import { logger, shutdownLoggers } from "./lib/logger.ts";

type StepResult = {
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
};

function runStep(name: string, cmd: string, args: string[]): StepResult {
  logger.info("");
  logger.info(
    `${BOLD}▶ ${name}${RESET} ${DIM}(${cmd} ${args.join(" ")})${RESET}`,
  );
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status === 0) {
    return { name, status: "pass" };
  }
  return { name, status: "fail", detail: `exit ${r.status ?? "?"}` };
}

function runOptional(name: string, reason: string): StepResult {
  logger.info("");
  logger.info(`${BOLD}▶ ${name}${RESET}  ${DIM}— ${reason}${RESET}`);
  return { name, status: "skip", detail: reason };
}

function summary(results: StepResult[]): void {
  logger.info("");
  logger.info(`${BOLD}Pre-push summary${RESET}`);
  for (const r of results) {
    if (r.status === "pass") {
      logger.info(`  ${GREEN}✓${RESET} ${r.name}`);
    } else if (r.status === "skip") {
      logger.info(
        `  ${YELLOW}─${RESET} ${r.name}  ${DIM}${r.detail ?? ""}${RESET}`,
      );
    } else {
      logger.error(
        `  ${RED}✗${RESET} ${r.name}  ${DIM}${r.detail ?? ""}${RESET}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const results: StepResult[] = [];
  results.push(runStep("typecheck", "bun", ["run", "typecheck"]));
  results.push(runStep("lint (full repo)", "bun", ["run", "lint"]));
  results.push(
    runStep("format check (full repo)", "bun", ["run", "format:check"]),
  );
  results.push(runOptional("tests", "no test runner configured yet"));
  summary(results);
  const failed = results.filter((r) => r.status === "fail");
  if (failed.length > 0) {
    logger.info("");
    logger.error(
      `${RED}${BOLD}✗ pre-push failed${RESET} — fix the ${failed.length} failing step(s) above.`,
    );
    await shutdownLoggers();
    process.exit(1);
  }
  logger.info("");
  logger.info(`${GREEN}${BOLD}✓ pre-push passed${RESET}`);
  await shutdownLoggers();
}

await main();
