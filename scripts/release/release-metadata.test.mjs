import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { summarizeAudit } from "./audit-packed.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packages = ["core", "cli", "mcp"];

test("npm beta metadata stays public, reviewable, and explicitly unreleased", async () => {
  for (const name of packages) {
    const root = resolve(repoRoot, "packages", name);
    const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    assert.equal(manifest.version, "0.1.0-beta.1");
    assert.equal(manifest.license, "MIT");
    assert.equal(manifest.engines.node, ">=22");
    assert.deepEqual(manifest.publishConfig, { access: "public", tag: "beta" });
    assert.equal(manifest.repository.url, "git+https://github.com/Daewooox/ScopeLock.git");
    assert.equal(manifest.homepage, "https://github.com/Daewooox/ScopeLock#readme");
    assert.equal(manifest.bugs.url, "https://github.com/Daewooox/ScopeLock/issues");
    assert.ok(manifest.keywords.length > 0);
  }

  for (const name of ["cli", "mcp"]) {
    const readme = await readFile(resolve(repoRoot, "packages", name, "README.md"), "utf8");
    assert.match(readme, /has not been published to npm yet/);
    assert.match(readme, /After publication/);
  }
});

test("packed production audit fails closed on unsupported output", () => {
  assert.deepEqual(
    summarizeAudit({
      auditReportVersion: 2,
      metadata: {
        vulnerabilities: { info: 0, low: 1, moderate: 2, high: 0, critical: 0, total: 3 },
      },
    }),
    { info: 0, low: 1, moderate: 2, high: 0, critical: 0, total: 3 },
  );
  assert.throws(() => summarizeAudit({}), /unsupported response/);
  assert.throws(
    () =>
      summarizeAudit({
        auditReportVersion: 2,
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: "0", critical: 0, total: 0 },
        },
      }),
    /unsupported response/,
  );
});
