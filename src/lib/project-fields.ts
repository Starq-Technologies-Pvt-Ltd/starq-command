/**
 * Client-side checks that match `createProject` in server/pm-service.mjs.
 * The server remains the authority; these exist so a first-run form can
 * explain a rejection before the round trip.
 */
export interface ProjectFieldInput {
  id: string;
  name: string;
  prefix: string;
  description?: string;
}

export function validateProjectFields(input: ProjectFieldInput): string[] {
  const errors: string[] = [];
  const id = input.id.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) {
    errors.push('Project id must be 2-40 characters: a lowercase letter, then lowercase letters, digits, or hyphens.');
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) errors.push('Project name must be 2-80 characters.');
  const prefix = input.prefix.trim().toUpperCase();
  if (!/^[A-Z]{2,4}$/.test(prefix)) errors.push('Project prefix must be 2-4 letters.');
  if ((input.description ?? '').trim().length > 400) errors.push('Project description must be at most 400 characters.');
  return errors;
}

export function validatePersonHandle(handle: string): string | null {
  const value = handle.trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,38}$/i.test(value)) {
    return 'Handle must be 2-40 letters, digits, dots, underscores, or hyphens.';
  }
  return null;
}
