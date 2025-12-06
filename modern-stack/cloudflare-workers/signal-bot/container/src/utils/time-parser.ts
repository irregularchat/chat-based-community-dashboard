/**
 * Time Parser Utility
 *
 * Parses various time/date formats for scheduled announcements
 */

export interface ParsedTime {
  date: Date;
  relative: boolean;
  originalInput: string;
}

/**
 * Parse a time specification string into a Date object
 *
 * Supported formats:
 * - Relative: 30m, 2h, 24h, 1d, 1w, 2h30m
 * - ISO 8601: 2025-12-25T10:35:00
 * - US Format: 12/25/2025:10:35, 12/25/2025 10:35am, 12/25 10:35
 * - Time only (today): 10:35, 10:35am, 14:30
 *
 * @param spec - Time specification string
 * @param timezone - Timezone (default: America/New_York)
 * @returns ParsedTime object or null if invalid
 */
export function parseTimeSpec(spec: string, timezone: string = 'America/New_York'): ParsedTime | null {
  if (!spec || spec.trim().length === 0) {
    return null;
  }

  const input = spec.trim();

  // Try relative time first (most common)
  const relativeResult = parseRelativeTime(input);
  if (relativeResult) {
    return {
      date: relativeResult,
      relative: true,
      originalInput: input,
    };
  }

  // Try absolute time formats
  const absoluteResult = parseAbsoluteTime(input, timezone);
  if (absoluteResult) {
    return {
      date: absoluteResult,
      relative: false,
      originalInput: input,
    };
  }

  return null;
}

/**
 * Parse relative time strings like "30m", "2h", "1d", "2h30m"
 */
function parseRelativeTime(spec: string): Date | null {
  const now = new Date();

  // Match patterns like "30m", "2h", "1d", "1w", "2h30m", "1d12h"
  const relativePattern = /^(\d+)(m|min|h|hr|hours?|d|days?|w|weeks?)(\d+)?(m|min|h|hr)?$/i;
  const match = spec.match(relativePattern);

  if (!match) {
    // Try simple numeric patterns
    const simplePattern = /^(\d+)(m|h|d|w)$/i;
    const simpleMatch = spec.match(simplePattern);

    if (simpleMatch) {
      const value = parseInt(simpleMatch[1], 10);
      const unit = simpleMatch[2].toLowerCase();

      return addTimeUnit(now, value, unit);
    }
    return null;
  }

  const value1 = parseInt(match[1], 10);
  const unit1 = normalizeUnit(match[2]);
  let result = addTimeUnit(now, value1, unit1);

  if (!result) return null;

  // Handle compound time like "2h30m"
  if (match[3] && match[4]) {
    const value2 = parseInt(match[3], 10);
    const unit2 = normalizeUnit(match[4]);
    result = addTimeUnit(result, value2, unit2);
  }

  return result;
}

/**
 * Normalize time unit to single character
 */
function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase();
  if (u.startsWith('min') || u === 'm') return 'm';
  if (u.startsWith('h')) return 'h';
  if (u.startsWith('d')) return 'd';
  if (u.startsWith('w')) return 'w';
  return u;
}

/**
 * Add time unit to a date
 */
function addTimeUnit(date: Date, value: number, unit: string): Date | null {
  const result = new Date(date);

  switch (unit) {
    case 'm':
      result.setMinutes(result.getMinutes() + value);
      break;
    case 'h':
      result.setHours(result.getHours() + value);
      break;
    case 'd':
      result.setDate(result.getDate() + value);
      break;
    case 'w':
      result.setDate(result.getDate() + (value * 7));
      break;
    default:
      return null;
  }

  return result;
}

/**
 * Parse absolute time formats
 */
