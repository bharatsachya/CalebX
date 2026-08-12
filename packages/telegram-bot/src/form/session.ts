/**
 * Which field a user is currently editing via `/update`.
 *
 * In-memory and per-process on purpose. It is the only piece of state the form
 * doesn't derive from the sheet, it is worthless a minute after it's set, and
 * persisting it would mean a bookkeeping column in a spreadsheet you read by
 * hand. If the bot restarts mid-edit the user simply taps `/update` again.
 */

const editing = new Map<string, string>();

export function beginEdit(userId: string, fieldId: string): void {
  editing.set(userId, fieldId);
}

export function currentEdit(userId: string): string | null {
  return editing.get(userId) ?? null;
}

export function endEdit(userId: string): void {
  editing.delete(userId);
}
