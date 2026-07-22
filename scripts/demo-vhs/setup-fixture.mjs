#!/usr/bin/env node
// scripts/demo-vhs/setup-fixture.mjs
import { buildScenarioFixture } from "./fixture.mjs";

const scenario = process.argv[2];
if (scenario !== "guided" && scenario !== "plan") {
  console.error("usage: setup-fixture.mjs <guided|plan>");
  process.exitCode = 2;
} else {
  const { dir } = buildScenarioFixture(scenario);
  process.stdout.write(dir);
}
