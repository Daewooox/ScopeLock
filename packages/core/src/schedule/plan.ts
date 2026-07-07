import { z } from "zod";

export const SCHEDULE_PLAN_SCHEMA_VERSION = 1;

export const schedulePlanTaskSchema = z.object({
  id: z.string().min(1),
  contract: z.string().min(1),
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
