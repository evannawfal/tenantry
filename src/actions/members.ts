"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/forms";
import { getOrgContext } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { inviteUrl, newInviteToken, sendInviteEmail } from "@/lib/invitations";

const role = z.enum(["admin", "member"]);

async function adminContext(formData: FormData) {
  const ctx = await getOrgContext(String(formData.get("slug")));
  return ctx.role === "admin" ? ctx : null;
}

export async function inviteMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await adminContext(formData);
  if (!ctx) return { error: "Only admins can invite people." };

  const input = z
    .object({ email: z.string().trim().toLowerCase().email("Enter a valid email address"), role })
    .safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!input.success) return { error: input.error.issues[0].message };
  const { email } = input.data;

  const { data: existing } = await ctx.supabase
    .from("memberships")
    .select("user_id, profiles!inner(email)")
    .eq("org_id", ctx.org.id)
    .eq("profiles.email", email)
    .maybeSingle();
  if (existing) return { error: `${email} is already a member.` };

  // Inviting the same address again replaces the old link.
  await ctx.supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("org_id", ctx.org.id)
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null);

  const { token, hash } = newInviteToken();
  const { error } = await ctx.supabase.from("invitations").insert({
    org_id: ctx.org.id,
    email,
    role: input.data.role,
    token_hash: hash,
    invited_by: ctx.user.id,
  });
  if (error) return { error: describeError(error) };

  const url = inviteUrl(token);
  const emailed = await sendInviteEmail({
    to: email,
    orgName: ctx.org.name,
    invitedBy: ctx.user.email ?? "A teammate",
    url,
  });

  revalidatePath(`/o/${ctx.org.slug}/members`);
  return {
    ok:
      emailed === "sent"
        ? `Invitation emailed to ${email}. You can also share this link, which is shown once:`
        : `Invitation created for ${email}. Send them this link, which is shown once:`,
    link: url,
  };
}

export async function revokeInvitation(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await adminContext(formData);
  if (!ctx) return { error: "Only admins can revoke invitations." };
  const { error } = await ctx.supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", String(formData.get("id")))
    .eq("org_id", ctx.org.id);
  if (error) return { error: describeError(error) };
  revalidatePath(`/o/${ctx.org.slug}/members`);
  return { ok: "Invitation revoked." };
}

export async function changeRole(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await adminContext(formData);
  if (!ctx) return { error: "Only admins can change roles." };
  const newRole = role.safeParse(formData.get("role"));
  if (!newRole.success) return { error: "Pick admin or member." };

  const { error } = await ctx.supabase
    .from("memberships")
    .update({ role: newRole.data })
    .eq("org_id", ctx.org.id)
    .eq("user_id", String(formData.get("user_id")));
  if (error) return { error: describeError(error) };
  revalidatePath(`/o/${ctx.org.slug}`, "layout");
  return { ok: "Role updated." };
}

export async function removeMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await adminContext(formData);
  if (!ctx) return { error: "Only admins can remove members." };
  const { data, error } = await ctx.supabase
    .from("memberships")
    .delete()
    .eq("org_id", ctx.org.id)
    .eq("user_id", String(formData.get("user_id")))
    .select("user_id");
  if (error) return { error: describeError(error) };
  if (!data?.length) return { error: "That person isn't a member anymore." };
  revalidatePath(`/o/${ctx.org.slug}`, "layout");
  return { ok: "Removed." };
}
