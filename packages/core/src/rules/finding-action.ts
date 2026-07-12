import { z } from "zod";

export type FindingAction = "auto-fix" | "ask-user" | "no-op";

export function resolveFindingAction(raw: unknown): FindingAction {
  if (raw === "auto-fix" || raw === "ask-user" || raw === "no-op") {
    return raw;
  }
  return "ask-user";
}

export const findingActionSchema = z
  .enum(["auto-fix", "ask-user", "no-op"])
  .catch("ask-user");
