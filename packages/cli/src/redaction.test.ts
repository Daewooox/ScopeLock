import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "./redaction.js";

describe("redactSecrets", () => {
  it("redacts OpenAI/Anthropic-style sk- keys", () => {
    const secret = `sk-${"a".repeat(24)}`;
    assert.doesNotMatch(redactSecrets(`token=${secret} end`), new RegExp(secret));
    assert.match(redactSecrets(`token=${secret} end`), /\[REDACTED\]/);
  });

  it("redacts GitHub tokens (ghp_/gho_/ghu_/ghs_/ghr_)", () => {
    for (const prefix of ["ghp", "gho", "ghu", "ghs", "ghr"]) {
      const secret = `${prefix}_${"B".repeat(20)}`;
      assert.doesNotMatch(redactSecrets(`export GITHUB_PAT=${secret}`), new RegExp(secret));
    }
  });

  it("redacts AWS access key ids", () => {
    const secret = `AKIA${"1".repeat(16)}`;
    assert.doesNotMatch(redactSecrets(`AWS_KEY: ${secret}`), new RegExp(secret));
  });

  it("redacts Slack tokens across all known prefixes", () => {
    // Deliberately not a realistic-looking token (letters only, no digit
    // segments) so this fixture doesn't itself trip secret-scanning on push;
    // the redaction regex only cares about the prefix and length, not digit
    // placement, so this still exercises the same match path.
    for (const prefix of ["xoxb", "xoxp", "xoxa", "xoxr", "xoxs"]) {
      const secret = `${prefix}-${"q".repeat(12)}-${"z".repeat(16)}`;
      assert.doesNotMatch(redactSecrets(`slack token ${secret} in log`), new RegExp(secret));
    }
  });

  it("redacts Google API keys (AIza...)", () => {
    const secret = `AIza${"S".repeat(35)}`;
    assert.equal(secret.length, 39);
    assert.doesNotMatch(redactSecrets(`key=${secret}`), new RegExp(secret));
  });

  it("redacts HuggingFace tokens (hf_...)", () => {
    const secret = `hf_${"q".repeat(34)}`;
    assert.doesNotMatch(redactSecrets(`HF_TOKEN=${secret}`), new RegExp(secret));
  });

  it("redacts a bare Authorization: Bearer token", () => {
    // Not a real three-segment JWT shape (no dots), so this fixture doesn't
    // itself trip JWT-pattern secret scanners; the Bearer regex only cares
    // about token-charset length, not JWT structure specifically.
    const token = "a".repeat(20) + "B".repeat(20) + "9".repeat(20);
    const line = `Authorization: Bearer ${token}`;
    const out = redactSecrets(line);
    assert.doesNotMatch(out, new RegExp(token));
    assert.match(out, /Bearer \[REDACTED\]/);
  });

  it("redacts named-env assignments regardless of secret shape", () => {
    const out = redactSecrets("OPENAI_API_KEY=whatever-custom-format-1234");
    assert.match(out, /OPENAI_API_KEY=\[REDACTED\]/);
    assert.doesNotMatch(out, /whatever-custom-format-1234/);
  });

  it("redacts credentials embedded in a URL", () => {
    const out = redactSecrets("cloning https://user:hunter2@example.com/repo.git");
    assert.doesNotMatch(out, /hunter2/);
    assert.match(out, /https:\/\/\[REDACTED\]@example\.com/);
  });

  it("does not touch ordinary text, hashes, or unrelated hyphenated identifiers", () => {
    const benign = [
      "hello world, this is normal stdout output",
      "commit sha 4f2c9a1b8e3d7c6f5a0912345678901234567890",
      "task-w0-progressbar-finish-implementation-a029260681",
      "https://github.com/Daewooox/ScopeLock/pull/42",
      "1902 passed, 25 skipped, 1 xfailed in 1.84s",
      "a normal bearer of good news arrived today",
    ];
    for (const line of benign) {
      assert.equal(redactSecrets(line), line, `expected no change for: ${line}`);
    }
  });

  it("redacts multiple distinct secrets in the same blob without cross-contamination", () => {
    const openaiKey = `sk-${"x".repeat(24)}`;
    const slack = `xoxb-${"q".repeat(12)}-${"z".repeat(16)}`;
    const blob = `first=${openaiKey}\nsecond=${slack}\nplain text stays`;
    const out = redactSecrets(blob);
    assert.doesNotMatch(out, new RegExp(openaiKey));
    assert.doesNotMatch(out, new RegExp(slack));
    assert.match(out, /plain text stays/);
    assert.equal((out.match(/\[REDACTED\]/g) ?? []).length, 2);
  });
});
