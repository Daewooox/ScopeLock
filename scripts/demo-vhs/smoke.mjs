#!/usr/bin/env node
// scripts/demo-vhs/smoke.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScenarioFixture, cleanupFixtureRepo } from "./fixture.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");

export function extractCommands(tapeText) {
  const commands = [];
  for (const line of tapeText.split("\n")) {
    const doubleQuoted = line.match(/^Type\s+"(.*)"$/);
    const backtickQuoted = line.match(/^Type\s+`(.*)`$/);
    if (doubleQuoted) {
      commands.push(doubleQuoted[1].replace(/\\"/g, "\""));
    } else if (backtickQuoted) {
      commands.push(backtickQuoted[1]);
    }
  }
  // The first Type line is always the fixture cd/export setup, performed
  // natively by buildScenarioFixture below instead of replayed as a shell
  // command.
  return commands.slice(1);
}

export function stripTrailingClear(command) {
  return command.replace(/[;&]+\s*clear\s*$/, "").trim();
}

function checkScenario(name) {
  const tapeText = readFileSync(join(scriptDir, `${name}.tape`), "utf8");
  const commands = extractCommands(tapeText);

  const { dir, env } = buildScenarioFixture(name);
  try {
    for (const raw of commands) {
      const command = stripTrailingClear(raw);
      const result = spawnSync("sh", ["-c", command], {
        cwd: dir,
        env: { ...env, REPO: repoRoot },
        encoding: "utf8",
      });
      if (result.status !== 0) {
        throw new Error(
          `[${name}] command failed (exit ${result.status}): ${command}\n${result.stderr || result.stdout}`,
        );
      }
    }
  } finally {
    cleanupFixtureRepo(dir);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failed = false;
  for (const name of ["guided", "plan"]) {
    try {
      checkScenario(name);
      console.log(`ok - ${name}`);
    } catch (error) {
      failed = true;
      console.error(error.message);
    }
  }
  process.exitCode = failed ? 1 : 0;
}
