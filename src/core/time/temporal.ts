/**
 * Temporal Model for ContextGraph OS
 *
 * Implements T0.1.5: Define time model (event time vs wall time)
 * Implements T1.3.1: Validity windows on nodes
 * Implements T1.3.2: Support point-in-time queries
 *
 * ContextGraph distinguishes between:
 * - Event Time: When something actually happened in the real world
 * - Processing Time: When the system recorded/processed the event
 * - Valid Time: When the data is considered valid for queries
 */

/**
 * Timestamp in ISO 8601 format with timezone
 * Using string for serialization compatibility and precision
 */
export type Timestamp = string;

/**
 * Time types in the system
 */
export const TimeType = {
  /** When the event actually occurred */
  EVENT: 'EVENT',
  /** When the system processed/recorded the event */
  PROCESSING: 'PROCESSING',
  /** When the data is considered valid */
  VALID: 'VALID',
} as const;

export type TimeTypeValue = (typeof TimeType)[keyof typeof TimeType];

/**
 * A temporal point with both event and processing time
 */
export interface TemporalPoint {
  /** When the event occurred in the real world */
  readonly eventTime: Timestamp;
  /** When the system recorded this event */
  readonly processingTime: Timestamp;
}

/**
 * A time range for queries
 */
export interface TimeRange {
  /** Start of the range (inclusive) */
  readonly from: Timestamp;
  /** End of the range (exclusive) */
  readonly to: Timestamp;
}

/**
 * Get the current timestamp in ISO 8601 format
 */
export function now(): Timestamp {
  return new Date().toISOString();
}

/**
 * Create a timestamp from a Date object
 */
export function fromDate(date: Date): Timestamp {
  return date.toISOString();
}

/**
 * Parse a timestamp string to a Date object
 */
export function toDate(timestamp: Timestamp): Date {
  return new Date(timestamp);
}

/**
 * Check if a timestamp is valid ISO 8601 format
 */
export function isValidTimestamp(timestamp: string): timestamp is Timestamp {
  const date = new Date(timestamp);
  return !isNaN(date.getTime()) && date.toISOString() === timestamp;
}

/**
 * Compare two timestamps
 * Returns negative if a < b, zero if equal, positive if a > b
 */
export function compareTimestamps(a: Timestamp, b: Timestamp): number {
  return toDate(a).getTime() - toDate(b).getTime();
}

/**
 * Check if timestamp a is before timestamp b
 */
export function isBefore(a: Timestamp, b: Timestamp): boolean {
  return compareTimestamps(a, b) < 0;
}

/**
 * Check if timestamp a is after timestamp b
 */
export function isAfter(a: Timestamp, b: Timestamp): boolean {
  return compareTimestamps(a, b) > 0;
}

/**
 * Check if a timestamp is within a time range
 */
export function isWithinRange(timestamp: Timestamp, range: TimeRange): boolean {
  return !isBefore(timestamp, range.from) && isBefore(timestamp, range.to);
}

/**
 * Check if a timestamp falls within a validity window
 */
export function isValidAt(
  timestamp: Timestamp,
  validFrom: Timestamp,
  validUntil?: Timestamp
): boolean {
  if (isBefore(timestamp, validFrom)) {
    return false;
  }

  if (validUntil !== undefined && !isBefore(timestamp, validUntil)) {
    return false;
  }

  return true;
}

/**
 * Add duration to a timestamp
 */
export function addDuration(
  timestamp: Timestamp,
  duration: {
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
    milliseconds?: number;
  }
): Timestamp {
  const date = toDate(timestamp);

  if (duration.days !== undefined) {
    date.setDate(date.getDate() + duration.days);
  }
  if (duration.hours !== undefined) {
    date.setHours(date.getHours() + duration.hours);
  }
  if (duration.minutes !== undefined) {
    date.setMinutes(date.getMinutes() + duration.minutes);
  }
  if (duration.seconds !== undefined) {
    date.setSeconds(date.getSeconds() + duration.seconds);
  }
  if (duration.milliseconds !== undefined) {
    date.setMilliseconds(date.getMilliseconds() + duration.milliseconds);
  }

  return fromDate(date);
}

/**
 * Get the difference between two timestamps in milliseconds
 */
export function differenceInMs(a: Timestamp, b: Timestamp): number {
  return toDate(a).getTime() - toDate(b).getTime();
}

/**
 * Create a time range from now extending into the past
 */
export function pastRange(duration: {
  days?: number;
  hours?: number;
  minutes?: number;
}): TimeRange {
  const to = now();
  const from = addDuration(to, {
    days: duration.days ? -duration.days : undefined,
    hours: duration.hours ? -duration.hours : undefined,
    minutes: duration.minutes ? -duration.minutes : undefined,
  });

  return { from, to };
}

/**
 * Create a point-in-time query context
 * Implements T1.3.2: Support point-in-time queries
 */
export interface PointInTimeContext {
  /** The timestamp to query at */
  readonly asOf: Timestamp;
  /** Whether to use event time or processing time */
  readonly timeType: TimeTypeValue;
}

/**
 * Create a point-in-time context for querying historical state
 */
export function asOfTime(timestamp: Timestamp, timeType: TimeTypeValue = 'EVENT'): PointInTimeContext {
  return { asOf: timestamp, timeType };
}
