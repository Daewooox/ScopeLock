#!/usr/bin/env node
// scripts/demo-vhs/write-guided-source.mjs
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("src", { recursive: true });
writeFileSync("src/dark-mode.js", "export const darkMode = true;\n");
writeFileSync(
  "src/dark-mode.test.js",
  [
    "import { test } from \"node:test\";",
    "import assert from \"node:assert/strict\";",
    "import { darkMode } from \"./dark-mode.js\";",
    "",
    "test(\"dark mode is enabled\", () => {",
    "  assert.equal(darkMode, true);",
    "});",
    "",
  ].join("\n"),
);
