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
});

export const schedulePlanSchema = z
  .object({
    schemaVersion: z.literal(SCHEDULE_PLAN_SCHEMA_VERSION),
    planId: z.string().min(1),
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