function parseAbsoluteTime(spec: string, timezone: string): Date | null {
  // Try ISO 8601 first
  const isoDate = Date.parse(spec);
  if (!isNaN(isoDate)) {
    const date = new Date(isoDate);
    if (date > new Date()) {
      return date;
    }
  }

  // US Format: MM/DD/YYYY:HH:MM or MM/DD/YYYY HH:MMam/pm or MM/DD HH:MM
  const usPatterns = [
    // 12/25/2025:10:35 or 12/25/2025:10:35am
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}):(\d{1,2}):(\d{2})(am|pm)?$/i,
    // 12/25/2025 10:35 or 12/25/2025 10:35am
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(am|pm)?$/i,
    // 12/25 10:35 (current year)
    /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(am|pm)?$/i,
  ];

  for (const pattern of usPatterns) {
    const match = spec.match(pattern);
    if (match) {
      return parseUSFormat(match, timezone);
    }
  }

  // Time only: 10:35 or 10:35am or 14:30 (assumes today or tomorrow if past)
  const timeOnlyPattern = /^(\d{1,2}):(\d{2})(am|pm)?$/i;
  const timeMatch = spec.match(timeOnlyPattern);
  if (timeMatch) {
    return parseTimeOnly(timeMatch, timezone);
  }

  return null;
}

/**
 * Parse US date format matches
 */
function parseUSFormat(match: RegExpMatchArray, timezone: string): Date | null {
  try {
    let month: number, day: number, year: number, hour: number, minute: number;
    let ampm: string | undefined;

    if (match.length >= 7) {
      // Full date with year
      month = parseInt(match[1], 10) - 1;
      day = parseInt(match[2], 10);
      year = parseInt(match[3], 10);
      hour = parseInt(match[4], 10);
      minute = parseInt(match[5], 10);
      ampm = match[6]?.toLowerCase();
    } else if (match.length >= 6) {
      // Date without year (MM/DD HH:MM)
      month = parseInt(match[1], 10) - 1;
      day = parseInt(match[2], 10);
      year = new Date().getFullYear();
      hour = parseInt(match[3], 10);
      minute = parseInt(match[4], 10);
      ampm = match[5]?.toLowerCase();
    } else {
      return null;
    }

    // Convert 12-hour to 24-hour if am/pm specified
    if (ampm === 'pm' && hour < 12) {
      hour += 12;
    } else if (ampm === 'am' && hour === 12) {
      hour = 0;
    }

    const date = new Date(year, month, day, hour, minute, 0);

    // Validate the date is in the future
    if (date <= new Date()) {
      // If date is in the past, try next year
      date.setFullYear(date.getFullYear() + 1);
    }

    return date;
  } catch {
    return null;
  }
}

/**
 * Parse time-only format (assumes today or tomorrow)
 */
function parseTimeOnly(match: RegExpMatchArray, timezone: string): Date | null {
  try {
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const ampm = match[3]?.toLowerCase();

    // Convert 12-hour to 24-hour
    if (ampm === 'pm' && hour < 12) {
      hour += 12;
    } else if (ampm === 'am' && hour === 12) {
      hour = 0;
    }

    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);

    // If time is in the past, schedule for tomorrow
    if (date <= now) {
      date.setDate(date.getDate() + 1);
    }

    return date;
  } catch {
    return null;
  }
}

/**
 * Format a date for display
 */
export function formatScheduledTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  // Format the absolute time
  const timeStr = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Add relative description
  if (diffMins < 60) {
    return `${timeStr} (in ${diffMins} min)`;
  } else if (diffHours < 24) {
    return `${timeStr} (in ${diffHours}h)`;
  } else if (diffDays < 7) {
    return `${timeStr} (in ${diffDays}d)`;
  }

  return timeStr;
}

/**
 * Validate that a date is in the future
 */
export function isFutureDate(date: Date): boolean {
  return date > new Date();
}

/**
 * Get help text for time format
 */
export function getTimeFormatHelp(): string {
  return [
    'Supported time formats:',
    '  Relative: 30m, 2h, 24h, 1d, 1w',
    '  Date/Time: 12/25/2025:10:35, 12/25 2:30pm',
    '  Time only: 10:35am, 14:30 (today/tomorrow)',
    '  ISO: 2025-12-25T10:35:00',
  ].join('\n');
}
