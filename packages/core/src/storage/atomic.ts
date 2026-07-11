import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Write JSON via temp file + rename so an interrupted write can never leave
 * a truncated file behind. Temp file lives in the same directory to keep the
 * rename atomic (same filesystem).
 */
export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tempPath = join(dir, `.tmp-${randomBytes(6).toString("hex")}`);
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, filePath);
  if (process.platform !== "win32") await chmod(filePath, 0o600);
}
