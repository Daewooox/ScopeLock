import { z } from "zod";

export const decisionSchema = z.object({
  status: z.enum(["denied", "blocked"]),
  code: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/),
  reason: z.string().min(1),
  fix: z.string().min(1),
});

export type Decision = z.infer<typeof decisionSchema>;
