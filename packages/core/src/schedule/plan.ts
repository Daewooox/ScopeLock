import { z } from "zod";

export const SCHEDULE_PLAN_SCHEMA_VERSION = 1;

export const commandSpecSchema = z.union([
  z.string().min(1),
  z.array(z.string()).min(1).refine((command) => command[0]?.length > 0, {
    message: "command executable must not be empty",
  }),
]);

export const schedulePlanTaskSchema = z.object({
  id: z.string().min(1),
  contract: z.string().min(1),
  command: commandSpecSchema.optional(),
  expectsChanges: z.boolean().optional(),
});

export const planWorkingDirectorySchema = z.string().min(1).superRefine((cwd, ctx) => {
  const valid = cwd === "." || (
    !cwd.startsWith("/")
    && !cwd.includes("\\")
    && !cwd.includes(":")
    && !cwd.includes("\0")
    && cwd.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
  if (!valid) {
    ctx.addIssue({
      code: "custom",
      message: "validation cwd must be a portable repository-relative directory",
    });
  }
});

export const planValidationCheckSchema = z.object({
  id: z.string().max(64).regex(/^[a-z0-9][a-z0-9._-]*$/),
  command: z.array(z.string().min(1)).min(1),
  cwd: planWorkingDirectorySchema.optional(),
  required: z.boolean().default(true),
});

export const planValidationSchema = z
  .object({
    cwd: planWorkingDirectorySchema.optional(),
    setup: z.array(z.string().min(1)).min(1).optional(),
    command: z.array(z.string().min(1)).min(1).optional(),
    checks: z.array(planValidationCheckSchema).min(1).max(16).optional(),
    acceptance: z.object({
      checkIds: z.array(z.string()).optional(),
    }).optional(),
  })
  .superRefine((validation, ctx) => {
    if (validation.command && validation.checks) {
      ctx.addIssue({
        code: "custom",
        message: "validation must declare either command or checks, not both",
      });
    }
    if (!validation.command && !validation.checks) {
      ctx.addIssue({
        code: "custom",
        message: "validation must declare either command or checks",
      });
    }

    if (validation.checks) {
      const seen = new Set<string>();
      validation.checks.forEach((check, index) => {
        if (seen.has(check.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["checks", index, "id"],
            message: `duplicate check id: ${check.id}`,
          });
        }
        seen.add(check.id);
      });

      const acceptanceCheckIds = validation.acceptance?.checkIds;
      if (acceptanceCheckIds) {
        const seenAcceptance = new Set<string>();
        const requiredIds = new Set(
          validation.checks.filter((check) => check.required).map((check) => check.id),
        );
        acceptanceCheckIds.forEach((id, index) => {
          if (seenAcceptance.has(id)) {
            ctx.addIssue({
              code: "custom",
              path: ["acceptance", "checkIds", index],
              message: `duplicate acceptance check id: ${id}`,
            });
          }
          seenAcceptance.add(id);
          if (!requiredIds.has(id)) {
            ctx.addIssue({
              code: "custom",
              path: ["acceptance", "checkIds", index],
              message: `acceptance check id must reference a required check: ${id}`,
            });
          }
        });
      }
    } else if (validation.acceptance?.checkIds && validation.acceptance.checkIds.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["acceptance", "checkIds"],
        message: "acceptance check ids require checks to be declared",
      });
    }
  });

export const schedulePlanSchema = z
  .object({
    schemaVersion: z.literal(SCHEDULE_PLAN_SCHEMA_VERSION),
    planId: z.string().min(1),
    execution: z.object({
      isolation: z.enum(["optional", "required"]).default("optional"),
      validation: planValidationSchema.optional(),
    }).optional(),
    tasks: z.array(schedulePlanTaskSchema).min(1),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.tasks.forEach((task, index) => {
      if (seen.has(task.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["tasks", index, "id"],
          message: `duplicate task id: ${task.id}`,
        });
      }
      seen.add(task.id);
    });
  });

export type SchedulePlanTask = z.infer<typeof schedulePlanTaskSchema>;
export type SchedulePlan = z.infer<typeof schedulePlanSchema>;
export type CommandSpec = z.infer<typeof commandSpecSchema>;
export type PlanValidation = z.infer<typeof planValidationSchema>;
export type PlanValidationCheck = z.infer<typeof planValidationCheckSchema>;

export type NormalizedPlanValidation = {
  setup?: string[];
  checks: Array<{
    id: string;
    command: string[];
    cwd?: string;
    required: boolean;
  }>;
  acceptanceCheckIds: string[];
};

export function normalizePlanValidation(
  validation: PlanValidation,
): NormalizedPlanValidation {
  if (validation.checks) {
    return {
      setup: validation.setup,
      checks: validation.checks.map((check) => ({
        id: check.id,
        command: check.command,
        cwd: check.cwd ?? validation.cwd,
        required: check.required,
      })),
      acceptanceCheckIds: validation.acceptance?.checkIds ?? [],
    };
  }

  return {
    setup: validation.setup,
    checks: [
      {
        id: "repository-validation",
        command: validation.command as string[],
        cwd: validation.cwd,
        required: true,
      },
    ],
    acceptanceCheckIds: [],
  };
}
