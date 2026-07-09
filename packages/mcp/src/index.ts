#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createScopeLockMcpServer } from "./tools.js";

async function main(): Promise<void> {
  const server = createScopeLockMcpServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ScopeLock MCP server failed: ${message}\n`);
  process.exitCode = 1;
});
