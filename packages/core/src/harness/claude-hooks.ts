export function claudeScopeLockEntry() {
  return {
    matcher: "Edit|Write|MultiEdit",
    hooks: [{ type: "command", command: "scopelock hook gate" }],
  };
}
