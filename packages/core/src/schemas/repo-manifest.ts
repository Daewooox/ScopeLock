import { z } from "zod";

export const REPO_MANIFEST_SCHEMA_VERSION = 1;

export const packageManagerSchema = z.enum(["npm", "pnpm", "yarn", "bun"]);
export const projectTypeSchema = z.enum([
  "ios",
  "android",
  "kmp",
  "react-native",
  "frontend",
  "backend",
  "generic",
]);

export const repoManifestSchema = z.object({
  schemaVersion: z.literal(REPO_MANIFEST_SCHEMA_VERSION),
  root: z.string().min(1),
  branch: z.string().nullable().default(null),
  headSha: z.string().nullable().default(null),
  packageManagers: z.array(packageManagerSchema).default([]),
  projectTypes: z.array(projectTypeSchema).default(["generic"]),
  files: z.array(z.string().min(1)).default([]),
  testPaths: z.array(z.string().min(1)).default([]),
  riskyPaths: z.array(z.string().min(1)).default([]),
});

export type PackageManager = z.infer<typeof packageManagerSchema>;
export type ProjectType = z.infer<typeof projectTypeSchema>;
export type RepoManifest = z.infer<typeof repoManifestSchema>;
