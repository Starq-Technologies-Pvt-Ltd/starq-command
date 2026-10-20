import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a maturity ratio. The value arrives already computed from canonical
 * source; this only renders it. It never derives, averages or rounds a new
 * number into existence.
 */
export function formatMaturity(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'UNKNOWN';
  return `${(value * 100).toFixed(2)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'UNKNOWN';
  return value.toLocaleString('en-US');
}

/** Compact relative age, e.g. "8.5h", "3d". */
export function formatAge(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return 'UNKNOWN';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'UNKNOWN';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'UNKNOWN';
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

/** A short, honest label for a value the source itself calls UNKNOWN. */
export function isUnknown(v: unknown): boolean {
  return v === null || v === undefined || v === '' || v === 'UNKNOWN';
}

/** Byte counts, in the units an operator actually reads. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return 'UNKNOWN';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Process uptime, in the largest sensible unit.
 *
 * Renders only. It never estimates a start time, because a rounded uptime that
 * reads like a timestamp invites someone to treat it as one.
 */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'UNKNOWN';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
