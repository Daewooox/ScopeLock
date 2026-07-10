import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  agentWorkspaceManifestSchema,
  agentEnvironmentPreflightReportSchema,
  runAgentPreflight,
  hashSkillDir,
  hashFileBytes,
  isRepoRelativeSafe,
  toPosix,
  type AgentWorkspaceManifest,
} from "./index.js";

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "sl-agentenv-"));
}

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

const basePolicy = {
  requirePhysicalCopies: true,
  requireRuleParity: true,
  requireSkillParity: true,
};

describe("agent-workspace manifest schema", () => {
  it("accepts a valid manifest", () => {
    const parsed = agentWorkspaceManifestSchema.parse({
      schemaVersion: 1,
      targets: ["claude", "cursor", "codex"],
      rules: [{ id: "agents", path: "AGENTS.md", required: true }],
      skills: [{ name: "review-sentinel", path: ".agents/skills/review-sentinel", required: true }],
      policy: basePolicy,
    });
    assert.equal(parsed.targets.length, 3);
  });

  it("rejects an unknown target", () => {
    assert.throws(() =>
      agentWorkspaceManifestSchema.parse({
        schemaVersion: 1,
        targets: ["claude", "aider"],
        policy: basePolicy,
      }),
    );
  });

  it("rejects duplicate targets, rule ids, and skill names", () => {
    assert.throws(
      () =>
        agentWorkspaceManifestSchema.parse({
          schemaVersion: 1,
          targets: ["claude", "claude"],
          policy: basePolicy,
        }),
      /duplicate target/,
    );
    assert.throws(
      () =>
        agentWorkspaceManifestSchema.parse({
          schemaVersion: 1,
          targets: ["claude"],
          rules: [
            { id: "r", path: "AGENTS.md", required: true },
            { id: "r", path: "CLAUDE.md", required: true },
          ],
          policy: basePolicy,
        }),
      /duplicate rule id/,
    );
    assert.throws(
      () =>
        agentWorkspaceManifestSchema.parse({
          schemaVersion: 1,
          targets: ["claude"],
          skills: [
            { name: "s", path: ".agents/skills/s", required: true },
            { name: "s", path: ".claude/skills/s", required: true },
          ],
          policy: basePolicy,
        }),
      /duplicate skill name/,
    );
  });

  it("rejects path traversal in a declared artifact path", () => {
    assert.throws(() =>
      agentWorkspaceManifestSchema.parse({
        schemaVersion: 1,
        targets: ["claude"],
        rules: [{ id: "escape", path: "../secret", required: true }],
        policy: basePolicy,
      }),
    );
  });
});

describe("repo-relative path safety", () => {
  it("classifies escaping and absolute paths as unsafe", () => {
    assert.equal(isRepoRelativeSafe("ok/path.md"), true);
    assert.equal(isRepoRelativeSafe("a/../b"), true); // stays inside
    assert.equal(isRepoRelativeSafe("../secret"), false);
    assert.equal(isRepoRelativeSafe("a/../../x"), false);
    assert.equal(isRepoRelativeSafe("/etc/passwd"), false);
    assert.equal(isRepoRelativeSafe("C:/Windows"), false);
    assert.equal(isRepoRelativeSafe(""), false);
  });

  it("normalizes OS separators to POSIX", () => {
    assert.equal(toPosix("a\\b\\c"), "a/b/c");
    assert.equal(toPosix("a/b"), "a/b");
  });
});

