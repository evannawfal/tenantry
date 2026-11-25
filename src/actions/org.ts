"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/forms";
import { getOrgContext, requireUser } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import { slugify } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const orgName = z.string().trim().min(2, "Use at least 2 characters for the name").max(80);

export async function createOrganization(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const name = orgName.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };

  const slug = slugify(String(formData.get("slug") || name.data));
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
    return { error: "The URL needs 3 to 40 letters, numbers or dashes." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", { p_name: name.data, p_slug: slug });
  if (error) return { error: describeError(error) };
  redirect(`/o/${slug}`);
}

export async function renameOrganization(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(String(formData.get("slug")));
  if (ctx.role !== "admin") return { error: "Only admins can rename the organization." };
  const name = orgName.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };

  const { error } = await ctx.supabase.from("organizations").update({ name: name.data }).eq("id", ctx.org.id);
  if (error) return { error: describeError(error) };
  revalidatePath(`/o/${ctx.org.slug}`, "layout");
  return { ok: "Saved." };
}

export async function updateProfile(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const name = z.string().trim().min(1, "Enter your name").max(100).safeParse(formData.get("full_name"));
  if (!name.success) return { error: name.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ full_name: name.data }).eq("id", user.id);
  if (error) return { error: describeError(error) };
  revalidatePath("/o", "layout");
  return { ok: "Saved." };
}

export async function leaveOrganization(_: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(String(formData.get("slug")));
  const { error } = await ctx.supabase
    .from("memberships")
    .delete()
    .eq("org_id", ctx.org.id)
    .eq("user_id", ctx.user.id);
  if (error) return { error: describeError(error) };
  redirect("/o");
}
