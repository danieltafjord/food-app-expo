/**
 * Holds an invitation token across the sign-in detour: a signed-out user who
 * opens an invite link is sent to sign-in, and we resume to the accept screen
 * once they're authenticated. In-memory is enough — the app isn't restarted
 * between the deep link and signing in.
 */
let pendingToken: string | null = null;

export function setPendingInvite(token: string): void {
  pendingToken = token;
}

/** Returns the pending token (if any) and clears it. */
export function takePendingInvite(): string | null {
  const token = pendingToken;
  pendingToken = null;
  return token;
}