describe("skill directory digest", () => {
  it("is identical for identical trees and changes on a single byte", () => {
    const a = tempRepo();
    const b = tempRepo();
    try {
      for (const root of [a, b]) {
        write(root, "skill/SKILL.md", "sentinel\n");
        write(root, "skill/references.md", "ref body\n");
      }
      assert.equal(hashSkillDir(join(a, "skill")), hashSkillDir(join(b, "skill")));

      const before = hashSkillDir(join(a, "skill"));
      write(a, "skill/references.md", "ref body!\n"); // one byte differs
      assert.notEqual(hashSkillDir(join(a, "skill")), before);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it("does not depend on file creation order", () => {
    const a = tempRepo();
    const b = tempRepo();
    try {
      write(a, "skill/SKILL.md", "x");
      write(a, "skill/z.md", "z");
      write(a, "skill/a.md", "a");
      // reverse creation order
      write(b, "skill/a.md", "a");
      write(b, "skill/z.md", "z");
      write(b, "skill/SKILL.md", "x");
      assert.equal(hashSkillDir(join(a, "skill")), hashSkillDir(join(b, "skill")));
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it("ignores foreign files outside the declared skill directory", () => {
    const root = tempRepo();
    try {
      write(root, "skill/SKILL.md", "sentinel\n");
      const before = hashSkillDir(join(root, "skill"));
      write(root, "other/FOREIGN.md", "not part of skill\n");
      write(root, "skill-sibling.md", "also foreign\n");
      assert.equal(hashSkillDir(join(root, "skill")), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes .git from the digest", () => {
    const clean = tempRepo();
    const dirty = tempRepo();
    try {
      for (const root of [clean, dirty]) write(root, "skill/SKILL.md", "sentinel\n");
      write(dirty, "skill/.git/HEAD", "ref: refs/heads/main\n");
      assert.equal(hashSkillDir(join(clean, "skill")), hashSkillDir(join(dirty, "skill")));
    } finally {
      rmSync(clean, { recursive: true, force: true });
      rmSync(dirty, { recursive: true, force: true });
    }
  });
});

describe("runAgentPreflight", () => {
  const now = "2026-07-10T00:00:00.000Z";

  it("passes when every target has matching physical rules and skills", () => {
    const root = tempRepo();
    try {
      // canonical + per-target rule copies (identical bytes -> parity holds)
      write(root, "AGENTS.md", "RULE\n");
      write(root, "CLAUDE.md", "RULE\n");
      // canonical + per-target skill copies (identical bytes -> parity holds)
      for (const dir of [".agents/skills/rev", ".claude/skills/rev", ".cursor/skills/rev"]) {
        write(root, `${dir}/SKILL.md`, "SK\n");
      }
      const manifest: AgentWorkspaceManifest = agentWorkspaceManifestSchema.parse({
        schemaVersion: 1,
        targets: ["claude", "cursor", "codex"],
        rules: [{ id: "agents", path: "AGENTS.md", required: true }],
        skills: [{ name: "rev", path: ".agents/skills/rev", required: true }],
        policy: basePolicy,
      });
      const report = runAgentPreflight({ manifest, repoRoot: root, now });
      agentEnvironmentPreflightReportSchema.parse(report);
      assert.equal(report.summary.status, "pass");
      assert.equal(report.summary.violationsCount, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a shared .agents/skills copy satisfies both cursor and codex", () => {
    const root = tempRepo();
    try {
      write(root, ".agents/skills/rev/SKILL.md", "SK\n");
      const manifest = agentWorkspaceManifestSchema.parse({
        schemaVersion: 1,
        targets: ["cursor", "codex"],
        skills: [{ name: "rev", path: ".agents/skills/rev", required: true }],
        policy: basePolicy,
      });
      const report = runAgentPreflight({ manifest, repoRoot: root, now });
      assert.equal(report.summary.status, "pass");
      for (const t of report.targets) {
        assert.equal(t.skillResults[0]?.present, true);
        assert.match(t.skillResults[0]?.resolvedPath ?? "", /\.agents\/skills\/rev|\.agents[\\/]skills[\\/]rev/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a violation for a missing required skill and none for a missing optional one", () => {
    const root = tempRepo();
    try {
      const requiredManifest = agentWorkspaceManifestSchema.parse({
        schemaVersion: 1,
        targets: ["codex"],
        skills: [{ name: "rev", path: ".agents/skills/rev", required: true }],
        policy: basePolicy,
      });
      const failing = runAgentPreflight({ manifest: requiredManifest, repoRoot: root, now });
      assert.equal(failing.summary.status, "fail");
      assert.equal(failing.targets[0]?.violations[0]?.code, "missing_required_skill");

      const optionalManifest = agentWorkspaceManifestSchema.parse({
        schemaVersion: 1,
        targets: ["codex"],
        skills: [{ name: "rev", path: ".agents/skills/rev", required: false }],
        policy: basePolicy,
      });
      const warning = runAgentPreflight({ manifest: optionalManifest, repoRoot: root, now });
      assert.equal(warning.summary.status, "warn");
      assert.equal(warning.targets[0]?.violations.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("detects a symlinked skill when physical copies are required", (t) => {
    const root = tempRepo();
    try {
      // real shared copy + a symlinked cursor-specific copy pointing at it
      write(root, ".agents/skills/rev/SKILL.md", "SK\n");
      mkdirSync(join(root, ".cursor/skills"), { recursive: true });
      try {
        symlinkSync(join(root, ".agents/skills/rev"), join(root, ".cursor/skills/rev"), "dir");
      } catch {
        t.skip("filesystem cannot create symlinks");
        return;
      }
      const manifest = agentWorkspaceManifestSchema.parse({
        schemaVersion: 1,
        targets: ["cursor"],
        skills: [{ name: "rev", path: ".agents/skills/rev", required: true }],
        policy: basePolicy,
      });
      const report = runAgentPreflight({ manifest, repoRoot: root, now });
      assert.equal(report.summary.status, "fail");
      assert.equal(report.targets[0]?.skillResults[0]?.isSymlink, true);
      assert.equal(report.targets[0]?.violations[0]?.code, "symlink_when_physical_required");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags a rule parity mismatch when a target copy differs from canonical", () => {
    const root = tempRepo();
    try {
      write(root, "AGENTS.md", "RULE\n"); // canonical + codex/cursor
      write(root, "CLAUDE.md", "DIFFERENT\n"); // claude copy drifted
      const manifest = agentWorkspaceManifestSchema.parse({
        schemaVersion: 1,
        targets: ["claude", "codex"],
        rules: [{ id: "agents", path: "AGENTS.md", required: true }],
        policy: basePolicy,
      });
      const report = runAgentPreflight({ manifest, repoRoot: root, now });
      const claude = report.targets.find((tt) => tt.id === "claude");
      const codex = report.targets.find((tt) => tt.id === "codex");
      assert.equal(claude?.status, "fail");
      assert.equal(claude?.violations[0]?.code, "rule_parity_mismatch");
      assert.equal(codex?.status, "pass");
      assert.equal(hashFileBytes(join(root, "AGENTS.md")).length, 64);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
