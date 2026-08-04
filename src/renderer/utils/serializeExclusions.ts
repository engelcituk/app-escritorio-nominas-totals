import type { ExclusionOptions } from '../../shared/types/payroll';

/** Converts Vue reactive state into an IPC-safe plain object. */
export function serializeExclusions(options: ExclusionOptions): ExclusionOptions {
  return {
    retained: Boolean(options.retained),
    cancelled: Boolean(options.cancelled),
    other: Boolean(options.other),
    includeAudit: Boolean(options.includeAudit),
  };
}
