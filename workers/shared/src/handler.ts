/**
 * The server-lane handler contract (docs/0-FOLDER-STRUCTURE.md §4). Deliberately tiny and shaped
 * like the browser's Transform, so a tool's semantics do not change with the lane.
 */
export type JobInput = { path: string; width: number; height: number; bytes: number };

export type JobLogger = {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
};

export type JobContext = {
  jobId: string;
  toolId: string;
  options: unknown;
  input: (index: number) => Promise<JobInput>;
  output: (name: string, data: Buffer | string) => Promise<void>;
  report: (stage: string, pct: number) => void;
  signal: AbortSignal;
  log: JobLogger;
};

export type JobResult = {
  metrics: Record<string, number>;
  warnings: string[];
};

export type JobHandler = (context: JobContext) => Promise<JobResult>;
