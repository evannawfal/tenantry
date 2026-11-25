type PgError = { code?: string; message?: string; details?: string | null; hint?: string | null } | null;

// Turns database errors raised by our triggers and policies into sentences.
export function describeError(error: PgError, fallback = "Something went wrong. Try again."): string {
  if (!error) return fallback;
  const message = error.message ?? "";
  if (message.includes("plan_limit_reached")) {
    const what = error.details === "members" ? "seat" : "project";
    return `${error.hint ?? `You've reached your plan's ${what} limit.`} Upgrade on the Billing page to add more.`;
  }
  if (message.includes("last_admin")) return "An organization needs at least one admin. Make someone else an admin first.";
  if (message.includes("invitation_email_mismatch")) return error.hint ?? "This invitation was sent to a different email address.";
  if (message.includes("invitation_invalid")) return "This invitation link is invalid, already used, or expired.";
  if (error.code === "23505") {
    if (message.includes("invitations_one_open_per_email")) return "There's already an open invitation for that email.";
    if (message.includes("organizations_slug_key")) return "That URL is taken. Pick another.";
    return "That already exists.";
  }
  if (error.code === "42501") return "You don't have permission to do that.";
  if (error.code === "23514") return "Check the form: one of the values isn't allowed.";
  return fallback;
}
