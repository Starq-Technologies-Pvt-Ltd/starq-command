/**
 * Room Typed Lifecycle Event Schema
 * Starq Command Architecture Doctrine Section 18
 */

export type RoomEventType =
  | 'TASK_CREATED'
  | 'TASK_ASSIGNED'
  | 'TASK_STARTED'
  | 'TASK_BLOCKED'
  | 'BUILDER_COMPLETE'
  | 'VERIFICATION_STARTED'
  | 'VERIFICATION_REJECTED'
  | 'VERIFICATION_ACCEPTED'
  | 'FOUNDER_RULING'
  | 'SECURITY_ALERT'
  | 'QUOTA_ALERT'
  | 'SESSION_STUCK';

export interface RoomEventEnvelope {
  seq?: number;
  type: RoomEventType;
  taskId?: string;
  sender: string;
  timestamp: string; // ISO 8601
  summary: string;
  payload: Record<string, unknown>;
  room_ref?: { sequence: number; status: 'POSTED' } | { status: 'UNCONFIRMED'; reason: string };
}

export function formatRoomEventText(envelope: RoomEventEnvelope): string {
  const parts = [
    `[${envelope.type}]`,
    envelope.taskId ? `(Task: ${envelope.taskId})` : '',
    envelope.summary,
  ].filter(Boolean);
  return parts.join(' ');
}
