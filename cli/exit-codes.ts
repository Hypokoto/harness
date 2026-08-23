/**
 * Structured CLI exit codes.
 * Every command handler must use these constants.
 */
export const ExitCode = {
  SUCCESS: 0,
  GENERIC_ERROR: 1,
  CONFIG_ERROR: 2,
  VALIDATION_ERROR: 3,
  PERMISSION_DENIED: 4,
  PROVIDER_UNAVAILABLE: 5,
  INTEGRITY_FAILURE: 6,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
