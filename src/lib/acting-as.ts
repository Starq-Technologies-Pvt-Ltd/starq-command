/**
 * Claimed actor for ordinary local actions. This is attribution, not authentication.
 * An empty store defaults to the Founder's handle so the control is explicit and visible.
 */
export const CLAIMED_ACTOR_KEY = 'starq.pm.actor';
export const FOUNDER_HANDLE = 'mustarq';

export function readClaimedActor(): string {
  try {
    const stored = window.localStorage.getItem(CLAIMED_ACTOR_KEY)?.trim();
    if (stored) return stored;
  } catch {
    /* storage unavailable */
  }
  return FOUNDER_HANDLE;
}

export function storeClaimedActor(value: string) {
  try {
    window.localStorage.setItem(CLAIMED_ACTOR_KEY, value.trim());
  } catch {
    /* convenience only */
  }
}
