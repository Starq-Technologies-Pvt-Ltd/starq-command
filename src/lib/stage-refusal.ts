/** Plain-language fix for a server refusal. Unknown codes stay as the server text. */
export const STAGE_REFUSAL_FIX: Record<string, string> = {
  NOTE_REQUIRED: 'Add a note explaining this move, then try again.',
  DEPENDENCY_OPEN: 'Close the blocking tasks before moving this one.',
  UNMET_DEPENDENCY: 'Close the blocking tasks before moving this one.',
  OWNER_REQUIRED: 'Assign an owner first.',
  VERIFIER_REQUIRED: 'Assign a verifier first.',
  VERIFIER_ATTESTATION_REQUIRED: 'Verifier acceptance needs an authenticated Room record. A claimed name is not enough.',
  FOUNDER_CLOSURE_REQUIRED: 'Founder closure needs an authenticated Room record. Choosing a name does not close the task.',
  STALE_EDIT: 'This record changed after you opened it. Your unsaved edits are still here.',
  STALE_WRITE: 'This record changed after you opened it. Your unsaved edits are still here.',
};

export function refusalFix(code: string): string | null {
  return STAGE_REFUSAL_FIX[code] ?? null;
}
