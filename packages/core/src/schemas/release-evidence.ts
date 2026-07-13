import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const commitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const releaseVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

export const releaseCheckStatusSchema = z.enum([
  "passed",
  "failed",
  "pending",
  "not-run",
]);

export const releasePackageEvidenceSchema = z
  .object({
    name: z.string().min(1),
    version: releaseVersionSchema,
    filename: z.string().min(1),
    sha256: sha256Schema,
    sizeBytes: z.number().int().nonnegative(),
    fileCount: z.number().int().positive(),
  })
  .strict();

export const releaseEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: releaseVersionSchema,
    commitSha: commitShaSchema,
    generatedAt: z.string().datetime(),
    packages: z.array(releasePackageEvidenceSchema).min(1),
    ciRunUrl: z.string().url().nullable(),
    installSmoke: z
      .object({
        linux: releaseCheckStatusSchema,
        macos: releaseCheckStatusSchema,
        windows: releaseCheckStatusSchema,
      })
      .strict(),
    security: z
      .object({
        codeql: releaseCheckStatusSchema,
        gitleaks: releaseCheckStatusSchema,
        dependencyAudit: releaseCheckStatusSchema,
      })
      .strict(),
    manualApproval: z.enum(["pending", "approved"]),
    publication: z.literal("not-performed"),
  })
  .strict()
  .superRefine((evidence, context) => {
    const names = new Set<string>();
    for (const pkg of evidence.packages) {
      if (pkg.version !== evidence.version) {
        context.addIssue({
          code: "custom",
          path: ["packages"],
          message: `${pkg.name} version does not match release version`,
        });
      }
      if (names.has(pkg.name)) {
        context.addIssue({
          code: "custom",
          path: ["packages"],
          message: `duplicate package evidence: ${pkg.name}`,
        });
      }
      names.add(pkg.name);
    }
  });

export type ReleaseEvidence = z.infer<typeof releaseEvidenceSchema>;
