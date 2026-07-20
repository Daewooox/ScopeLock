export type TaskStatus = "passed" | "failed" | "blocked" | "skipped";
export type CheckStatus = "passed" | "failed" | "skipped";

export type ProgressEvent =
  | { type: "wave-start"; wave: number; totalWaves: number; taskIds: string[] }
  | { type: "task-start"; id: string }
  | {
      type: "task-done";
      id: string;
      status: TaskStatus;
      durationMs: number;
      reason?: string;
      logPath?: string;
      wave?: number;
      updated?: boolean;
    }
  | { type: "check-start"; id: string; required: boolean }
  | {
      type: "check-done";
      id: string;
      status: CheckStatus;
      durationMs: number;
      skipReason?: string;
      reason?: string;
      logPath?: string;
      updated?: boolean;
    }
  | { type: "phase"; name: "validating" | "promoting" | "cleaning-up" }
  | { type: "step"; index: number; total: number; label: string }
  | { type: "interrupted" };

export type ProgressReporter = {
  emit(event: ProgressEvent): void;
  dispose(): void;
};
