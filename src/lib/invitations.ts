import { createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

export function newInviteToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

// Must match encode(sha256(convert_to(token, 'UTF8')), 'hex') in accept_invitation.
export function hashInviteToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const inviteUrl = (token: string) => `${env.appUrl}/invite/${token}`;

export type EmailResult = "sent" | "not_configured" | "failed";

// Sends through Resend when RESEND_API_KEY is set. Without it the admin
// copies the link from the Members page, which is also how local dev works.
export async function sendInviteEmail(opts: {
  to: string;
  orgName: string;
  invitedBy: string;
  url: string;
}): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return "not_configured";

  const text = [
    `${opts.invitedBy} invited you to join ${opts.orgName} on Tenantry.`,
    "",
    `Accept the invitation: ${opts.url}`,
    "",
    "The link works once and expires in 7 days.",
  ].join("\n");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: opts.to, subject: `Join ${opts.orgName} on Tenantry`, text }),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
