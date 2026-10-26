/**
 * Capacity & Quota Tracker
 * Starq Command Architecture Doctrine Section 15 & Requirement 5G
 */

import { type CapacityRecord } from '../schemas/quota-capacity.ts';
import { CANONICAL_STARQ_FLEET, type SeatRuntimeStatus } from '../schemas/seat-registry.ts';

/**
 * A clock reading, and nothing more.
 *
 * Named so that every timestamp in this file is visibly a record of when THIS
 * PROCESS did something, never evidence about a seat. The distinction is the
 * whole reason `lastHeartbeat` is absent from constructed rows: a timestamp
 * from this file describes the tracker, not the fleet.
 */
function now(): string {
  return new Date().toISOString();
}

export class QuotaTracker {
  private capacities: Map<string, CapacityRecord> = new Map();
  private seatStatuses: Map<string, SeatRuntimeStatus> = new Map();

  constructor() {
    this.initFleet();
  }

  /**
   * Seed the fleet.
   *
   * THE RULE: this method has observed nothing. It reads a static roster file
   * and constructs rows. It has not polled a seat, read a PID, opened a
   * socket, or received a heartbeat. Therefore every runtime field it writes
   * must be UNKNOWN, and no clock reading may be dressed up as an observation.
   *
   * This function previously wrote, for all ten seats:
   *
   *     runtimeState: 'IDLE' | 'OFFLINE',   // a claim about a running process
   *     health: 'HEALTHY',                  // a claim about a healthy process
   *     lastHeartbeat: now,                 // a heartbeat that never happened
   *
   * and nothing in the package ever called `updateSeatStatus` or
   * `updateTelemetry`, so those values were permanent for the lifetime of the
   * process. `GET /api/command/fleet` therefore returned ten confident green
   * seats for a floor that could be entirely dead — the exact false-green this
   * floor is not allowed to show.
   *
   * `UNLAUNCHABLE` deserves a note, because it looks like the one trustworthy
   * case. `launchPolicy` is a DECLARED fact, and it is still reported, verbatim
   * and untouched, via the `...seat` spread. But it is a statement about how a
   * seat is meant to be launched, not an observation that it is not running, so
   * it does not license inferring `runtimeState: 'OFFLINE'`. Declaration and
   * observation are kept apart: the declared policy travels in its own field
   * where a reader can see exactly what it is.
   */
  private initFleet(): void {
    for (const seat of CANONICAL_STARQ_FLEET) {
      // Default initial telemetry: UNKNOWN (never invent fake values)
      const cap: CapacityRecord = {
        seat: seat.seatId,
        provider: seat.defaultProvider,
        model: seat.defaultModel,
        telemetrySource: 'UNKNOWN',
        quotaStatus: 'UNKNOWN',
        lastUpdated: now(),
        recommendations: [],
      };
      this.capacities.set(seat.seatId, cap);

      const status: SeatRuntimeStatus = {
        ...seat,
        // Nothing has been observed, so nothing is asserted.
        runtimeState: 'UNKNOWN',
        health: 'UNKNOWN',
        quotaStatus: 'UNKNOWN',
        // `lastHeartbeat` is deliberately ABSENT rather than set to a clock
        // reading. See `SeatRuntimeStatus.lastHeartbeat`.
        observed: false,
      };
      this.seatStatuses.set(seat.seatId, status);
    }
  }

  /**
   * Update capacity record with real telemetry when available
   */
  public updateTelemetry(
    seatId: string,
    update: Partial<CapacityRecord>
  ): CapacityRecord | null {
    const existing = this.capacities.get(seatId);
    if (!existing) return null;

    const updated: CapacityRecord = {
      ...existing,
      ...update,
      lastUpdated: now(),
    };

    // Update recommendations based on quota status
    if (updated.quotaStatus === 'EXHAUSTED') {
      updated.recommendations = [
        `Seat '${seatId}' quota exhausted. Recommend routing to alternative seat or awaiting reset window.`,
      ];
    } else if (updated.quotaStatus === 'APPROACHING_LIMIT') {
      updated.recommendations = [
        `Seat '${seatId}' approaching usage limit. Consider conserving capacity for high-priority tasks.`,
      ];
    } else {
      updated.recommendations = [];
    }

    this.capacities.set(seatId, updated);

    // Sync to seat runtime status
    const seatStatus = this.seatStatuses.get(seatId);
    if (seatStatus) {
      seatStatus.quotaStatus = updated.quotaStatus;
      this.seatStatuses.set(seatId, seatStatus);
    }

    return updated;
  }

  /**
   * Record an OBSERVED status for a seat.
   *
   * Unlike construction, this is a real observation: a caller has just looked at
   * the seat and is telling us what it saw. So it is allowed to carry a
   * heartbeat, and it flips `observed` to true so a consumer can tell this row
   * apart from one that was merely constructed.
   *
   * The flip is the point. `observed` is not a label, it is the record of
   * whether `health` means anything yet — and it is what stops a future caller
   * from passing `health: 'HEALTHY'` here without that claim having been earned
   * by an actual read. If a caller reaches this method, it had to have looked.
   */
  public updateSeatStatus(
    seatId: string,
    update: Partial<SeatRuntimeStatus>
  ): SeatRuntimeStatus | null {
    const existing = this.seatStatuses.get(seatId);
    if (!existing) return null;

    const merged: SeatRuntimeStatus = {
      ...existing,
      ...update,
      // An explicit status update is an observation by definition, so the row
      // is now observed unless the caller explicitly says otherwise.
      observed: update.observed ?? true,
      lastHeartbeat: update.lastHeartbeat ?? now(),
    };
    this.seatStatuses.set(seatId, merged);
    return merged;
  }

  public getCapacity(seatId: string): CapacityRecord | null {
    return this.capacities.get(seatId) || null;
  }

  public getSeatStatus(seatId: string): SeatRuntimeStatus | null {
    return this.seatStatuses.get(seatId) || null;
  }

  public getFullFleetStatus(): SeatRuntimeStatus[] {
    return Array.from(this.seatStatuses.values());
  }

  public getFullCapacityOverview(): CapacityRecord[] {
    return Array.from(this.capacities.values());
  }
}
