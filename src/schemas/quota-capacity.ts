/**
 * Quota & Capacity Schema
 * Starq Command Architecture Doctrine Section 15
 */

export type QuotaTelemetrySource = 'API' | 'LOCAL_ESTIMATE' | 'UNKNOWN';

export interface QuotaWindow {
  tokensUsed?: number;
  tokensLimit?: number;
  requestsUsed?: number;
  requestsLimit?: number;
  resetAt?: string; // ISO 8601
  windowDurationMinutes?: number;
}

export interface CapacityRecord {
  seat: string;
  provider: string;
  model: string;
  telemetrySource: QuotaTelemetrySource;
  quotaStatus: 'NORMAL' | 'APPROACHING_LIMIT' | 'EXHAUSTED' | 'UNKNOWN';
  hourlyWindow?: QuotaWindow;
  dailyWindow?: QuotaWindow;
  lastUpdated: string;
  recommendations: string[];
}
