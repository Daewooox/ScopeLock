import { ZodError } from "zod";

/**
 * Turn a ZodError into a single compact, path-oriented line instead of the
 * default multi-line JSON blob. Returns null for anything that is not a
 * ZodError, so callers can fall back to generic error handling.
 *
 * Example: `scope.plannedPathPatterns.0: String must contain at least 1 character`
 */
export function formatZodError(error: unknown): string | null {
  if (!(error instanceof ZodError)) return null;
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
