/**
 * Best-effort secret redaction for receipt previews and stored raw output.
 *
 * This is a small, deliberately non-exhaustive set of common credential
 * shapes, not a general-purpose secret scanner. It cannot see secrets in
 * formats it doesn't recognize (custom tokens, base64-wrapped values,
 * multi-line PEM keys split across chunks, etc.). Treat it as a safety net
 * that reduces accidental leakage, never as a guarantee that a receipt or
 * `--store-raw-output` artifact is free of sensitive content. See
 * THREAT-MODEL.md.
 */
export function redactSecrets(value: string): string {
  return value
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16}|x(?:ox[baprs]|app)-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|hf_[A-Za-z0-9]{20,})\b/g,
      "[REDACTED]",
    )
    .replace(/\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|NPM_TOKEN|GITHUB_TOKEN)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    // HTTP authentication schemes are case-insensitive per RFC 9110; `$1`
    // preserves whatever casing the caller used (Bearer/bearer/BEARER).
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{20,}/gi, "$1 [REDACTED]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, "$1[REDACTED]@");
}
