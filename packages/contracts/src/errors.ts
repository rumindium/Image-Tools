/**
 * The 28 error codes of docs/0-API.md §7.
 * One code maps to exactly one HTTP status; a code that could be two statuses is two codes.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNSUPPORTED_FILE_TYPE',
  'FILE_TOO_LARGE',
  'IMAGE_TOO_LARGE',
  'CORRUPT_IMAGE',
  'DECODE_FAILED',
  'ENCODE_UNSUPPORTED',
  'ENCODING_FAILED',
  'ANIMATED_NOT_SUPPORTED',
  'SVG_RASTERIZED',
  'FILE_LIMIT_EXCEEDED',
  'JOB_SIZE_EXCEEDED',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'MEMORY_LIMIT_EXCEEDED',
  'MODEL_LOAD_FAILED',
  'MODEL_UNLICENSED',
  'INFERENCE_FAILED',
  'GPU_UNAVAILABLE',
  'SERVER_LANE_DISABLED',
  'SERVER_LANE_CONSENT_REQUIRED',
  'QUEUE_UNAVAILABLE',
  'JOB_NOT_FOUND',
  'JOB_EXPIRED',
  'EXPORT_FAILED',
  'CANCELLED',
  'INTERNAL_ERROR',
  'UNAUTHORIZED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 422,
  UNSUPPORTED_FILE_TYPE: 415,
  FILE_TOO_LARGE: 413,
  IMAGE_TOO_LARGE: 422,
  CORRUPT_IMAGE: 422,
  DECODE_FAILED: 415,
  ENCODE_UNSUPPORTED: 422,
  ENCODING_FAILED: 500,
  ANIMATED_NOT_SUPPORTED: 422,
  SVG_RASTERIZED: 422,
  FILE_LIMIT_EXCEEDED: 422,
  JOB_SIZE_EXCEEDED: 422,
  QUOTA_EXCEEDED: 429,
  RATE_LIMITED: 429,
  MEMORY_LIMIT_EXCEEDED: 507,
  MODEL_LOAD_FAILED: 503,
  MODEL_UNLICENSED: 500,
  INFERENCE_FAILED: 500,
  GPU_UNAVAILABLE: 503,
  SERVER_LANE_DISABLED: 503,
  SERVER_LANE_CONSENT_REQUIRED: 422,
  QUEUE_UNAVAILABLE: 503,
  JOB_NOT_FOUND: 404,
  JOB_EXPIRED: 410,
  EXPORT_FAILED: 500,
  CANCELLED: 499,
  INTERNAL_ERROR: 500,
  UNAUTHORIZED: 401,
};

export type ApiIssue = { path: string; message: string };

export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    hint?: string;
    requestId: string;
    details?: ApiIssue[];
  };
};

/** A failure with a code the contract already defines. Anything else is INTERNAL_ERROR. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly hint?: string;
  readonly details?: ApiIssue[];

  constructor(
    code: ErrorCode,
    message: string,
    options: { hint?: string; details?: ApiIssue[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    if (options.hint !== undefined) this.hint = options.hint;
    if (options.details !== undefined) this.details = options.details;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Maps any thrown value to the wire shape. Unknown errors become INTERNAL_ERROR with a
 * user-safe sentence: the stack stays in the log, joined by requestId
 * (docs/0-SECURITY.md §10).
 */
export function toApiErrorBody(error: unknown, requestId: string): ApiErrorBody {
  if (isAppError(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        ...(error.hint === undefined ? {} : { hint: error.hint }),
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong.',
      hint: `Reference: ${requestId}`,
      requestId,
    },
  };
}
